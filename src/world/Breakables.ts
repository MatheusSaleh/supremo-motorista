// Props quebráveis (postes, árvores, placas): o carro os derruba em vez de parar seco.
// Cada prop tem visuais (instâncias de InstancedMesh e/ou malhas avulsas) e colisores (sólido + sensor).
// Ao detectar o carro no sensor, o prop some do cenário e vira um destroço dinâmico que tomba e,
// depois de alguns segundos, desaparece.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COLLISION } from '../core/collisionGroups';

export type PropKind = 'pole' | 'tree' | 'sign';

export interface BreakEvent {
  kind: PropKind;
  position: THREE.Vector3;
}

type Visual = { mesh: THREE.InstancedMesh; index: number } | { object: THREE.Mesh };

interface Prop {
  kind: PropKind;
  visuals: Visual[];
  colliders: RAPIER.Collider[];
  /** Pé do prop (centro da base). */
  base: THREE.Vector3;
  height: number;
  broken: boolean;
}

interface Debris {
  body: RAPIER.RigidBody;
  group: THREE.Group;
  ttl: number;
  owned: THREE.Material[];
}

const DEBRIS_TTL = 7;
const MAX_DEBRIS = 24;
const MASS: Record<PropKind, number> = { pole: 120, tree: 300, sign: 60 };

export class Breakables {
  private readonly props = new Map<string, Prop>();
  private readonly bySensor = new Map<number, Prop>();
  private readonly debris: Debris[] = [];
  private readonly root = new THREE.Group();
  private readonly tmpM = new THREE.Matrix4();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    private readonly physics: RAPIER.World,
    scene: THREE.Scene,
  ) {
    this.root.name = 'destrocos';
    scene.add(this.root);
  }

  get count(): number {
    return this.props.size;
  }

  private prop(id: string, kind: PropKind): Prop {
    let p = this.props.get(id);
    if (!p) this.props.set(id, (p = { kind, visuals: [], colliders: [], base: new THREE.Vector3(), height: 1, broken: false }));
    return p;
  }

  addInstanceVisual(id: string, kind: PropKind, mesh: THREE.InstancedMesh, index: number): void {
    this.prop(id, kind).visuals.push({ mesh, index });
  }

  addObjectVisual(id: string, kind: PropKind, object: THREE.Mesh): void {
    this.prop(id, kind).visuals.push({ object });
  }

  /** Cria o colisor sólido (bloqueia o Josué) e o sensor (detecta o carro) de um poste/tronco. */
  addPoleColliders(id: string, kind: PropKind, base: THREE.Vector3, height: number, radius: number): void {
    const p = this.prop(id, kind);
    const solid = this.physics.createCollider(
      RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(base.x, base.y + height / 2, base.z).setCollisionGroups(COLLISION.propSolid),
    );
    const sensor = this.physics.createCollider(
      RAPIER.ColliderDesc.cylinder(height / 2, radius + 0.15)
        .setTranslation(base.x, base.y + height / 2, base.z)
        .setSensor(true)
        .setCollisionGroups(COLLISION.propSensor)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    );
    p.colliders.push(solid, sensor);
    this.bySensor.set(sensor.handle, p);
    // Base do prop = média das bases dos seus colisores (placa = entre os dois postes).
    const n = p.colliders.length / 2;
    p.base.multiplyScalar((n - 1) / n).addScaledVector(base, 1 / n);
    p.height = Math.max(p.height, height);
  }

  /** Processa os eventos do passo de física; retorna o que quebrou. */
  handleEvents(queue: RAPIER.EventQueue, carBody: RAPIER.RigidBody): BreakEvent[] {
    const out: BreakEvent[] = [];
    queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const p = this.bySensor.get(h1) ?? this.bySensor.get(h2);
      if (!p || p.broken) return;
      const v = carBody.linvel();
      if (Math.hypot(v.x, v.z) < 2.5) return; // encostar devagar não derruba
      this.breakProp(p, v);
      out.push({ kind: p.kind, position: p.base.clone() });
    });
    return out;
  }

  /** Por frame: destroços seguem seus corpos e somem após o tempo de vida. */
  update(dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.ttl -= dt;
      const t = d.body.translation();
      const r = d.body.rotation();
      d.group.position.set(t.x, t.y, t.z);
      d.group.quaternion.set(r.x, r.y, r.z, r.w);
      if (d.ttl < 1) d.group.scale.setScalar(Math.max(0.001, d.ttl)); // encolhe antes de sumir
      if (d.ttl <= 0) this.removeDebris(i);
    }
  }

  private breakProp(p: Prop, carVel: RAPIER.Vector): void {
    p.broken = true;
    for (const c of p.colliders) {
      this.bySensor.delete(c.handle);
      this.physics.removeCollider(c, false);
    }

    // Corpo do destroço com origem na base do prop.
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(p.base.x, p.base.y, p.base.z).setLinearDamping(0.3).setAngularDamping(0.5),
    );
    const radius = p.kind === 'tree' ? 0.4 : 0.25;
    const col = RAPIER.ColliderDesc.cylinder(p.height / 2, radius)
      .setTranslation(0, p.height / 2, 0)
      .setCollisionGroups(COLLISION.debris)
      .setMass(MASS[p.kind]);
    this.physics.createCollider(col, body);

    // Visuais: copia para o grupo do destroço (no espaço da base) e esconde no cenário.
    const group = new THREE.Group();
    group.position.copy(p.base);
    const inv = new THREE.Matrix4().makeTranslation(-p.base.x, -p.base.y, -p.base.z);
    const owned: THREE.Material[] = [];
    for (const v of p.visuals) {
      if ('mesh' in v) {
        v.mesh.getMatrixAt(v.index, this.tmpM).premultiply(v.mesh.matrixWorld);
        let material = v.mesh.material as THREE.Material;
        if (v.mesh.instanceColor) {
          // Copia a cor da instância (o material instanciado não a teria numa malha comum).
          const c = new THREE.Color();
          v.mesh.getColorAt(v.index, c);
          const m = (material as THREE.MeshStandardMaterial).clone();
          m.color.copy(c);
          owned.push(m);
          material = m;
        }
        const piece = new THREE.Mesh(v.mesh.geometry, material);
        piece.matrixAutoUpdate = false;
        piece.matrix.copy(this.tmpM).premultiply(inv);
        piece.castShadow = true;
        group.add(piece);
        v.mesh.setMatrixAt(v.index, this.zero);
        v.mesh.instanceMatrix.needsUpdate = true;
      } else {
        const o = v.object;
        o.updateWorldMatrix(true, false);
        const world = o.matrixWorld.clone();
        o.removeFromParent();
        o.matrixAutoUpdate = false;
        o.matrix.copy(world).premultiply(inv);
        group.add(o);
      }
    }
    this.root.add(group);

    // Tranco: empurra na direção do carro, aplicado no alto para tombar.
    const speed = Math.hypot(carVel.x, carVel.z);
    const k = MASS[p.kind] * Math.min(speed, 30) * 0.45;
    const dir = { x: carVel.x / speed, z: carVel.z / speed };
    body.applyImpulseAtPoint(
      { x: dir.x * k, y: MASS[p.kind] * 2, z: dir.z * k },
      { x: p.base.x, y: p.base.y + p.height * 0.7, z: p.base.z },
      true,
    );

    this.debris.push({ body, group, ttl: DEBRIS_TTL, owned });
    while (this.debris.length > MAX_DEBRIS) this.removeDebris(0);
  }

  private removeDebris(i: number): void {
    const d = this.debris[i];
    this.physics.removeRigidBody(d.body);
    d.group.removeFromParent();
    d.owned.forEach((m) => m.dispose());
    this.debris.splice(i, 1);
  }
}
