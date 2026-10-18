// Ponte JK (só cenário + rota): tabuleiro diagonal sobre o lago, da orla norte até a península do
// Lago Sul, com três arcos assimétricos que cruzam o tabuleiro em diagonal e estais até as bordas.
import * as THREE from 'three';
import { t } from '../../core/i18n';
import type { CityBuilder } from './builder';
import { LAGO_SUL, LAKE, MARCOS, ROAD } from './layout';

export function buildPonte(b: CityBuilder): void {
  const p = MARCOS.ponte;
  const g = b.group('ponte-jk');
  const dx = p.x2 - p.x1;
  const dz = p.z2 - p.z1;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz); // direção do tabuleiro (0 = +Z)
  const dir = new THREE.Vector3(dx / len, 0, dz / len);
  const side = new THREE.Vector3(dir.z, 0, -dir.x); // perpendicular no plano
  const mid = new THREE.Vector3((p.x1 + p.x2) / 2, 0, (p.z1 + p.z2) / 2);

  // Tabuleiro (colide) com topo no nível do chão; guarda-corpos.
  const deck = b.box(g, p.width + 2, 1.6, len, b.mats.concrete, mid.x, -0.8, mid.z, 'tabuleiro');
  deck.rotation.y = yaw;
  deck.userData.surface = 'asphalt';
  for (const s of [-1, 1]) {
    const rail = b.box(g, 0.4, 1.1, len, b.mats.metal, mid.x + side.x * s * (p.width / 2 + 0.6), 0.55, mid.z + side.z * s * (p.width / 2 + 0.6));
    rail.rotation.y = yaw;
  }
  // Faixas pintadas.
  const geo = new THREE.PlaneGeometry(ROAD.main, len);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / 12));
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(yaw);
  const road = new THREE.Mesh(geo, b.mats.road);
  road.position.set(mid.x, 0.02, mid.z);
  road.userData.noCollision = true;
  road.userData.surface = 'asphalt';
  road.receiveShadow = true;
  g.add(road);

  // Três arcos: cada um nasce numa borda do tabuleiro e pousa na outra, cruzando em diagonal.
  const arcMat = new THREE.MeshStandardMaterial({ color: 0xf3f3ef, roughness: 0.4, metalness: 0.3 });
  const cablePts: number[] = [];
  for (let k = 0; k < 3; k++) {
    const t0 = (k + 0.08) / 3;
    const t1 = (k + 0.92) / 3;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const s = i / 24;
      const along = (t0 + (t1 - t0) * s - 0.5) * len;
      const lateral = (-1 + 2 * s) * (p.width / 2 + 1.5) * (k % 2 ? -1 : 1);
      const h = 62 * Math.sin(Math.PI * s);
      pts.push(mid.clone().addScaledVector(dir, along).addScaledVector(side, lateral).setY(h));
    }
    const arch = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 1.5, 6, false), arcMat);
    arch.castShadow = true;
    arch.userData.noCollision = true;
    g.add(arch);
    // Estais: de pontos do arco até as duas bordas do tabuleiro.
    for (let i = 3; i <= 21; i += 2) {
      const a = pts[i];
      for (const s of [-1, 1]) {
        const along = a.clone().sub(mid).dot(dir);
        const edge = mid.clone().addScaledVector(dir, along).addScaledVector(side, s * (p.width / 2 + 0.6)).setY(0.6);
        cablePts.push(a.x, a.y, a.z, edge.x, edge.y, edge.z);
      }
    }
  }
  const cables = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3)),
    new THREE.LineBasicMaterial({ color: 0xdedede }),
  );
  cables.userData.noCollision = true;
  g.add(cables);

  // Ligações: orla → cabeceira norte; cabeceira sul → rua do Lago Sul.
  b.road(g, 'local', p.x1, LAKE.shoreRoadZ - ROAD.main / 2, p.x1, p.z1, 'none');
  b.road(g, 'main', p.x2, p.z2, LAGO_SUL.roadsX[0] - ROAD.local / 2, p.z2, 'none');

  b.landmarks.push({ name: t('place.ponteJk'), x: mid.x, z: mid.z });
}
