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
  garage: { x: 236, z: -1262, w: 16, d: 44, h: 5 }, // aberta para −X (lado da pista); 5 vagas
};

// Lago Paranoá (a leste) e Lago Sul (península a sudeste).
export const LAKE = {
  shoreZ: -1450, // margem norte/oeste do lago
  shoreX: 900, // margem da península do Lago Sul
  waterLevel: -0.8,
  bedY: -4,
  shoreRoadZ: -1380,
  shoreRoad: { minX: -1900, maxX: 2200 },
  restaurants: { firstX: -650, spacing: 110, count: 5 },
};
export const LAGO_SUL = {
  roadsX: [1060, 1500],
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
export const SUPERQUADRAS = {
  centersX: [-1850, -1150, -400, 400, 1150, 1850],
  centerZ: 1440,
  size: 360,
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
  // Caminho do aeroporto
  pf: { x: 1150, z: 480, w: 70, d: 60, h: 28 },
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
