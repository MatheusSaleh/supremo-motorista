// Tráfego ambiente (M6): carros simples que rodam pelas ruas da cidade (grafo de ruas), na mão direita,
// freando atrás de quem estiver na frente (outro carro do tráfego, o jogador, perseguidores) e reduzindo
// antes das curvas. Só existem perto do jogador: nascem e somem fora da vista. Cada um tem um corpo
// cinemático na física (o carro do jogador bate neles de verdade). Uma draw call para todos.
// Local a cada jogador (não sincroniza no multiplayer).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GROUP, groups } from '../core/collisionGroups';
import { createRng } from '../core/random';
import type { RoadGraph, RoadNode } from '../world/RoadGraph';
import { GroundProbe, advanceWalker, randomNodeAround, startWalker, type Walker } from './graphWalk';

/** Obstáculo móvel que o tráfego respeita (carro do jogador, perseguidores, outros jogadores). */
export interface TrafficObstacle {
  x: number;
  z: number;
}

interface TrafficCar {
  walker: Walker;
  body: RAPIER.RigidBody;
  speed: number;
  cruise: number;
  y: number;
  color: THREE.Color;
  probeTimer: number;
}

const CAPACITY = 80;
const SPAWN_MIN = 220;
const SPAWN_MAX = 620;
const DESPAWN = 780;
const HALF = { x: 0.9, y: 0.7, z: 2.15 };
const COLORS = [0xf2f2f2, 0xf2f2f2, 0xd9d9d9, 0xc9ccd0, 0x9da3a8, 0x2b2d31, 0x1f1f22, 0x9e1c1c, 0x23446e, 0x5b6b4a, 0xd8cfb8, 0x7a2e2e];

export class AmbientTraffic {
  private readonly cars: TrafficCar[] = [];
  private readonly pool: RAPIER.RigidBody[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly rng = createRng(4242);
  private readonly probe: GroundProbe;
  private target = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly frustum = new THREE.Frustum();
  private readonly pm = new THREE.Matrix4();

  constructor(
    private readonly physics: RAPIER.World,
    scene: THREE.Scene,
    private readonly graph: RoadGraph,
    heightAt: (x: number, z: number) => number,
  ) {
    this.probe = new GroundProbe(physics, heightAt);
    this.mesh = new THREE.InstancedMesh(carGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.25, vertexColors: true }), CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // as instâncias andam: a esfera envolvente não vale
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'trafego';
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
  }

  /** Quantos carros manter em volta do jogador (por qualidade gráfica; 0 desliga). */
  setDensity(n: number): void {
    this.target = Math.max(0, Math.min(CAPACITY, n));
  }

  get count(): number {
    return this.cars.length;
  }

  /** Antes da física: move os carros e manda as posições para os corpos cinemáticos. */
  update(dt: number, focus: THREE.Vector3Like, camera: THREE.Camera, obstacles: readonly TrafficObstacle[]): void {
    this.manage(focus, camera);
    const nodes = this.graph.nodes;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const w = c.walker;
      // Freia atrás do que estiver à frente na mesma faixa (cone estreito até 26 m).
      const fx = Math.sin(w.yaw);
      const fz = Math.cos(w.yaw);
      let gap = Infinity;
      const look = (ox: number, oz: number) => {
        const rx = ox - w.x;
        const rz = oz - w.z;
        const ahead = rx * fx + rz * fz;
        if (ahead <= 0 || ahead > 26) return;
        if (Math.abs(rx * fz - rz * fx) > 2.4) return;
        gap = Math.min(gap, ahead);
      };
      for (let j = 0; j < this.cars.length; j++) if (j !== i) look(this.cars[j].walker.x, this.cars[j].walker.z);
      for (const o of obstacles) look(o.x, o.z);
      // Curva fechada adiante: reduz.
      let limit = c.cruise;
      if (w.len - w.s < 14) {
        const here = w.to;
        const turn = here.edges.length > 2 ? 7 : here.edges.length === 1 ? 4 : c.cruise;
        limit = Math.min(limit, turn);
      }
      const want = Number.isFinite(gap) ? Math.max(0, Math.min(limit, (gap - 7) * 0.9)) : limit;
      c.speed += Math.max(-9 * dt, Math.min(3 * dt, want - c.speed));
      advanceWalker(w, c.speed * dt, this.rng, laneOffset, nodes);
      // Altura pela física, de vez em quando (o resto do tempo, a última altura suavizada).
      if ((c.probeTimer -= dt) <= 0) {
        c.probeTimer = 0.12 + this.rng() * 0.08;
        const gy = this.probe.y(w.x, w.z, c.y + 8);
        c.y += (gy - c.y) * 0.6;
      }
      this.q.setFromAxisAngle(this.up, w.yaw);
      c.body.setNextKinematicTranslation({ x: w.x, y: c.y + HALF.y + 0.05, z: w.z });
      c.body.setNextKinematicRotation(this.q);
      this.m.compose(this.v.set(w.x, c.y + 0.75, w.z), this.q, this.one);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, c.color);
    }
    this.mesh.count = this.cars.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Nasce perto (fora da vista) até chegar à meta; some quem ficou longe. */
  private manage(focus: THREE.Vector3Like, camera: THREE.Camera): void {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const far = Math.hypot(c.walker.x - focus.x, c.walker.z - focus.z) > DESPAWN;
      if (far || this.cars.length > this.target) this.remove(i);
    }
    if (this.cars.length >= this.target) return;
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // Até dois por quadro, para não travar ao trocar a qualidade.
    for (let k = 0; k < 2 && this.cars.length < this.target; k++) {
      const n = randomNodeAround(this.graph, focus.x, focus.z, SPAWN_MIN, SPAWN_MAX, this.rng);
      if (!n) return;
      const next = this.graph.nodes[n.edges[Math.floor(this.rng() * n.edges.length)].to];
      const w = startWalker(n, next, laneOffset, this.rng() * 20);
      const y = this.probe.y(w.x, w.z);
      if (this.frustum.containsPoint(this.v.set(w.x, y + 1, w.z))) continue; // não aparece na frente do jogador
      if (this.cars.some((c) => Math.hypot(c.walker.x - w.x, c.walker.z - w.z) < 12)) continue;
      const wide = Math.min(n.width, next.width) >= 20;
      const cruise = (wide ? 15 : 9.5) * (0.85 + this.rng() * 0.3);
      this.cars.push({ walker: w, body: this.takeBody(w.x, y, w.z), speed: cruise * 0.6, cruise, y, color: new THREE.Color(COLORS[Math.floor(this.rng() * COLORS.length)]), probeTimer: 0 });
    }
  }

  private takeBody(x: number, y: number, z: number): RAPIER.RigidBody {
    let body = this.pool.pop();
    if (!body) {
      body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + HALF.y, z));
      // Colide com o mundo e com carros/jogador; não quebra postes nem dispara os sensores dos props.
      this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(HALF.x, HALF.y, HALF.z).setCollisionGroups(groups(GROUP.CAR, 0xffff & ~(GROUP.PROP | GROUP.PROP_SENSOR))),
        body,
      );
    }
    body.setEnabled(true);
    body.setTranslation({ x, y: y + HALF.y, z }, true);
    return body;
  }

  private remove(i: number): void {
    const c = this.cars[i];
    c.body.setEnabled(false);
    this.pool.push(c.body);
    this.cars.splice(i, 1);
  }

  dispose(): void {
    for (const c of this.cars) this.physics.removeRigidBody(c.body);
    for (const b of this.pool) this.physics.removeRigidBody(b);
    this.cars.length = 0;
    this.pool.length = 0;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

/** Faixa da direita: nas vias principais (24 m) a 5 m do eixo; nas locais (12 m), a 3 m. */
function laneOffset(from: RoadNode, to: RoadNode): number {
  return Math.min(from.width, to.width) >= 20 ? 5 : 3;
}

/** Carro do tráfego: mesma silhueta dos carros estacionados (carroceria clara, cabine e rodas escuras). */
function carGeometry(): THREE.BufferGeometry {
  const part = (geo: THREE.BufferGeometry, shade: number) => {
    const g = geo.toNonIndexed();
    const n = (g.attributes.position as THREE.BufferAttribute).count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(shade), 3));
    g.deleteAttribute('uv');
    return g;
  };
  return mergeGeometries([
    part(new THREE.BoxGeometry(1.8, 0.8, 4.3), 1),
    part(new THREE.BoxGeometry(1.6, 0.6, 2.2).translate(0, 0.7, -0.2), 0.16),
    part(new THREE.BoxGeometry(1.9, 0.5, 0.6).translate(0, -0.45, 1.35), 0.06),
    part(new THREE.BoxGeometry(1.9, 0.5, 0.6).translate(0, -0.45, -1.35), 0.06),
    part(new THREE.BoxGeometry(1.5, 0.18, 0.05).translate(0, 0.1, 2.16), 1.4), // faróis (claros)
  ]);
}

/** Quantos carros do tráfego e pedestres por qualidade gráfica (personalizada usa a média). */
export const AMBIENT_DENSITY: Record<string, { traffic: number; peds: number }> = {
  baixa: { traffic: 12, peds: 40 },
  media: { traffic: 28, peds: 90 },
  alta: { traffic: 45, peds: 140 },
  ultra: { traffic: 70, peds: 220 },
  personalizada: { traffic: 28, peds: 90 },
};
