// Aeroporto simplificado (ao sul) e as vias que o ligam à Esplanada, ao Eixão e ao Lago Sul.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { t } from '../../core/i18n';
import { formatAddress, sectorName } from '../../data/addresses';
import { rectOf, type CityBuilder } from './builder';
import { AIRPORT, EIXAO, LAKE, ROAD, WALK_OUTER } from './layout';

export function buildAeroporto(b: CityBuilder): void {
  const g = b.group('aeroporto');
  const m = b.mats;
  const A = AIRPORT;

  // Vias: Esplanada → aeroporto (z = viaZ) e a avenida norte–sul que passa pelo aeroporto,
  // ligando a orla/Lago Sul ao Eixão.
  b.road(g, 'main', WALK_OUTER, A.viaZ, A.roadX - ROAD.main / 2, A.viaZ, 'right');
  b.road(g, 'main', A.roadX, LAKE.shoreRoadZ + ROAD.main / 2, A.roadX, EIXAO.z - ROAD.main / 2, 'left');

  // Pátio, pista de pouso e área de embarque.
  const ap = A.apron;
  b.slab(g, ap, 0.08, m.concreteDark);
  b.occupy(ap);
  const rw = A.runway;
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(rw.w, rw.maxZ - rw.minZ), m.runway);
  const uv = runway.geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * ((rw.maxZ - rw.minZ) / 60));
  runway.geometry.rotateX(-Math.PI / 2);
  runway.position.set(rw.x, 0.03, (rw.minZ + rw.maxZ) / 2);
  runway.receiveShadow = true;
  runway.userData.noCollision = true;
  g.add(runway);
  b.occupy(rectOf(rw.x, (rw.minZ + rw.maxZ) / 2, rw.w + 30, rw.maxZ - rw.minZ));
  // Taxiway ligando pátio e pista.
  b.slab(g, { minX: ap.maxX, maxX: rw.x - rw.w / 2, minZ: 160, maxZ: 200 }, 0.06, m.concreteDark);

  // Terminal: caixa envidraçada sob uma cobertura com beiral, meio-fio de embarque do lado da avenida.
  const tm = A.terminal;
  b.box(g, tm.w, tm.h - 4, tm.d, m.glass, tm.x, (tm.h - 4) / 2, tm.z, 'terminal');
  b.box(g, tm.w + 16, 2, tm.d + 10, m.white, tm.x, tm.h - 3, tm.z);
  const curb = { minX: A.roadX + ROAD.main / 2, maxX: tm.x - tm.w / 2, minZ: tm.z - tm.d / 2, maxZ: tm.z + tm.d / 2 };
  b.slab(g, curb, 0.12, m.walk);
  b.occupy(rectOf(tm.x, tm.z, tm.w + 16, tm.d + 10, 4));
  b.occupy(curb);

  // Torre de controle.
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 40, 12), m.concrete);
  tower.position.set(A.tower.x, 20, A.tower.z);
  tower.castShadow = tower.receiveShadow = true;
  g.add(tower);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(7, 5, 6, 8), m.glass);
  cab.position.set(A.tower.x, 43, A.tower.z);
  cab.castShadow = true;
  g.add(cab);
  b.occupy(rectOf(A.tower.x, A.tower.z, 16, 16));

  // Aviões estacionados (sem pintura de companhia real).
  const plane = createPlaneGeometry();
  for (const [x, z] of [[1925, 60], [1925, 300]]) {
    const mesh = new THREE.Mesh(plane, m.white);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = -Math.PI / 2; // nariz para o terminal (−X)
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.collider = 'convex';
    g.add(mesh);
  }

  b.landmarks.push({ name: t('place.aeroporto'), x: tm.x, z: tm.z });
  b.address('aeroporto-embarque', formatAddress('SAE', [{ kind: 'raw', v: t('addr.terminal', { v: 1 }) }, { kind: 'raw', v: `· ${t('addr.embarque')}` }]), A.roadX + ROAD.main / 2 + 6, tm.z - 80);
  b.address('aeroporto-desembarque', formatAddress('SAE', [{ kind: 'raw', v: t('addr.terminal', { v: 1 }) }, { kind: 'raw', v: `· ${t('addr.desembarque')}` }]), A.roadX + ROAD.main / 2 + 6, tm.z + 80);
  b.signs.push(
    { x: A.roadX - ROAD.main / 2 - 4, z: A.viaZ - 40, yaw: Math.PI / 2, title: `SAE · ${t('addr.terminal', { v: 1 })}`, subtitle: sectorName('SAE') },
    { x: WALK_OUTER + 30, z: A.viaZ - ROAD.main / 2 - 4, yaw: Math.PI, title: `SAE → ${t('place.aeroporto')}`, subtitle: sectorName('SAE') },
  );
}

/** Avião low-poly genérico (fuselagem + asas + empenagem), nariz para +Z, rodas no chão. */
function createPlaneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const fuselage = new THREE.CylinderGeometry(2, 2, 34, 12).rotateX(Math.PI / 2).translate(0, 4.5, 0);
  const nose = new THREE.ConeGeometry(2, 5, 12).rotateX(Math.PI / 2).translate(0, 4.5, 19.5);
  const wing = new THREE.BoxGeometry(32, 0.4, 6).translate(0, 3.6, 1);
  const tail = new THREE.BoxGeometry(10, 0.3, 3).translate(0, 5, -15.5);
  const fin = new THREE.BoxGeometry(0.4, 6, 4).translate(0, 8.5, -15.5);
  const gear = new THREE.BoxGeometry(1, 2.6, 1).translate(0, 1.3, 2);
  parts.push(fuselage, nose, wing, tail, fin, gear);
  // mergeGeometries exige os mesmos atributos: remove índices para uniformizar.
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}
