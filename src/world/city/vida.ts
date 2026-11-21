// Vida na cidade (M6 do plano de densificação, docs/PLANO-MAPA.md), parte estática: paradas de ônibus ao
// longo das vias principais (algumas com banca de jornal) e os caminhos de terra que o povo abre na grama
// entre a parada e o endereço mais perto ("caminho de rato", marca registrada de Brasília).
// Os pedestres e o tráfego (dinâmicos) ficam em src/ambient/.
import * as THREE from 'three';
import { inRect, placeMatrix, rectOf, type CityBuilder } from './builder';

export interface BusStop {
  x: number;
  z: number;
  /** Para onde a frente do abrigo aponta (a pista). */
  yaw: number;
}

/** Distância entre paradas ao longo de uma via principal (m). */
const STOP_SPACING = 360;

export function buildVida(b: CityBuilder): BusStop[] {
  const g = b.group('vida');
  const stops = placeBusStops(b);
  buildShelters(b, g, stops);
  buildDirtPaths(b, g, stops);
  return stops;
}

/** Uma parada a cada STOP_SPACING m de cada via principal, do lado direito, onde houver espaço livre. */
function placeBusStops(b: CityBuilder): BusStop[] {
  const stops: BusStop[] = [];
  for (const s of b.roadSegments) {
    if (s.width < 20) continue; // só vias principais
    const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
    if (len < STOP_SPACING * 0.8) continue;
    const dx = (s.x2 - s.x1) / len;
    const dz = (s.z2 - s.z1) / len;
    for (let d = STOP_SPACING / 2; d < len - 40; d += STOP_SPACING) {
      for (const side of [1, -1]) {
        // Lado direito de quem anda no sentido do trecho (e o oposto na outra mão).
        const off = s.width / 2 + 7; // fora da margem de ocupação da pista (3 m)
        const x = s.x1 + dx * (d + side * 30) - dz * side * off;
        const z = s.z1 + dz * (d + side * 30) + dx * side * off;
        if (!b.isRectFree(rectOf(x, z, 7, 7))) continue;
        if (stops.some((p) => Math.hypot(p.x - x, p.z - z) < 120)) continue;
        // A frente do abrigo olha para a pista (direção perpendicular, para o eixo).
        stops.push({ x, z, yaw: Math.atan2(dz * side, -dx * side) });
        b.occupy(rectOf(x, z, 6, 6));
      }
    }
  }
  return stops;
}

/** Abrigo (cobertura, painel de fundo com anúncio, banco e pilares) e, em uma a cada três, uma banca. */
function buildShelters(b: CityBuilder, g: THREE.Object3D, stops: BusStop[]): void {
  const roofs: THREE.Matrix4[] = [];
  const panels: THREE.Matrix4[] = [];
  const benches: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const kiosks: THREE.Matrix4[] = [];
  const awnings: THREE.Matrix4[] = [];
  const local = new THREE.Matrix4();
  const place = (st: BusStop, lx: number, y: number, lz: number, out: THREE.Matrix4[]) => {
    const m = placeMatrix(st.x, 0, st.z, st.yaw);
    out.push(m.multiply(local.makeTranslation(lx, y, lz)).clone());
  };
  stops.forEach((st, i) => {
    place(st, 0, 2.6, 0, roofs);
    place(st, 0, 1.4, -0.9, panels);
    place(st, 0, 0.45, -0.5, benches);
    for (const lx of [-1.8, 1.8]) place(st, lx, 0, -0.9, posts);
    if (i % 3 === 0) {
      place(st, 6, 1.3, -0.4, kiosks);
      place(st, 6, 2.75, 0.9, awnings);
      b.occupy(rectOf(st.x, st.z, 16, 16));
    }
  });
  const m = b.mats;
  const glass = new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.3, metalness: 0.2 });
  const green = new THREE.MeshStandardMaterial({ color: 0x1f6b3c, roughness: 0.6 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.7 });
  const setup = (mesh: THREE.InstancedMesh, collide: boolean, cull: number) => {
    mesh.userData.cullDistance = cull;
    if (!collide) mesh.userData.noCollision = true;
    mesh.userData.cameraIgnore = true;
  };
  setup(b.instanced(g, new THREE.BoxGeometry(4.4, 0.15, 2.2), m.metal, roofs, undefined, 'paradas-cobertura'), false, 450);
  setup(b.instanced(g, new THREE.BoxGeometry(4, 2.2, 0.1), glass, panels, undefined, 'paradas-painel'), true, 450);
  setup(b.instanced(g, new THREE.BoxGeometry(3.4, 0.12, 0.5), m.wood, benches, undefined, 'paradas-banco'), false, 250);
  const postMesh = b.instanced(g, new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6).translate(0, 1.3, 0), m.metal, posts, undefined, 'paradas-pilares');
  setup(postMesh, true, 300);
  postMesh.userData.collider = 'pole';
  postMesh.userData.poleRadius = 0.1;
  setup(b.instanced(g, new THREE.BoxGeometry(3, 2.6, 2.4), green, kiosks, undefined, 'bancas'), true, 450);
  setup(b.instanced(g, new THREE.BoxGeometry(3.4, 0.1, 1.2), yellow, awnings, undefined, 'bancas-toldo'), false, 350);
}

/**
 * Caminhos de terra: da parada ao endereço mais perto (até 170 m), em linha reta pela grama. Atravessar uma
 * pista pode (é assim na vida real); atravessar prédio, não.
 */
function buildDirtPaths(b: CityBuilder, g: THREE.Object3D, stops: BusStop[]): void {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8f6142, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const blocked = (x: number, z: number) => !b.isFree(x, z) && !b.roadRects.some((r) => inRect({ minX: r.minX - 4, maxX: r.maxX + 4, minZ: r.minZ - 4, maxZ: r.maxZ + 4 }, x, z));
  for (const st of stops) {
    let best: { x: number; z: number } | null = null;
    let bestD = 170;
    for (const a of b.addresses) {
      const d = Math.hypot(a.x - st.x, a.z - st.z);
      if (d > 25 && d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (!best) continue;
    // Começa um pouco ao lado do abrigo e para antes do endereço (que fica em calçada/estacionamento).
    const dx = (best.x - st.x) / bestD;
    const dz = (best.z - st.z) / bestD;
    const x0 = st.x + dx * 4;
    const z0 = st.z + dz * 4;
    const len = bestD - 10;
    let ok = true;
    for (let s = 8; s < len - 4 && ok; s += 6) if (blocked(x0 + dx * s, z0 + dz * s)) ok = false;
    if (!ok) continue;
    const path = new THREE.Mesh(new THREE.PlaneGeometry(1.6, len).rotateX(-Math.PI / 2), mat);
    path.position.set(x0 + (dx * len) / 2, 0.03, z0 + (dz * len) / 2);
    path.rotation.y = Math.atan2(dx, dz);
    path.receiveShadow = true;
    path.userData.noCollision = true;
    path.userData.surface = 'grass';
    path.userData.drape = 'deform';
    path.userData.cullDistance = 400;
    path.name = 'caminho-de-terra';
    g.add(path);
  }
}
