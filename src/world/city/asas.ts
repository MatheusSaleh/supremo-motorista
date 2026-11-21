// Asas Norte e Sul a leste do Eixão (M2 do plano de densificação, docs/PLANO-MAPA.md): vias L1–L4, Via
// Norte, transversais das tesourinhas até a orla, superquadras 200 (6 andares) e 400 (3 andares) sobre
// pilotis, comércio local entre as quadras e as faixas institucionais 600/800.
import { t } from '../../core/i18n';
import { sectorName } from '../../data/addresses';
import type { CityBuilder } from './builder';
import { AIRPORT, ASAS, EIXAO, LAKE, ROAD, VIA_NORTE, VIA_SUL, WALK_OUTER } from './layout';
import { pickLot, type CityKit } from './quadras';

export function buildAsas(b: CityBuilder, kit: CityKit): void {
  const g = b.group('asas', kit.group);
  const R = ASAS.roads;

  // --- Vias -------------------------------------------------------------------
  b.road(g, 'local', VIA_NORTE.x, VIA_NORTE.minZ, VIA_NORTE.x, VIA_NORTE.maxZ, 'left');
  // L2 Norte (a Sul é a via do aeroporto, que já existe na mesma linha).
  b.road(g, 'main', -WALK_OUTER, R.l2Z, EIXAO.minX, R.l2Z, 'both');
  for (const [z, kind, lamps] of [
    [R.l1Z, 'local', 'right'],
    [R.l3Z, 'local', 'right'],
    [R.l4Z, 'main', 'both'],
  ] as const) {
    b.road(g, kind, VIA_SUL.x, z, AIRPORT.roadX, z, lamps);
    b.road(g, kind, VIA_NORTE.x, z, EIXAO.minX, z, lamps);
  }
  for (const s of [-1, 1]) {
    for (const x of R.crossX) {
      b.road(g, 'local', s * x, EIXAO.crossRoad.minZ, s * x, R.l4Z, 'none');
      if (x === 1500) b.road(g, 'local', s * x, R.l4Z, s * x, LAKE.shoreRoadZ + ROAD.main / 2, 'none');
    }
  }
  const signX = (x: number) => x + ROAD.local / 2 + 4;
  for (const [s, wing] of [
    [1, 'Sul'],
    [-1, 'Norte'],
  ] as const) {
    b.signs.push({ x: s * 640, z: R.l1Z + ROAD.local / 2 + 4, yaw: 0, title: `L1 ${wing}`, subtitle: t('sector.CLQ') });
    b.signs.push({ x: s * 640, z: R.l2Z + ROAD.main / 2 + 4, yaw: 0, title: `L2 ${wing}`, subtitle: sectorName('SGA') });
    b.signs.push({ x: s * 640, z: R.l4Z + ROAD.main / 2 + 4, yaw: 0, title: `L4 ${wing}`, subtitle: sectorName('SGA') });
  }
  b.signs.push({ x: signX(VIA_NORTE.x), z: 300, yaw: Math.PI, title: 'Via Norte', subtitle: sectorName('SAA') });

  // --- Superquadras -------------------------------------------------------------
  for (const [wingKey, wing] of [
    ['sul', 'S'],
    ['norte', 'N'],
  ] as const) {
    const slots = ASAS.slots[wingKey];
    slots.q200.forEach((cx, i) =>
      kit.superquadra({ cx, cz: ASAS.q200.z, size: ASAS.q200.size, floors: 6, entry: 'minZ', access: R.l1Z, wing, number: 202 + i * 2 }, g),
    );
    slots.q400.forEach((cx, i) =>
      kit.superquadra({ cx, cz: ASAS.q400.z, size: ASAS.q400.size, floors: 3, entry: 'maxZ', access: R.l1Z, wing, number: 402 + i * 2 }, g),
    );
    // Comércio local entre quadras vizinhas (nas duas faixas).
    ASAS.comercio[wingKey].forEach((cx, i) => {
      const n = 202 + i * 4;
      for (const [q, base] of [
        [ASAS.q200, n],
        [ASAS.q400, n + 200],
      ] as const) {
        kit.comercio(g, cx, q.z - q.size / 2 + 12, q.z + q.size / 2 - 12, wing, `${base}/${base + 2}`);
      }
    });
    b.landmarks.push({ name: t(wing === 'S' ? 'place.asaSul' : 'place.asaNorte'), x: slots.q200[1], z: ASAS.q200.z , minor: true });
  }
  const qa = ASAS.q200Aeroporto;
  kit.superquadra({ cx: qa.x, cz: ASAS.q200.z, size: qa.size, floors: 6, entry: 'minX', access: AIRPORT.roadX, wing: 'S', number: 210 }, g);

  // --- Faixas institucionais 600 e 800 -------------------------------------------
  // Cada faixa tem duas fileiras de lotes: uma de frente para a via de cima (+Z), outra para a de baixo.
  for (const [wing, [minX, maxX]] of [
    ['S', ASAS.lotesX.sul],
    ['N', ASAS.lotesX.norte],
  ] as const) {
    let lote = 1;
    for (const [band, big, quadra] of [
      [ASAS.faixa600, false, 600],
      [ASAS.faixa800, true, 800],
    ] as const) {
      const w = big ? 160 : 112;
      const gap = big ? 22 : 16;
      const mid = (band.minZ + band.maxZ) / 2;
      for (const dir of [1, -1] as const) {
        const minZ = dir > 0 ? mid + 6 : band.minZ;
        const maxZ = dir > 0 ? band.maxZ : mid - 6;
        let x = minX;
        while (x + w <= maxX) {
          const r = { minX: x, maxX: x + w, minZ, maxZ };
          if (!b.isRectFree(r)) {
            x += 10;
            continue;
          }
          kit.lot(g, pickLot(b.rng, big), r, dir, { wing, quadra: quadra + (dir > 0 ? 0 : 1) * 2 + Math.floor(Math.abs(x) / 400) * 10, lote: lote++ });
          x += w + gap;
        }
      }
    }
  }
}
