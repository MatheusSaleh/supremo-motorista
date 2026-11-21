// Setores centrais (M3 do plano de densificação, docs/PLANO-MAPA.md): Bancário, Comercial, Hoteleiro e de
// Diversões (Norte e Sul) e as Autarquias (incluindo o Setor de Autarquias Norte e os anexos dos
// ministérios). Todos os nomes de bancos, hotéis, lojas e órgãos são fictícios (pt-BR.cidade.ts).
import * as THREE from 'three';
import { t, type StringKey } from '../../core/i18n';
import { formatAddress, sectorName } from '../../data/addresses';
import { rectOf, type CityBuilder, type Rect } from './builder';
import { CENTRO, ROAD, ROAD_OUTER } from './layout';
import type { CityKit, SectorSpec } from './quadras';

const keys = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}.${i + 1}` as StringKey);
const mirror = (r: Rect): Rect => ({ minX: -r.maxX, maxX: -r.minX, minZ: r.minZ, maxZ: r.maxZ });
const center = (r: Rect) => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });

export function buildCentro(b: CityBuilder, kit: CityKit): void {
  const g = b.group('centro', kit.group);
  const C = CENTRO;

  for (const [s, wing] of [
    [1, 'S'],
    [-1, 'N'],
  ] as const) {
    const side = (r: Rect) => (s > 0 ? r : mirror(r));
    const label = (sul: StringKey, norte: StringKey) => t(s > 0 ? sul : norte);

    // --- Setor Bancário -----------------------------------------------------------
    const bank: SectorSpec = {
      cell: [100, 108],
      foot: [
        [28, 28],
        [34, 24],
        [26, 38],
      ],
      floors: [12, 25],
      styles: ['vidroVerde', 'vidroAzul', 'vidroEscuro'],
      signs: keys('bank', 6),
      signColors: { bg: '#0f2f4a', fg: '#ffffff' },
      sector: 'SBC',
      wing,
      prefix: `sbc-${wing}`,
      counter: { n: 0 },
      quadra: 3,
      parkingFill: 0.55,
    };
    for (const r of C.bancario) kit.fillSector(g, side(r), bank);
    b.landmarks.push({ name: label('place.bancarioSul', 'place.bancarioNorte'), ...center(side(C.bancario[0])) , minor: true });

    // --- Setor Comercial ------------------------------------------------------------
    const comercial: SectorSpec = {
      cell: [100, 92],
      foot: [
        [50, 18],
        [40, 22],
        [60, 16],
      ],
      floors: [6, 12],
      styles: ['pastilha', 'brise', 'vidroAzul', 'pastilha'],
      signs: keys('office', 6),
      sector: 'SCC',
      wing,
      prefix: `scc-${wing}`,
      counter: { n: 0 },
      quadra: 1,
    };
    kit.fillSector(g, side(C.comercial), comercial);
    if (s < 0) kit.fillSector(g, C.comercialNorteExtra, comercial);
    b.landmarks.push({ name: label('place.comercialSul', 'place.comercialNorte'), ...center(side(C.comercial)) , minor: true });

    // --- Setor Hoteleiro (rua de serviço no meio; as duas fileiras olham para o Eixão) -----
    const H = C.hoteleiro;
    b.road(g, 'local', s * ROAD_OUTER, H.roadZ, s * (800 - ROAD.local / 2), H.roadZ, 'right');
    const hotels: SectorSpec = {
      cell: [106, 80],
      foot: [
        [46, 16],
        [36, 20],
        [52, 15],
      ],
      floors: [10, 20],
      styles: ['hotel', 'hotel', 'vidroAzul'],
      face: -1,
      signs: keys('hotel', 8),
      signColors: { bg: '#7a1f2b', fg: '#ffe9b0' },
      sector: 'SHT',
      wing,
      prefix: `sht-${wing}`,
      counter: { n: 0 },
      quadra: 2,
      parkingFill: 0.45,
    };
    for (const [z0, z1] of [
      [H.minZ, H.roadZ - ROAD.local / 2 - 4],
      [H.roadZ + ROAD.local / 2 + 4, H.maxZ],
    ]) kit.fillSector(g, side({ minX: H.minX, maxX: H.maxX, minZ: z0, maxZ: z1 }), hotels);
    b.landmarks.push({ name: label('place.hoteleiroSul', 'place.hoteleiroNorte'), x: s * 450, z: H.roadZ , minor: true });
    b.signs.push({ x: s * 210, z: H.roadZ - ROAD.local / 2 - 4, yaw: Math.PI, title: `SHT-${wing}`, subtitle: sectorName('SHT') });

    // --- Autarquias -------------------------------------------------------------------
    const A = C.autarquias;
    const agencies: SectorSpec = {
      cell: [100, 96],
      foot: [
        [60, 18],
        [26, 46],
        [50, 20],
      ],
      floors: [5, 11],
      styles: ['brise', 'brise', 'pastilha', 'vidroEscuro'],
      signs: keys('agency', 8),
      signColors: { bg: '#f3f1ea', fg: '#1d2a33' },
      sector: 'SAA',
      wing,
      prefix: `saa-${wing}`,
      counter: { n: 0 },
      quadra: 10,
    };
    kit.fillSector(g, s > 0 ? A.centroSul : A.centroNorte, agencies);
    kit.fillSector(g, side(A.l3l4), agencies);
    kit.fillSector(g, side(A.orla), { ...agencies, cell: [100, 110] });
    // Anexos dos ministérios: blocos baixos atrás de cada fileira, sem letreiro.
    kit.fillSector(g, side(A.anexos), { ...agencies, cell: [170, 90], foot: [[70, 16]], floors: [4, 6], styles: ['brise'], signs: undefined, prefix: `anexo-${wing}`, counter: { n: 0 }, quadra: 20 });
    if (s < 0) b.landmarks.push({ name: t('place.autarquiasNorte'), ...center(mirror(A.orla)) , minor: true });
  }

  buildGaleria(b, kit, g, CENTRO.diversoesSul);
  buildShopping(b, kit, g, CENTRO.diversoesNorte);
}

/** Setor de Diversões Sul: embasamento de galeria (lojas) com quatro torres por cima e muitos letreiros. */
function buildGaleria(b: CityBuilder, kit: CityKit, g: THREE.Object3D, r: Rect): void {
  const c = center(r);
  const pw = 190;
  const pd = 110;
  const podium = b.group('galeria', g);
  kit.building(podium, c.x, c.z, pw, pd, 3, 'pastilha');
  const towers: [number, number, number][] = [
    [-pw / 2 + 20, -pd / 2 + 18, 12],
    [pw / 2 - 20, -pd / 2 + 18, 10],
    [-pw / 2 + 20, pd / 2 - 18, 9],
    [pw / 2 - 20, pd / 2 - 18, 13],
  ];
  const base = 3 * 3.6 + 0.8;
  for (const [dx, dz, floors] of towers) {
    const t0 = b.group('galeria-torre', podium);
    kit.building(t0, c.x + dx, c.z + dz, 30, 26, floors, dx < 0 ? 'brise' : 'pastilha');
    t0.position.y = base;
  }
  // Letreiros na fachada voltada para a Rodoviária (−X) e para a Via Sul (+X).
  const names: StringKey[] = ['fun.galeria', 'fun.cinema', 'shop.8', 'shop.13', 'shop.5', 'shop.11'];
  names.forEach((k, i) => {
    const sx = i % 2 === 0 ? -1 : 1;
    const z = c.z - pd / 2 + 18 + Math.floor(i / 2) * 36;
    b.letreiro(podium, t(k), c.x + sx * (pw / 2 + 0.08), 7.5, z, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 22, 2, [{ bg: '#b3261e', fg: '#fff6e0' }, { bg: '#1d4f91', fg: '#ffffff' }, { bg: '#f2c94c', fg: '#2b2b2b' }][i % 3]);
  });
  kit.parking(g, rectOf(c.x, r.minZ + 8, pw, 16), false, 0.7);
  b.address('sdv-galeria', formatAddress('SDV', [{ kind: 'quadra', v: 3 }, { kind: 'bloco', v: 'A' }], 'S'), c.x, r.minZ + 4);
  b.landmarks.push({ name: t('place.diversoesSul'), x: c.x, z: c.z , minor: true });
}

/** Setor de Diversões Norte: o shopping, um caixote horizontal enorme com estacionamento em volta. */
function buildShopping(b: CityBuilder, kit: CityKit, g: THREE.Object3D, r: Rect): void {
  const c = center(r);
  const w = 210;
  const d = 104;
  const mall = b.group('shopping', g);
  kit.building(mall, c.x + 6, c.z + 10, w, d, 5, 'vidroEscuro');
  // Faixa branca no alto e o letreiro, de frente para a Via Norte (−X) e para a L2 (−Z).
  b.letreiro(mall, t('fun.shopping'), c.x + 6, 14, c.z + 10 - d / 2 - 0.08, Math.PI, 40, 4, { bg: '#ffffff', fg: '#b3261e' });
  b.letreiro(mall, t('fun.shopping'), c.x + 6 - w / 2 - 0.08, 14, c.z + 10, -Math.PI / 2, 40, 4, { bg: '#ffffff', fg: '#b3261e' });
  kit.parking(g, rectOf(c.x, r.minZ + 8, w + 30, 16), false, 0.8);
  b.address('sdv-shopping', formatAddress('SDV', [{ kind: 'quadra', v: 2 }, { kind: 'bloco', v: 'A' }], 'N'), c.x, r.minZ + 4);
  b.landmarks.push({ name: t('place.diversoesNorte'), x: c.x, z: c.z , minor: true });
}
