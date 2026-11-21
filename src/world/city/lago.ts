// Lago Paranoá (a leste da Praça), orla com restaurantes e Lago Sul (península a sudeste) com mansões.
import * as THREE from 'three';
import { t } from '../../core/i18n';
import { formatAddress, RESTAURANT_KEYS, sectorName } from '../../data/addresses';
import type { WaterArea } from '../Level';
import { canvasTexture } from './materials';
import { placeMatrix, rectOf, type CityBuilder, type Rect } from './builder';
import { BOUNDS, LAGO_SUL, LAKE, MARCOS, ORLA, ROAD } from './layout';

/** Deque fica ao lado da casa do restaurante (acesso direto pelo calçadão). */
const DECK_OFFSET = 10;

/** Retângulos de água (para o World/Game saberem onde "afoga"). */
export const LAKE_RECT: Rect = { minX: BOUNDS.minX, maxX: LAKE.shoreX, minZ: BOUNDS.minZ, maxZ: LAKE.shoreZ };

export function lakeWater(): WaterArea[] {
  return [{ ...LAKE_RECT, level: LAKE.waterLevel }];
}

export function buildLago(b: CityBuilder): void {
  const g = b.group('lago');
  const m = b.mats;
  const r = LAKE_RECT;
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;

  // Fundo (colide) e espelho d'água (só visual).
  const bed = b.box(g, w, 1, d, m.lakeBed, cx, LAKE.bedY - 0.5, cz, 'fundo-do-lago');
  bed.castShadow = false;
  bed.userData.noDrape = true;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), m.water);
  water.position.set(cx, LAKE.waterLevel, cz);
  water.userData.noCollision = true;
  water.receiveShadow = true;
  water.name = 'agua';
  water.userData.noDrape = true;
  g.add(water);
  b.occupy(r);

  buildShore(b, g);
  buildOrla(b, g);
  buildLagoSul(b, g);
}

/** Mureta baixa ao longo das margens (dá para pular com rampa, não para cair sem querer). */
function buildShore(b: CityBuilder, g: THREE.Object3D): void {
  const m = b.mats;
  const h = 0.7;
  const t = 0.5;
  const rest = LAKE.restaurants;
  // Margem norte (z = shoreZ), com aberturas nos deques dos restaurantes.
  const gaps: [number, number][] = [];
  for (let i = 0; i < rest.count; i++) {
    const x = rest.firstX + i * rest.spacing + DECK_OFFSET;
    gaps.push([x - 9, x + 9]);
  }
  gaps.push([MARCOS.ponte.x1 - 22, MARCOS.ponte.x1 + 22]); // cabeceira norte da ponte
  for (const x of ORLA.piers) gaps.push([x - 4, x + 4]); // píeres (orla.ts)
  gaps.push([ORLA.pontao.minX, ORLA.pontao.maxX]); // deque do "Pontão" (orla.ts)
  gaps.sort((a, c) => a[0] - c[0]);
  let x0 = BOUNDS.minX;
  for (const [a, c] of [...gaps, [LAKE.shoreX, LAKE.shoreX] as [number, number]]) {
    if (a > x0) b.box(g, a - x0, h, t, m.concrete, (x0 + a) / 2, h / 2, LAKE.shoreZ + t / 2);
    x0 = c;
  }
  // Margem da península (x = shoreX), com abertura na cabeceira sul da ponte.
  const gapZ = MARCOS.ponte.z2;
  for (const [z0, z1] of [[BOUNDS.minZ, gapZ - 22], [gapZ + 22, LAKE.shoreZ]]) {
    b.box(g, t, h, z1 - z0, m.concrete, LAKE.shoreX + t / 2, h / 2, (z0 + z1) / 2);
  }
}

function buildOrla(b: CityBuilder, g: THREE.Object3D): void {
  const m = b.mats;
  const rz = LAKE.shoreRoadZ;
  b.road(g, 'main', LAKE.shoreRoad.minX, rz, LAKE.shoreRoad.maxX, rz, 'left');
  // Calçadão entre a avenida e a água.
  const walk = { minX: LAKE.shoreRoad.minX, maxX: LAKE.shoreX, minZ: LAKE.shoreZ, maxZ: rz - ROAD.main / 2 - 30 };
  b.slab(g, walk, 0.12, m.walk);

  const rest = LAKE.restaurants;
  const awningColors = [0xd94f3d, 0x2f7fc1, 0xe0a030, 0x3c9d5d, 0x8e5bb0];
  for (let i = 0; i < rest.count; i++) {
    const x = rest.firstX + i * rest.spacing;
    const name = t(RESTAURANT_KEYS[i]);
    // Casa do restaurante (em terra) + deque sobre a água + toldo.
    const houseZ = LAKE.shoreZ + 16;
    const houseX = x - 12;
    const deckX = x + DECK_OFFSET;
    b.box(g, 22, 5, 12, m.white, houseX, 2.5, houseZ);
    const awning = b.box(g, 24, 0.3, 4, new THREE.MeshStandardMaterial({ color: awningColors[i], roughness: 0.8 }), houseX, 4.2, houseZ - 8);
    awning.userData.noCollision = true;
    b.box(g, 18, 0.4, 26, m.wood, deckX, -0.2, LAKE.shoreZ - 13).userData.surface = 'wood'; // deque (topo no nível do chão)
    for (const px of [-8, 8]) for (const pz of [-24, -2]) b.box(g, 0.4, 4, 0.4, m.wood, deckX + px, -2.2, LAKE.shoreZ + pz);
    nameBoard(b, g, name, houseX, 6.4, houseZ + 6.05);
    b.occupy(rectOf(houseX, houseZ, 26, 16, 3));
    b.address(`restaurante-${i + 1}`, formatAddress('SRL', [{ kind: 'trecho', v: 2 }, { kind: 'lote', v: i + 1 }]), x, houseZ + 12);
  }
  b.landmarks.push({ name: t('place.orla'), x: rest.firstX + rest.spacing * 2, z: LAKE.shoreZ + 10 });
  b.signs.push({ x: rest.firstX - 40, z: rz - ROAD.main / 2 - 4, yaw: Math.PI, title: `SRL · ${t('addr.trecho', { v: 2 })}`, subtitle: sectorName('SRL') });
}

/** Letreiro com o nome do restaurante (textura de canvas), voltado para +Z (avenida). */
function nameBoard(b: CityBuilder, g: THREE.Object3D, text: string, x: number, y: number, z: number): void {
  const tex = canvasTexture(512, 96, (ctx) => {
    ctx.fillStyle = '#1d2a33';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#ffe9b0';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 50, 490);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(16, 3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  board.position.set(x, y, z);
  board.userData.noCollision = true;
  board.userData.cullDistance = 500;
  g.add(board);
  b.occupy(rectOf(x, z, 16, 1));
}

function buildLagoSul(b: CityBuilder, g: THREE.Object3D): void {
  const m = b.mats;
  const L = LAGO_SUL;
  const top = LAKE.shoreRoadZ - ROAD.main / 2; // as ruas saem da avenida da orla
  for (const x of L.roadsX) b.road(g, 'local', x, top, x, L.roadEndZ, 'right');
  b.road(g, 'local', L.roadsX[0] + ROAD.local / 2, L.connectorZ, L.roadsX[1] - ROAD.local / 2, L.connectorZ, 'none');

  // Lotes de mansões: dos dois lados de cada rua, em fileiras.
  const bodies: THREE.Matrix4[] = [];
  const bodyColors: THREE.Color[] = [];
  const upper: THREE.Matrix4[] = [];
  const pools: THREE.Matrix4[] = [];
  const walls: THREE.Matrix4[] = [];
  const palette = [0xf4efe6, 0xe9dcc6, 0xdfe8ea, 0xf1e2d8, 0xe6e6e6];
  let casa = 1;
  let conj = 1;
  for (let z = L.lotRows.firstZ; z >= L.lotRows.last; z -= L.lotRows.spacing) {
    if (Math.abs(z - L.connectorZ) < 40) continue;
    for (const roadX of L.roadsX) {
      for (const side of [-1, 1]) {
        const lotX = roadX + side * 62;
        if (lotX - 50 < LAKE.shoreX) continue; // não invade a água
        const yaw = side > 0 ? -Math.PI / 2 : Math.PI / 2; // frente para a rua
        const s = 0.85 + b.rng() * 0.4;
        // Casa perto da rua, piscina nos fundos (lado oposto à rua).
        const houseX = lotX - side * 8;
        bodies.push(new THREE.Matrix4().compose(new THREE.Vector3(houseX, 3, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, 1, s)));
        bodyColors.push(new THREE.Color(palette[Math.floor(b.rng() * palette.length)]));
        upper.push(placeMatrix(houseX + side * 2, 7.5, z + (b.rng() - 0.5) * 6, yaw));
        pools.push(placeMatrix(lotX + side * 22, 0.05, z, yaw));
        // Muro baixo na frente do lote (com portão: dois trechos).
        for (const dz of [-18, 18]) walls.push(placeMatrix(roadX + side * (ROAD.local / 2 + 4), 1, z + dz, Math.PI / 2));
        b.occupy(rectOf(lotX, z, 90, 60));
        b.address(`mansao-${conj}-${casa}`, formatAddress('SHIP', [{ kind: 'raw', v: `QL ${String(conj * 2 + 5).padStart(2, '0')}` }, { kind: 'conjunto', v: conj }, { kind: 'casa', v: casa }]), roadX + side * (ROAD.local / 2 + 3), z);
        casa++;
      }
    }
    if (casa > 16) {
      casa = 1;
      conj++;
    }
  }
  b.instanced(g, new THREE.BoxGeometry(26, 6, 18), m.tinted, bodies, bodyColors, 'mansoes');
  b.instanced(g, new THREE.BoxGeometry(14, 3, 12), m.white, upper, undefined, 'mansoes-andar');
  const poolMesh = b.instanced(g, new THREE.PlaneGeometry(8, 14).rotateX(-Math.PI / 2), m.pool, pools, undefined, 'piscinas');
  poolMesh.userData.noCollision = true;
  poolMesh.castShadow = false;
  b.instanced(g, new THREE.BoxGeometry(24, 2, 0.4), m.concrete, walls, undefined, 'muros');

  b.landmarks.push({ name: t('place.lagoSul'), x: (L.roadsX[0] + L.roadsX[1]) / 2, z: (LAKE.shoreZ + L.roadEndZ) / 2 });
  b.signs.push({ x: L.roadsX[0] - ROAD.local / 2 - 4, z: top - 10, yaw: Math.PI, title: 'SHIP · QL 07–15', subtitle: sectorName('SHIP') });
}
