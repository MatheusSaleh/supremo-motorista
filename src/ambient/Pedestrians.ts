// Pedestres (M6): bonequinhos low-poly que andam pelas calçadas (ao lado das pistas, pelo grafo de ruas) e
// esperam nas paradas de ônibus. Regra de conteúdo (violência só no pastelão): ninguém é atropelado. Quando
// o carro vem rápido na direção de um pedestre, ele dá um pulo cômico para o lado e depois volta para a
// calçada. Sem colisão física. Quatro draw calls para todos (tronco, cabeça e as duas pernas).
// Local a cada jogador (não sincroniza no multiplayer).
import * as THREE from 'three';
import { createRng } from '../core/random';
import type { WaterArea } from '../world/Level';
import type { RoadGraph, RoadNode } from '../world/RoadGraph';
import { GroundProbe, advanceWalker, randomNodeAround, startWalker, type Walker } from './graphWalk';

interface Ped {
  walker: Walker | null; // null = parado (esperando na parada)
  x: number;
  z: number;
  yaw: number;
  y: number;
  speed: number;
  phase: number;
  /** Pulo para o lado: direção, tempo (s) e deslocamento acumulado (volta aos poucos). */
  hopT: number;
  hopX: number;
  hopZ: number;
  offX: number;
  offZ: number;
  probeTimer: number;
  shirt: THREE.Color;
  pants: THREE.Color;
  skin: THREE.Color;
}

export interface CarThreat {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

const CAPACITY = 220;
const SPAWN_MIN = 70;
const SPAWN_MAX = 340;
const DESPAWN = 420;
const HOP_TIME = 0.65;
const HOP_DIST = 4.8;
const SHIRTS = [0x2b2d31, 0x3a3f47, 0xf2f2f2, 0xdcdcdc, 0x1f5aa6, 0xc0392b, 0x2e7d32, 0xf2c94c, 0x8e44ad, 0xe67e22, 0x5b6770];
const PANTS = [0x1f1f22, 0x2b3a55, 0x3e3a33, 0x5b5b5b, 0x1d2a33, 0x7a6a55];
const SKINS = [0xf1d1b5, 0xe0ac7d, 0xc68642, 0x8d5524, 0x5c3a21, 0xf6e0c8];

export class Pedestrians {
  private readonly peds: Ped[] = [];
  private readonly rng = createRng(9191);
  private readonly probe: GroundProbe;
  private readonly torso: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly legL: THREE.InstancedMesh;
  private readonly legR: THREE.InstancedMesh;
  private target = 0;
  private readonly m = new THREE.Matrix4();
  private readonly leg = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly frustum = new THREE.Frustum();
  private readonly pm = new THREE.Matrix4();
  private readonly allowed: (from: RoadNode, to: RoadNode) => boolean;

  constructor(
    scene: THREE.Scene,
    private readonly graph: RoadGraph,
    physics: ConstructorParameters<typeof GroundProbe>[0],
    private readonly heightAt: (x: number, z: number) => number,
    water: readonly WaterArea[],
    private readonly stops: readonly { x: number; z: number; yaw: number }[],
  ) {
    this.probe = new GroundProbe(physics, heightAt);
    // Pedestre não anda sobre a água (a Ponte JK fica só para os carros).
    this.allowed = (a, b) => {
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      return !water.some((w) => mx > w.minX && mx < w.maxX && mz > w.minZ && mz < w.maxZ);
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const make = (geo: THREE.BufferGeometry, name: string) => {
      const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.name = name;
      mesh.setColorAt(0, new THREE.Color());
      scene.add(mesh);
      return mesh;
    };
    // Tronco com os braços colados (uma caixa mais larga em cima), cabeça e pernas com o quadril na origem.
    this.torso = make(new THREE.BoxGeometry(0.5, 0.62, 0.26).translate(0, 1.22, 0), 'pedestres-tronco');
    this.head = make(new THREE.IcosahedronGeometry(0.14, 1).translate(0, 1.68, 0), 'pedestres-cabeca');
    const legGeo = new THREE.BoxGeometry(0.17, 0.9, 0.2).translate(0, -0.45, 0);
    this.legL = make(legGeo, 'pedestres-perna-e');
    this.legR = make(legGeo.clone(), 'pedestres-perna-d');
  }

  setDensity(n: number): void {
    this.target = Math.max(0, Math.min(CAPACITY, n));
  }

  get count(): number {
    return this.peds.length;
  }

  update(dt: number, focus: THREE.Vector3Like, camera: THREE.Camera, threats: readonly CarThreat[]): void {
    this.manage(focus, camera);
    const nodes = this.graph.nodes;
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      if (p.walker) {
        advanceWalker(p.walker, p.speed * dt, this.rng, sidewalkOffset, nodes, this.allowed);
        p.x = p.walker.x;
        p.z = p.walker.z;
        p.yaw = p.walker.yaw;
        p.phase += dt * p.speed * 4.2;
      }
      // Carro vindo rápido na direção dele: pulo para o lado (para longe da trajetória).
      if (p.hopT <= 0) {
        for (const t of threats) {
          const sp = Math.hypot(t.vx, t.vz);
          if (sp < 4) continue;
          const fx = t.vx / sp;
          const fz = t.vz / sp;
          const rx = p.x + p.offX - t.x;
          const rz = p.z + p.offZ - t.z;
          const ahead = rx * fx + rz * fz;
          const side = rx * fz - rz * fx;
          if (ahead > 0 && ahead < 6 + sp * 0.9 && Math.abs(side) < 2.6) {
            const s = side >= 0 ? 1 : -1;
            p.hopX = fz * s;
            p.hopZ = -fx * s;
            p.hopT = HOP_TIME;
            break;
          }
        }
      }
      let lift = 0;
      if (p.hopT > 0) {
        const k0 = 1 - p.hopT / HOP_TIME;
        p.hopT = Math.max(0, p.hopT - dt);
        const k1 = 1 - p.hopT / HOP_TIME;
        p.offX += p.hopX * HOP_DIST * (k1 - k0);
        p.offZ += p.hopZ * HOP_DIST * (k1 - k0);
        lift = Math.sin(k1 * Math.PI) * 1.1;
      } else {
        // Volta devagar para a calçada.
        const back = Math.min(1, dt * 0.6);
        p.offX -= p.offX * back;
        p.offZ -= p.offZ * back;
      }
      const x = p.x + p.offX;
      const z = p.z + p.offZ;
      if ((p.probeTimer -= dt) <= 0) {
        p.probeTimer = 0.25 + this.rng() * 0.15;
        p.y = this.probe.y(x, z, p.y + 6);
      }
      const walking = p.walker !== null && p.hopT <= 0;
      const bob = walking ? Math.abs(Math.sin(p.phase)) * 0.05 : 0;
      this.q.setFromAxisAngle(this.up, p.yaw + (p.hopT > 0 ? Math.sin((1 - p.hopT / HOP_TIME) * Math.PI) * 0.6 : 0));
      this.m.compose(this.v.set(x, p.y + lift + bob, z), this.q, this.one);
      this.torso.setMatrixAt(i, this.m);
      this.head.setMatrixAt(i, this.m);
      // Pernas: giram no quadril (pulo: pernas abertas).
      const swing = p.hopT > 0 ? 0.7 : walking ? Math.sin(p.phase) * 0.55 : 0;
      for (const [mesh, sx, sgn] of [
        [this.legL, 0.12, 1],
        [this.legR, -0.12, -1],
      ] as const) {
        this.leg.makeRotationX(swing * sgn).setPosition(sx, 0.92, 0);
        mesh.setMatrixAt(i, this.tmp.multiplyMatrices(this.m, this.leg));
      }
      this.torso.setColorAt(i, p.shirt);
      this.head.setColorAt(i, p.skin);
      this.legL.setColorAt(i, p.pants);
      this.legR.setColorAt(i, p.pants);
    }
    for (const mesh of [this.torso, this.head, this.legL, this.legR]) {
      mesh.count = this.peds.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private manage(focus: THREE.Vector3Like, camera: THREE.Camera): void {
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      if (Math.hypot(p.x - focus.x, p.z - focus.z) > DESPAWN || this.peds.length > this.target) this.peds.splice(i, 1);
    }
    if (this.peds.length >= this.target) return;
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (let k = 0; k < 3 && this.peds.length < this.target; k++) {
      // Um em cada cinco espera numa parada de ônibus perto (se houver).
      if (this.rng() < 0.2 && this.stops.length) {
        const st = this.stops[Math.floor(this.rng() * this.stops.length)];
        const d = Math.hypot(st.x - focus.x, st.z - focus.z);
        if (d > SPAWN_MIN && d < SPAWN_MAX) {
          const along = (this.rng() - 0.5) * 3;
          const x = st.x + Math.cos(st.yaw) * along + Math.sin(st.yaw) * 0.3;
          const z = st.z - Math.sin(st.yaw) * along + Math.cos(st.yaw) * 0.3;
          this.add(null, x, z, st.yaw + (this.rng() - 0.5) * 0.8);
          continue;
        }
      }
      const n = randomNodeAround(this.graph, focus.x, focus.z, SPAWN_MIN, SPAWN_MAX, this.rng);
      if (!n) return;
      const nexts = n.edges.map((e) => this.graph.nodes[e.to]).filter((t) => this.allowed(n, t));
      if (!nexts.length) continue;
      const w = startWalker(n, nexts[Math.floor(this.rng() * nexts.length)], sidewalkOffset, this.rng() * 30);
      const y = this.heightAt(w.x, w.z);
      if (this.frustum.containsPoint(this.v.set(w.x, y + 1, w.z)) && Math.hypot(w.x - focus.x, w.z - focus.z) < 160) continue;
      this.add(w, w.x, w.z, w.yaw);
    }
  }

  private add(walker: Walker | null, x: number, z: number, yaw: number): void {
    const pick = (list: number[]) => new THREE.Color(list[Math.floor(this.rng() * list.length)]);
    this.peds.push({
      walker,
      x,
      z,
      yaw,
      y: this.probe.y(x, z),
      speed: 1.1 + this.rng() * 0.6,
      phase: this.rng() * 6,
      hopT: 0,
      hopX: 0,
      hopZ: 0,
      offX: 0,
      offZ: 0,
      probeTimer: this.rng() * 0.3,
      shirt: pick(SHIRTS),
      pants: pick(PANTS),
      skin: pick(SKINS),
    });
  }

  dispose(): void {
    for (const mesh of [this.torso, this.head, this.legL, this.legR]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.peds.length = 0;
  }
}

/** Calçada: à direita de quem anda, logo depois da borda da pista (um pouco aleatório por pedestre). */
function sidewalkOffset(from: RoadNode, to: RoadNode): number {
  return Math.min(from.width, to.width) / 2 + 2.2;
}
