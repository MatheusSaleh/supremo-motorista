// Visual dos carros da frota (gerados em código por carDesign.ts, ou carregados de um .glb no mesmo formato):
// rodas animadas pela física, luzes de freio/ré, sujeira e amassados. Frente = +Z; origem = centro do chassi.
// Também mede o modelo (rodas, lataria) para a física de cada carro (VehicleGeometry).
import * as THREE from 'three';
import type { Assets } from '../core/Assets';
import type { Grips } from '../player/SeatedDriver';
import { createCarInterior } from './carInterior';
import { mergeByMaterial } from './mergeParts';

/** Distância (m) da câmera até o carro abaixo da qual o interior é desenhado (pelo vidro não se vê de longe). */
const INTERIOR_NEAR = 14;

export interface CarModel {
  root: THREE.Group;
  /** Um grupo por roda, na ordem FE, FD, TE, TD (frente-esquerda…). Gira em Y (esterço). */
  wheels: THREE.Group[];
  /** Filho de cada roda que gira em X (rolagem). */
  wheelSpins: THREE.Object3D[];
  /** Onde o motorista senta (filho de root). */
  seat: THREE.Object3D;
  /** Olhos do motorista (câmera de cockpit). */
  eyes: THREE.Object3D;
  /** Banco de trás (passageiro das corridas). */
  rearSeat: THREE.Object3D;
  /** Pegadas das mãos no volante (null no carro procedural de reserva). */
  grips: Grips | null;
  /** Volante e instrumentos: ângulo das rodas (rad), km/h e rotação 0..1. */
  updateInterior(steer: number, kmh: number, rpm: number): void;
  setLights(brake: boolean, reverse: boolean): void;
  /** Mapa de ambiente (reflexos) só nos materiais do carro. */
  setEnvironment(env: THREE.Texture): void;
  /** 0 = limpo … 1 = imundo. */
  setDirt(amount: number): void;
  /** Troca a cor da pintura (carros das facções). */
  setPaint(color: number): void;
  /** Amassa a lataria: ponto e direção (espaço do carro) de onde veio a pancada. */
  dent(fromDir: THREE.Vector3, strength: number): void;
  repair(): void;
}

/** Medidas de um modelo, usadas pela física e pelo interior. Espaço do chassi: frente = +Z, esquerda = +X. */
export interface VehicleGeometry {
  /** Rodas FE, FD, TE, TD: (x, z). */
  wheels: [number, number][];
  wheelRadius: number;
  /** Meia-dimensões do chassi físico. */
  half: { x: number; y: number; z: number };
  /** Caixa da cabine (sem massa): meia-dimensões + centro (y, z). */
  cabin: { x: number; y: number; z: number; cy: number; cz: number };
  /** Altura do chão no espaço do chassi (suspensão em repouso). */
  groundOffset: number;
  /** Escala do interior em relação à cabine do sedã de referência. */
  interiorScale: THREE.Vector3;
}

/** Referência: o sedã executivo original, para o qual o interior e a física foram ajustados. */
const REF = { width: 2.53, top: 1.8, length: 4.71, bodyHeight: 1.53 };

export const DEFAULT_GEOMETRY: VehicleGeometry = {
  wheels: [
    [0.876, 1.448],
    [-0.876, 1.448],
    [0.876, -1.448],
    [-0.876, -1.448],
  ],
  wheelRadius: 0.36,
  half: { x: 0.9, y: 0.32, z: 2.35 },
  cabin: { x: 0.8, y: 0.26, z: 1.05, cy: 0.6, cz: -0.15 },
  groundOffset: -0.6,
  interiorScale: new THREE.Vector3(1, 1, 1),
};

/** Template carregado uma vez; cada carro clona. */
export interface CarAsset {
  template: THREE.Group;
  geometry: VehicleGeometry;
}

const WHEEL_ORDER = ['wheel-front-left', 'wheel-front-right', 'wheel-rear-left', 'wheel-rear-right'];

export async function loadCarAsset(assets: Assets, url: string, onProgress?: (f: number) => void): Promise<CarAsset> {
  const gltf = await assets.loadGLTF(url, onProgress);
  const names = new Set<string>();
  gltf.scene.traverse((o) => names.add(o.name));
  for (const w of WHEEL_ORDER) if (!names.has(w)) throw new Error(`modelo do carro sem a roda "${w}"`);
  if (!names.has('body')) throw new Error('modelo do carro sem a malha "body"');
  return { template: gltf.scene, geometry: measure(gltf.scene) };
}

/** Mede rodas e lataria do modelo (chão em y = 0, centrado) e deriva o chassi físico. */
export function measure(template: THREE.Object3D): VehicleGeometry {
  template.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const wheels = WHEEL_ORDER.map((n) => {
    template.getObjectByName(n)!.getWorldPosition(v);
    return [v.x, v.z] as [number, number];
  });
  box.setFromObject(template.getObjectByName(WHEEL_ORDER[0])!);
  const wheelRadius = (box.max.y - box.min.y) / 2;
  box.setFromObject(template.getObjectByName('body')!);
  const width = box.max.x - box.min.x;
  const length = box.max.z - box.min.z;
  const hs = (box.max.y - box.min.y) / REF.bodyHeight;
  const ls = length / REF.length;
  // Mesmas proporções do sedã de referência (cuja física foi afinada à mão).
  return {
    wheels,
    wheelRadius,
    half: { x: (width / 2) * 0.71, y: 0.32 * hs, z: (length / 2) * 0.99 },
    cabin: { x: (width / 2) * 0.63, y: 0.26 * hs, z: 1.05 * ls, cy: 0.6 * hs, cz: -0.15 * ls },
    groundOffset: -(0.24 + wheelRadius),
    interiorScale: new THREE.Vector3(width / REF.width, box.max.y / REF.top, ls),
  };
}

/**
 * @param groundOffset altura (no espaço do chassi) onde fica o chão com a suspensão em repouso:
 *   o modelo (chão em y = 0) é deslocado para lá.
 */
export function createCarModelFromAsset(asset: CarAsset, paintColor: number | null, modelInterior = false): CarModel {
  const groundOffset = asset.geometry.groundOffset;
  const root = new THREE.Group();
  root.name = 'carro-oficial';
  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = groundOffset;
  root.add(bodyGroup);

  // Materiais clonados (sujeira e luzes são por carro).
  const clones = new Map<THREE.Material, THREE.Material>();
  const cloneMat = (m: THREE.Material) => {
    let c = clones.get(m);
    if (!c) clones.set(m, (c = m.clone()));
    return c;
  };
  const byName = (name: string) => [...clones.values()].find((m) => m.name === name) as THREE.MeshStandardMaterial | undefined;

  // Cada peça é um nó com nome (o exportador vira malha multimaterial em grupo com submalhas).
  const part = (name: string) => asset.template.getObjectByName(name);
  const adopt = (node: THREE.Object3D, cloneGeometry: boolean): THREE.Object3D => {
    const copy = node.clone(true);
    copy.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (cloneGeometry) o.geometry = o.geometry.clone();
      o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return copy;
  };

  const wheels: THREE.Group[] = [];
  const wheelSpins: THREE.Object3D[] = [];
  WHEEL_ORDER.forEach((name, i) => {
    const wheel = adopt(part(name)!, false);
    wheel.position.set(0, 0, 0); // a origem do nó é o cubo da roda (garantido na conversão)
    mergeByMaterial(wheel); // aro, pneu, raios… viram poucas malhas (a roda gira inteira)
    const steer = new THREE.Group(); // posicionado pelo Car (suspensão) e girado em Y (esterço)
    const spin = new THREE.Group(); // gira em X (rolagem)
    spin.add(wheel);
    steer.add(spin);
    root.add(steer);
    wheels[i] = steer;
    wheelSpins[i] = spin;
  });

  const bodySrc = part('body');
  if (!bodySrc) throw new Error('carro sem lataria');
  const body = adopt(bodySrc, true);
  bodySrc.matrixWorld.decompose(body.position, body.quaternion, body.scale);
  // A lataria é estática (os amassados mexem nos vértices): uma malha por material em vez de ~90 peças.
  mergeByMaterial(body);
  bodyGroup.add(body);
  const bodyMeshes: THREE.Mesh[] = [];
  body.traverse((o) => {
    if (o instanceof THREE.Mesh) bodyMeshes.push(o);
  });

  // Vidro translúcido (deixa ver o interior), visível também por dentro.
  const glass = byName('glass');
  if (glass) {
    glass.transparent = true;
    glass.opacity = 0.42;
    glass.depthWrite = false;
    glass.side = THREE.DoubleSide;
  }
  // Por dentro, a lataria (colunas, teto) precisa aparecer também: o modelo só tinha faces externas.
  for (const name of ['paint', 'black']) {
    const m = byName(name);
    if (m) m.side = THREE.DoubleSide;
  }

  const interior = createCarInterior();
  interior.root.scale.copy(asset.geometry.interiorScale);
  // Modelo com interior próprio: esconde bancos/painel procedurais (âncoras, pegadas e olhos continuam).
  if (modelInterior) interior.root.traverse((o) => { if (o instanceof THREE.Mesh) o.visible = false; });
  interior.root.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = false; }); // fica dentro da lataria
  bodyGroup.add(interior.root);
  // Motorista e passageiro ficam em âncoras SEM escala (personagem não pode ser deformado).
  const anchor = (src: THREE.Object3D) => {
    const a = new THREE.Object3D();
    a.position.copy(src.position).multiply(asset.geometry.interiorScale);
    bodyGroup.add(a);
    return a;
  };
  const seatAnchor = anchor(interior.driverSeat);
  const rearAnchor = anchor(interior.rearSeat);
  // Olhos: mesma distância do banco que no sedã de referência (acompanha o corpo do motorista, não a cabine).
  const eyesAnchor = new THREE.Object3D();
  eyesAnchor.position.copy(seatAnchor.position).add(interior.eyes.position.clone().sub(interior.driverSeat.position));
  bodyGroup.add(eyesAnchor);
  const paint = byName('paint');
  if (paint) {
    // Preto "de frota": um pouco acima do preto puro, para o reflexo do ambiente aparecer.
    if (paintColor !== null) paint.color.set(paintColor);
    paint.roughness = 0.22;
    paint.metalness = 0.35;
  }
  const cleanColor = paint?.color.clone() ?? new THREE.Color();
  const dirtColor = new THREE.Color(0x5b5240);
  let dirtAmount = 0;
  const taillight = byName('taillight');

  // Luzes de ré: dois retângulos brancos ao lado das lanternas (posição tirada da própria geometria).
  const reverseMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.6 });
  const reverseLights = new THREE.Group();
  reverseLights.visible = false;
  const tailBox = materialBounds(bodyMeshes, taillight);
  if (tailBox) {
    const y = (tailBox.min.y + tailBox.max.y) / 2;
    for (const s of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.07), reverseMat);
      l.rotation.y = Math.PI;
      // Logo para dentro das lanternas (que ocupam os cantos).
      l.position.set(s * tailBox.max.x * 0.52, y, tailBox.min.z - 0.012);
      reverseLights.add(l);
    }
  }
  body.add(reverseLights);

  // Amassados: deforma vértices da lataria perto do ponto atingido (com limite por vértice).
  const parts = bodyMeshes.map((m) => {
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    return { mesh: m, pos, original: Float32Array.from(pos.array as ArrayLike<number>) };
  });
  const bb = new THREE.Box3();
  for (const m of bodyMeshes) {
    m.geometry.computeBoundingBox();
    bb.union(m.geometry.boundingBox!);
  }
  const center = bb.getCenter(new THREE.Vector3());

  // Interior só de perto: a cada quadro em que a lataria é desenhada, decide se o interior entra no próximo.
  const camPos = new THREE.Vector3();
  const carPos = new THREE.Vector3();
  // Vigia: a maior malha da lataria (a pintura), que está no quadro sempre que o carro está.
  const watcher = bodyMeshes.reduce<THREE.Mesh | null>((best, m) => (!best || m.geometry.attributes.position.count > best.geometry.attributes.position.count ? m : best), null);
  interior.root.visible = false;
  if (watcher) {
    watcher.onBeforeRender = (_r, _s, camera) => {
      camera.getWorldPosition(camPos);
      body.getWorldPosition(carPos);
      interior.root.visible = camPos.distanceToSquared(carPos) < INTERIOR_NEAR * INTERIOR_NEAR;
    };
  }
  const half = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const v = new THREE.Vector3();
  const o = new THREE.Vector3();

  return {
    root,
    wheels,
    wheelSpins,
    seat: seatAnchor,
    eyes: eyesAnchor,
    rearSeat: rearAnchor,
    grips: interior.grips,
    updateInterior: (steer, kmh, rpm) => interior.update(steer, kmh, rpm),
    setLights(brake, reverse) {
      if (taillight) taillight.emissiveIntensity = brake ? 2.6 : 0.35;
      reverseLights.visible = reverse;
    },
    setEnvironment(env) {
      // Pintura com pouco reflexo: o "estúdio" do RoomEnvironment tem um teto muito claro, que deixava
      // capô, teto e porta-malas brancos vistos de cima.
      const intensity: Record<string, number> = { paint: 0.3, glass: 0.8, trim: 1, rim: 1, headlight: 0.6 };
      for (const m of clones.values()) {
        if (!(m instanceof THREE.MeshStandardMaterial) || !(m.name in intensity)) continue;
        m.envMap = env;
        m.envMapIntensity = intensity[m.name];
        m.needsUpdate = true;
      }
    },
    setDirt(amount) {
      dirtAmount = amount;
      paint?.color.copy(cleanColor).lerp(dirtColor, Math.min(1, amount) * 0.75);
      if (paint) paint.roughness = 0.28 + amount * 0.6;
    },
    setPaint(color) {
      cleanColor.setHex(color);
      this.setDirt(dirtAmount);
    },
    dent(fromDir, strength) {
      // Ponto de impacto: onde a direção da pancada encontra a caixa da lataria, à meia altura.
      const d = fromDir.clone().setY(0).normalize();
      const k = Math.min(half.x / Math.max(Math.abs(d.x), 1e-3), half.z / Math.max(Math.abs(d.z), 1e-3));
      const hit = new THREE.Vector3(center.x + d.x * k, center.y - half.y * 0.25, center.z + d.z * k);
      const radius = 0.55 + Math.min(strength, 25) * 0.025;
      const depth = Math.min(0.16, strength * 0.007);
      for (const { mesh, pos, original } of parts) {
        let changed = false;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          const dist = v.distanceTo(hit);
          if (dist > radius) continue;
          const f = (1 - dist / radius) ** 2;
          // Empurra para dentro (contra a direção da pancada), sem passar de 0,22 m do original.
          v.addScaledVector(d, -depth * f);
          o.fromArray(original, i * 3);
          if (v.distanceTo(o) > 0.22) v.copy(o).addScaledVector(v.sub(o).normalize(), 0.22);
          pos.setXYZ(i, v.x, v.y, v.z);
          changed = true;
        }
        if (changed) {
          pos.needsUpdate = true;
          mesh.geometry.computeVertexNormals();
        }
      }
    },
    repair() {
      for (const { mesh, pos, original } of parts) {
        (pos.array as Float32Array).set(original);
        pos.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
    },
  };
}

/** Caixa (no espaço da lataria) das submalhas que usam um material. */
function materialBounds(meshes: THREE.Mesh[], material: THREE.Material | undefined): THREE.Box3 | null {
  if (!material) return null;
  const box = new THREE.Box3();
  for (const m of meshes) {
    const mats = ([] as THREE.Material[]).concat(m.material);
    if (!mats.includes(material)) continue;
    m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!);
  }
  return box.isEmpty() ? null : box;
}
