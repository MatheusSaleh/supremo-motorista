// Layout da "Brasília condensada" (metros). Única fonte de coordenadas do gerador.
// Convenção: Eixo Monumental ao longo de Z. −Z = leste (Congresso, Praça, Lago); +Z = oeste
// (Rodoviária, Eixão, superquadras). −X = norte; +X = sul (Catedral, aeroporto, Lago Sul).
// A Esplanada e a Praça estão em escala real; as distâncias entre bairros são comprimidas.

export const BOUNDS = { minX: -2300, maxX: 2300, minZ: -2600, maxZ: 2500 };

export const ROAD = { main: 24, local: 12 } as const;

// Eixo Monumental: duas pistas (N e S) com gramado central.
export const EIXO = {
  lawnHalfWidth: 125,
  innerWalk: 4,
  outerWalk: 8,
  curb: 0.15,
  /** Trecho com calçadas (ao longo do gramado). */
  walkStartZ: -756,
  walkEndZ: 930,
  /** As pistas seguem da orla (sul do lago) até o Eixão. */
  startZ: -1368,
  endZ: 1048,
};
export const ROAD_INNER = EIXO.lawnHalfWidth + EIXO.innerWalk; // 129
export const ROAD_CENTER = ROAD_INNER + ROAD.main / 2; // 141
export const ROAD_OUTER = ROAD_INNER + ROAD.main; // 153
export const WALK_OUTER = ROAD_OUTER + EIXO.outerWalk; // 161

export const ESPLANADA = {
  ministry: { w: 100, h: 38, d: 17, xStart: 175, perSide: 8, zFirst: -650, zLast: -100 },
  palacesZ: -735,
  congressZ: -900,
  congressFrontRoadZ: -768,
  cathedral: { x: 215, z: 150 },
  rodoviaria: { z: 960, w: 240, d: 60, h: 8 },
  feira: { minX: -320, maxX: -178, minZ: 890, maxZ: 1030 },
};

export const PRACA = {
  roadZ: -1012,
  plaza: { minX: -125, maxX: 125, minZ: -1300, maxZ: -1026 },
  tribunal: { x: 236, z: -1150, w: 60, d: 84, h: 14 },
  palacio: { x: -236, z: -1150, w: 60, d: 84, h: 14 },
};

/**
 * Garagens do Tribunal: rua de serviço ao longo de X (saindo da pista do Eixo) com GARAGES.count
 * garagens, metade de cada lado, de frente para a rua. A garagem 0 (a primeira, do lado +Z) é a do jogo
 * solo; no multiplayer o servidor dá uma a cada jogador da sala (src/net/protocol.ts → ROOM_SIZE).
 */
export const GARAGES = {
  roadZ: -1262,
  count: 8,
  /** Centro (X) das primeiras garagens, perto do Eixo, e a distância entre uma e a seguinte. */
  firstX: 197,
  spacing: 48,
  /** Largura (ao longo da rua), profundidade e altura de cada garagem; 5 vagas de 8 m. */
  w: 44,
  d: 16,
  h: 5,
  /** Da beira da rua até a frente aberta da garagem. */
  gap: 2,
};

export interface GarageLayout {
  index: number;
  /** Centro em planta. */
  x: number;
  z: number;
  /** +1: garagem do lado +Z da rua (abre para −Z); −1: lado −Z (abre para +Z). */
  side: 1 | -1;
}

export function garageLayout(index: number): GarageLayout {
  const side: 1 | -1 = index % 2 === 0 ? 1 : -1;
  const x = GARAGES.firstX + Math.floor(index / 2) * GARAGES.spacing;
  const z = GARAGES.roadZ + side * (6 + GARAGES.gap + GARAGES.d / 2);
  return { index, x, z, side };
}

/** Onde a rua de serviço termina (depois da última garagem). */
export function garageRoadEndX(): number {
  return garageLayout(GARAGES.count - 1).x + GARAGES.w / 2 + 6;
}

// Lago Paranoá (a leste) e Lago Sul (península a sudeste).
export const LAKE = {
  shoreZ: -1450, // margem norte/oeste do lago
  shoreX: 900, // margem da península do Lago Sul
  waterLevel: -0.8,
  bedY: -4,
  shoreRoadZ: -1380,
  /** Vai até o limite oeste (M5: clubes da orla norte e píeres além do Alvorada). */
  shoreRoad: { minX: -2250, maxX: 2200 },
  restaurants: { firstX: -650, spacing: 110, count: 5 },
};
export const LAGO_SUL = {
  /** A terceira rua (M5) leva mansões até perto do limite leste. A ligação só une as duas primeiras. */
  roadsX: [1060, 1500, 1940],
  roadEndZ: -2500,
  connectorZ: -2000,
  lotRows: { firstZ: -1490, spacing: 72, last: -2460 },
};

export const EIXAO = {
  z: 1060,
  minX: -2250,
  maxX: 2250,
  tesourinhas: [-1500, -800, 800, 1500],
  // Lombada-viaduto: rampa suave + "kicker" mais inclinado no fim (rende saltos); tabuleiro curto.
  hump: { height: 6.5, run: 45, kick: 15, kickRise: 3.4, deck: 18 },
  crossRoad: { minZ: 990, maxZ: 1760 },
};
/** Superquadras 100 (a oeste do Eixão), com acesso pela transversal ou pelo Eixo mais próximo do centro. */
export const SUPERQUADRAS = {
  centersX: [-1850, -1150, -400, 400, 1150, 1850],
  centerZ: 1440,
  size: 300,
  /** Eixo (x) da via de onde sai a rua de acesso de cada quadra, na mesma ordem de centersX. */
  accessX: [-1500, -800, -153, 153, 800, 1500],
  /** Faixas de comércio local nos vãos entre quadras (centro em x; espelhadas na asa Norte). */
  comercioX: [670, 900, 1400, 1600, 2125],
};

export const AIRPORT = {
  roadX: 1700,
  viaZ: 400,
  terminal: { x: 1795, z: 180, w: 60, d: 360, h: 18 },
  apron: { minX: 1830, maxX: 2060, minZ: -320, maxZ: 680 },
  runway: { x: 2170, w: 45, minZ: -420, maxZ: 720 },
  tower: { x: 1800, z: -110 },
};

// ---------------------------------------------------------------------------
// Marcos reais (só como cenário; ver regras de conteúdo). Posições inspiradas na geografia real,
// comprimidas como o resto do mapa.
// ---------------------------------------------------------------------------

/** Via local ao sul da Esplanada (liga orla, setor de autarquias, setor bancário e o Eixão). */
export const VIA_SUL = { x: 470, minZ: -1368, maxZ: 1048 };

export const MARCOS = {
  // Setor de autarquias (sudeste)
  tst: { x: 560, z: -880, w: 36, d: 150, h: 30 },
  pgr: { x: 600, z: -1180 },
  // Setor bancário/autarquias (sul, perto da Rodoviária)
  inss: { x: 540, z: 640, w: 22, d: 70, h: 56 },
  banco: { x: 545, z: 830, w: 30, d: 30, h: 92 },
  // Setor cultural sul (ao lado da Catedral)
  museu: { x: 300, z: 560, r: 38 },
  biblioteca: { x: 300, z: 720, w: 34, d: 90, h: 22 },
  // Faixa 600 Sul, de frente para a L2 (ver ASAS)
  pf: { x: 1150, z: 300, w: 124, d: 70, h: 70 },
  // Setor cultural norte
  teatro: { x: -330, z: 640, w: 64, d: 130, h: 30 },
  // Beira do lago (norte)
  alvorada: { x: -1650, z: -1300, w: 34, d: 110, h: 9 },
  // Eixo Monumental a oeste do Eixão
  torreTv: { x: 0, z: 1620 },
  estadio: { x: -560, z: 1990, a: 150, b: 122 },
  qg: { cx: -1460, cz: 2150, r: 230, arc: 1.9 },
  // Ponte sobre o lago: da orla norte até a península do Lago Sul
  ponte: { x1: 380, z1: -1450, x2: 900, z2: -2000, width: 24 },
};


/** Via local ao norte da Esplanada (espelho da Via Sul): liga a orla, a L4, a L2 e o Eixão. */
export const VIA_NORTE = { x: -470, minZ: -1368, maxZ: 1048 };

/**
 * Asas Norte e Sul a leste do Eixão (−Z), do Eixão até a orla (M2 do plano de densificação).
 * Faixas ao longo de X, do Eixão para o lago: quadras 200, via L1, quadras 400, L2, faixa 600, L3,
 * faixa 800, L4 e, depois, clubes/embaixadas (M5). Em X, as quadras ficam entre as transversais das
 * tesourinhas (±800, ±1500), que agora descem até a L4 (e as de ±1500 até a orla).
 * `x` dos slots é o centro na asa Sul; a asa Norte usa os mesmos valores com sinal trocado onde cabe.
 */
export const ASAS = {
  roads: {
    l1Z: 700, // local, entre as quadras 200 e 400 (acesso às duas)
    l2Z: 400, // principal (no lado Sul já existe: é a via do aeroporto)
    l3Z: 100, // local, entre as faixas 600 e 800
    l4Z: -300, // principal, antes dos clubes e embaixadas
    /** Transversais das tesourinhas: descem até a L4; as de ±1500 seguem até a orla. */
    crossX: [800, 1500],
  },
  q200: { z: 875, size: 250 },
  q400: { z: 550, size: 220 },
  faixa600: { minZ: 140, maxZ: 362 },
  faixa800: { minZ: -262, maxZ: 70 },
  /** Centros (X) das quadras em cada asa. */
  slots: {
    sul: { q200: [995, 1305], q400: [995, 1305] },
    norte: { q200: [-995, -1305, -1695, -2005], q400: [-995, -1305, -1695, -2005] },
  },
  /** Faixas de comércio local (entre quadras vizinhas), centro em X. */
  comercio: { sul: [1150], norte: [-1150, -1850] },
  /** Quadra 200 isolada além do aeroporto (acesso pela via do aeroporto, a oeste dela). */
  q200Aeroporto: { x: 1880, size: 250 },
  /** Extensão das faixas 600/800 em X (a parte perto do Eixo fica para os setores centrais, M3). */
  lotesX: { sul: [820, 1680], norte: [-2240, -820] },
};

/**
 * Setores centrais (M3 do plano de densificação), definidos na asa Sul (x > 0); a asa Norte usa o espelho
 * (x → −x), salvo onde há um retângulo próprio. Ficam entre o Eixo, as Vias Sul/Norte, as transversais de
 * ±800 e o Eixão; os marcos que já existem (INSS, banco, TST, PGR, Catedral…) são contornados sozinhos.
 */
export const CENTRO = {
  /** Setor Bancário: torres de vidro, dos dois lados da L1. */
  bancario: [
    { minX: 485, maxX: 785, minZ: 712, maxZ: 1040 },
    { minX: 485, maxX: 785, minZ: 414, maxZ: 688 },
  ],
  /** Setor Comercial: prédios médios entre a L3 e a L2 (+ um trecho ao norte, entre a L2 e o Teatro). */
  comercial: { minX: 485, maxX: 785, minZ: 112, maxZ: 388 },
  comercialNorteExtra: { minX: -458, maxX: -172, minZ: 414, maxZ: 566 },
  /** Setor Hoteleiro: entre o Eixão e as superquadras, com uma rua de serviço no meio. */
  hoteleiro: { minX: 170, maxX: 760, minZ: 1086, maxZ: 1246, roadZ: 1166 },
  /** Setor de Diversões: galeria (Sul) e shopping (Norte), ao lado da Rodoviária. */
  diversoesSul: { minX: 180, maxX: 450, minZ: 795, maxZ: 1030 },
  diversoesNorte: { minX: -455, maxX: -190, minZ: 718, maxZ: 882 },
  /** Autarquias: atrás da Catedral, anexos dos ministérios, faixa L3–L4 e o trecho até a orla. */
  autarquias: {
    centroSul: { minX: 262, maxX: 458, minZ: -90, maxZ: 382 },
    centroNorte: { minX: -458, maxX: -172, minZ: -90, maxZ: 382 },
    anexos: { minX: 288, maxX: 458, minZ: -650, maxZ: -110 },
    l3l4: { minX: 482, maxX: 788, minZ: -288, maxZ: 88 },
    orla: { minX: 482, maxX: 788, minZ: -1360, maxZ: -312 },
  },
};

/**
 * Faixa oeste (M4 do plano de densificação), além das superquadras 100 (z 1260–1620):
 * quadras 300, W3 com o comércio da 500, e depois, de norte a sul: Setor Militar Urbano (em volta do QG),
 * Eixo Monumental oeste (Feira da Torre, Centro de Convenções, Planetário, Memorial JK, Buriti, Cruzeiro),
 * casas geminadas da 700, Parque da Cidade e Sudoeste.
 */
export const OESTE = {
  q300: { z: 1775, size: 230, xs: [400, 1150, 1850, -1150, -1850] },
  /** W3: Sul inteira; Norte só a oeste do Estádio. */
  w3: { z: 1920, norteMaxX: -730 },
  comercio500: { minZ: 1936, maxZ: 1982 },
  smu: { minX: -2250, maxX: -760, minZ: 1995, maxZ: 2470, roadsX: [-1000, -1800], roadZ: 2440 },
  parque: { minX: 812, maxX: 1488, minZ: 1995, maxZ: 2452, roadZ: 2462 },
  sudoeste: { minX: 1515, maxX: 2250, rows: [{ z: 2120, size: 220, access: 1920, entry: 'minZ' as const }, { z: 2350, size: 200, access: 2462, entry: 'maxZ' as const }], xs: [1700, 2020] },
  casas700: { minX: 172, maxX: 786, roadsZ: [2240, 2340, 2440], rows: [[2262, -1], [2318, 1], [2362, -1], [2418, 1]] as [number, 1 | -1][] },
  buriti: { x: 330, z: 2110, w: 22, d: 120, h: 18 },
  convencoes: { x: -330, z: 1745, w: 60, d: 150, h: 16 },
  planetario: { x: -212, z: 1700, r: 16 },
  memorialJk: { x: -285, z: 2350 },
  cruzeiro: { x: 0, z: 2400 },
  /** Setor de Rádio e TV (Norte, entre o Estádio e o Memorial) e secretarias ao lado do Buriti (Sul). */
  radioTv: { minX: -390, maxX: -168, minZ: 1880, maxZ: 2470 },
  secretarias: { minX: 362, maxX: 786, minZ: 1995, maxZ: 2228 },
  feiraTorre: { r0: 46, r1: 66 },
};

/**
 * Orla (M5 do plano de densificação), entre a L4 e a avenida da orla: embaixadas de países fictícios em três
 * fileiras (duas de frente para a L4/Av. das Nações e para a via das embaixadas, uma para a via), clubes
 * de frente para a avenida da orla, a UnB no canto norte, píeres com barcos na margem norte e o "Pontão"
 * fictício (um deque sobre a água com restaurantes) entre os restaurantes da orla e a Ponte JK.
 */
export const ORLA = {
  embaixadas: {
    sul: { minX: 820, maxX: 2240 },
    norte: { minX: -1480, maxX: -820 },
    rows: [
      { minZ: -540, maxZ: -318, dir: 1 as const },
      { minZ: -748, maxZ: -556, dir: -1 as const },
      { minZ: -1000, maxZ: -772, dir: 1 as const },
    ],
    roadZ: -760,
    lotW: 120,
  },
  clubes: {
    sul: { minX: 820, maxX: 2240, minZ: -1361, maxZ: -1020 },
    norte: { minX: -2250, maxX: -820, minZ: -1361, maxZ: -1172 },
    lotW: 190,
  },
  unb: { minX: -2250, maxX: -1520, minZ: -1150, maxZ: -314, roadZ: -1160 },
  pontao: { minX: -140, maxX: 330, deckMinZ: -1540 },
  /** Píeres (x) na margem norte, com barcos; os dois últimos são a marina perto da Ponte JK. */
  piers: [-2150, -1950, -1780, -1350, -1150, -950, 640, 780],
};

/**
 * Áreas verdes abertas de propósito (fora do gramado da Esplanada): o diagnóstico de ocupação não as
 * conta como vazio.
 */
export const OPEN_ON_PURPOSE: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [
  OESTE.parque,
  // Gramado central do Eixo Monumental a oeste do Eixão (como o da Esplanada).
  { minX: -EIXO.lawnHalfWidth, maxX: EIXO.lawnHalfWidth, minZ: EIXAO.z + ROAD.main / 2, maxZ: BOUNDS.maxZ - 40 },
];
