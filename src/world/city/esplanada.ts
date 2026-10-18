// Esplanada dos Ministérios (escala real aproximada): Eixo Monumental, ministérios, palácios,
// Congresso, Catedral, Rodoviária e a feira.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { t } from '../../core/i18n';
import { BLOCK_LETTERS, formatAddress, sectorName } from '../../data/addresses';
import { placeMatrix, rectOf, type CityBuilder } from './builder';
import { EIXO, ESPLANADA, ROAD, ROAD_CENTER, ROAD_INNER, ROAD_OUTER, WALK_OUTER } from './layout';

export function buildEsplanada(b: CityBuilder): void {
  buildEixo(b);
  buildMinistries(b);
  buildPalaces(b);
  buildCongress(b);
  buildCathedral(b);
  buildRodoviaria(b);
  buildFeira(b);

  b.landmarks.push(
    { name: t('place.congresso'), x: 0, z: ESPLANADA.congressZ },
    { name: t('place.catedral'), x: ESPLANADA.cathedral.x, z: ESPLANADA.cathedral.z },
    { name: t('place.rodoviaria'), x: 0, z: ESPLANADA.rodoviaria.z },
    { name: t('place.itamaraty'), x: 230, z: ESPLANADA.palacesZ },
    { name: t('place.justica'), x: -230, z: ESPLANADA.palacesZ },
  );
}

function buildEixo(b: CityBuilder): void {
  const g = b.group('eixo-monumental');
  const m = b.mats;
  for (const side of [-1, 1]) {
    const x = side * ROAD_CENTER;
    // Pista contínua da orla até o Eixão (atravessa Praça, Esplanada e passa ao lado da Rodoviária).
    b.road(g, 'main', x, EIXO.startZ, x, EIXO.endZ, side > 0 ? 'right' : 'left');
    // Calçadas só ao longo do gramado.
    const len = EIXO.walkEndZ - EIXO.walkStartZ;
    const mid = (EIXO.walkEndZ + EIXO.walkStartZ) / 2;
    b.slab(g, rectOf(side * (EIXO.lawnHalfWidth + EIXO.innerWalk / 2), mid, EIXO.innerWalk, len), EIXO.curb, m.walk);
    b.slab(g, rectOf(side * (ROAD_OUTER + EIXO.outerWalk / 2), mid, EIXO.outerWalk, len), EIXO.curb, m.walk);
    b.occupy(rectOf(side * (ROAD_OUTER + EIXO.outerWalk / 2), mid, EIXO.outerWalk, len, 1));
  }
  // Transversal em frente ao Congresso (entre as bordas internas das pistas).
  const z = ESPLANADA.congressFrontRoadZ;
  b.road(g, 'main', -ROAD_INNER, z, ROAD_INNER, z, 'none');
  // Praça entre a transversal e a rampa do Congresso.
  b.slab(g, { minX: -ROAD_INNER, maxX: ROAD_INNER, minZ: z - ROAD.main / 2 - 20, maxZ: z - ROAD.main / 2 }, EIXO.curb, m.walk);

  b.signs.push(
    { x: -WALK_OUTER - 3, z: -720, yaw: Math.PI / 2, title: `EMB · ${t('addr.bloco', { v: 'A–H' })}`, subtitle: sectorName('EMB') },
    { x: WALK_OUTER + 3, z: -720, yaw: -Math.PI / 2, title: `EMB · ${t('addr.bloco', { v: 'I–P' })}`, subtitle: sectorName('EMB') },
  );
}

/** Blocos dos ministérios: InstancedMesh; letras A–H ao norte e I–P ao sul, de leste para oeste. */
function buildMinistries(b: CityBuilder): void {
  const mm = ESPLANADA.ministry;
  const m = b.mats;
  // Grupos do BoxGeometry: +X, −X, +Y, −Y, +Z, −Z. ±Z = fachadas de vidro; ±X = empenas cegas.
  const material = [m.concrete, m.concrete, m.roof, m.roof, m.glass, m.glass];
  const matrices: THREE.Matrix4[] = [];
  let letter = 0;
  for (const side of [-1, 1]) {
    for (let k = 0; k < mm.perSide; k++) {
      const z = mm.zFirst + ((mm.zLast - mm.zFirst) * k) / (mm.perSide - 1);
      const x = side * (mm.xStart + mm.w / 2);
      matrices.push(placeMatrix(x, mm.h / 2, z));
      b.occupy(rectOf(x, z, mm.w, mm.d, 4));
      const id = BLOCK_LETTERS[letter++];
      // Porta voltada para a pista do Eixo.
      b.address(`emb-${id}`, formatAddress('EMB', [{ kind: 'bloco', v: id }]), side * (mm.xStart - 6), z);
    }
  }
  b.instanced(b.root, new THREE.BoxGeometry(mm.w, mm.h, mm.d), material, matrices, undefined, 'ministerios');
}

/** Itamaraty (sul) e Palácio da Justiça (norte): caixas baixas com colunata. */
function buildPalaces(b: CityBuilder): void {
  const g = b.group('palacios');
  const z = ESPLANADA.palacesZ;
  const size = 84;
  const h = 18;
  const cols: THREE.Matrix4[] = [];
  for (const side of [-1, 1]) {
    const x = side * 230;
    b.box(g, size - 8, h - 2, size - 8, b.mats.glass, x, (h - 2) / 2, z);
    b.box(g, size, 2, size, b.mats.white, x, h - 1, z); // laje de cobertura
    const n = 13;
    for (let k = 0; k < n; k++) {
      const t = -size / 2 + 1 + (k * (size - 2)) / (n - 1);
      for (const [cx, cz] of [[t, -size / 2 + 1], [t, size / 2 - 1], [-size / 2 + 1, t], [size / 2 - 1, t]]) {
        cols.push(placeMatrix(x + cx, (h - 2) / 2, z + cz));
      }
    }
    b.occupy(rectOf(x, z, size, size, 4));
  }
  b.instanced(g, new THREE.BoxGeometry(1.4, h - 2, 1.4), b.mats.white, cols, undefined, 'colunatas');
}

function buildCongress(b: CityBuilder): void {
  const g = b.group('congresso');
  const m = b.mats;
  const cz = ESPLANADA.congressZ;
  const platform = { w: 240, h: 12, d: 80 };
  const top = platform.h;

  b.box(g, platform.w, platform.h, platform.d, m.concrete, 0, platform.h / 2, cz, 'plataforma');
  facadeGlass(b, g, platform.w - 6, platform.h - 3, 0, cz + platform.d / 2);

  // Rampa frontal até a cobertura (~11°): cunha sólida.
  const front = cz + platform.d / 2;
  const rampRun = 60;
  b.wedge(g, 'z', front + rampRun, front, 0, top, 0, 10, m.concrete);

  // Duas torres finas lado a lado (o "H").
  const tower = { w: 22, h: 100, d: 10, gap: 8 };
  const tz = cz - platform.d / 2 + 15;
  for (const side of [-1, 1]) {
    const tx = side * (tower.gap / 2 + tower.w / 2);
    b.box(g, tower.w, tower.h, tower.d, [m.concrete, m.concrete, m.roof, m.roof, m.towerGlass, m.towerGlass], tx, tower.h / 2, tz, 'torre');
  }
  b.box(g, tower.gap, 7, tower.d - 2, m.concrete, 0, tower.h * 0.55, tz);

  // Câmara: "tigela" (abertura para cima), ao sul (+X).
  const bowlR = 31;
  const flatten = 0.45;
  const pedestal = 3;
  cylinder(g, 8, pedestal, m.concrete, 60, top + pedestal / 2, cz);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(bowlR, 40, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), m.whiteDouble);
  bowl.scale.y = flatten;
  bowl.position.set(60, top + pedestal + bowlR * flatten, cz);
  bowl.castShadow = bowl.receiveShadow = true;
  g.add(bowl);

  // Senado: cúpula (abertura para baixo), ao norte (−X).
  const dome = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.white);
  dome.scale.y = 0.6;
  dome.position.set(-60, top, cz);
  dome.castShadow = dome.receiveShadow = true;
  g.add(dome);

  b.occupy(rectOf(0, cz, platform.w, platform.d, 6));
  b.occupy(rectOf(0, front + rampRun / 2, 14, rampRun, 2));
}

/** Película de vidro decorativa numa fachada voltada para +Z (sem colisão). */
function facadeGlass(b: CityBuilder, g: THREE.Object3D, w: number, h: number, x: number, z: number, facing: 1 | -1 = 1): void {
  const m = b.box(g, w, h, 0.2, b.mats.glass, x, h / 2, z + facing * 0.1);
  m.castShadow = false;
  m.userData.noCollision = true;
}

function cylinder(g: THREE.Object3D, r: number, h: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}

/** Catedral: 16 pilares curvos em hiperboloide + vidro entre eles. */
function buildCathedral(b: CityBuilder): void {
  const { x, z } = ESPLANADA.cathedral;
  const g = b.group('catedral');
  g.position.set(x, 0, z);
  const profile: [number, number][] = [
    [30, 0], [27.5, 5], [23, 12], [17.5, 19], [12.5, 26], [9, 31], [8.2, 34], [9.5, 37], [12.5, 40],
  ];
  const pillars: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const pts = profile.map(([r, y]) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    pillars.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 1.1, 5, false));
  }
  const pillarMesh = new THREE.Mesh(mergeGeometries(pillars), b.mats.white);
  pillars.forEach((p) => p.dispose());
  pillarMesh.castShadow = pillarMesh.receiveShadow = true;
  g.add(pillarMesh);

  const glass = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r - 0.3, y)), 48), b.mats.cathedralGlass);
  glass.userData.noCollision = true;
  glass.renderOrder = 1;
  g.add(glass);
  const floor = cylinder(g, 29, 0.3, b.mats.walk, 0, 0.15, 0);
  floor.castShadow = false;

  b.occupy(rectOf(x, z, 62, 62, 6));
  b.address('catedral', formatAddress('EMB', [{ kind: 'lote', v: 12 }]), x - 40, z);
}

/** Rodoviária: plataforma baixa sobre o gramado, com rampa; as pistas passam dos dois lados. */
function buildRodoviaria(b: CityBuilder): void {
  const g = b.group('rodoviaria');
  const { z, w, d, h } = ESPLANADA.rodoviaria;
  b.box(g, w, h, d, b.mats.concreteDark, 0, h / 2, z);
  facadeGlass(b, g, w - 10, h - 2, 0, z - d / 2, -1);
  const front = z - d / 2;
  const run = 45;
  b.wedge(g, 'z', front - run, front, 0, h, 0, 12, b.mats.concrete);
  b.occupy(rectOf(0, z, w, d, 4));
  b.occupy(rectOf(0, front - run / 2, 16, run, 2));
  b.address('rodoviaria', formatAddress('SRF', [{ kind: 'bloco', v: 'A' }]), 0, front - run - 6);
}

/** Feira ao norte da Rodoviária: barracas com toldos coloridos (instanciadas). */
function buildFeira(b: CityBuilder): void {
  const f = ESPLANADA.feira;
  const g = b.group('feira');
  b.slab(g, f, 0.12, b.mats.walk);
  b.occupy(f);

  const bases: THREE.Matrix4[] = [];
  const roofs: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const palette = [0xe0533d, 0x3d8be0, 0xf2c14e, 0x4fb06a, 0xe07a3d, 0x9b59b6];
  let n = 0;
  for (let x = f.minX + 12; x < f.maxX - 8; x += 16) {
    for (let z = f.minZ + 12; z < f.maxZ - 8; z += 14) {
      bases.push(placeMatrix(x, 0.6, z));
      roofs.push(placeMatrix(x, 2.6, z, (n % 2) * 0.1));
      colors.push(new THREE.Color(palette[n % palette.length]));
      n++;
    }
  }
  // Balcão (colide) + toldo em pirâmide sobre ele (só visual).
  b.instanced(g, new THREE.BoxGeometry(5, 1.2, 3), b.mats.wood, bases, undefined, 'barracas').userData.cullDistance = 900;
  const roof = b.instanced(g, new THREE.ConeGeometry(4.2, 1.6, 4).rotateY(Math.PI / 4), b.mats.tintedFlat, roofs, colors, 'toldos');
  roof.userData.noCollision = true;
  roof.userData.cullDistance = 900;

  const cx = (f.minX + f.maxX) / 2;
  const cz = (f.minZ + f.maxZ) / 2;
  b.landmarks.push({ name: t('place.feira'), x: cx, z: cz });
  for (let i = 0; i < 4; i++) {
    b.address(`feira-${i + 1}`, formatAddress('SRF', [{ kind: 'lote', v: i + 1 }]), f.maxX + 4, f.minZ + 20 + i * 32);
  }
  b.signs.push({ x: f.maxX + 4, z: f.minZ - 6, yaw: -Math.PI / 2, title: `SRF · ${t('place.feira')}`, subtitle: sectorName('SRF') });
}
