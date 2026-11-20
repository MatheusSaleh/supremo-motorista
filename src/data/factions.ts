// Facções FICTÍCIAS da sátira: Vermelhos e Amarelos. Sem partidos, pessoas ou símbolos reais.
// Territórios, cores e as regras da polarização (Fase 8). Textos no i18n (pt-BR.factions.ts).
//
// Regra de conteúdo: territórios não incluem marcos/instituições reais (QG, Estádio, Teatro…); só bairros
// residenciais genéricos e a feira.
import type { StringKey } from '../core/i18n';

export type FactionId = 'vermelhos' | 'amarelos';

export interface Faction {
  id: FactionId;
  nameKey: StringKey;
  /** Cor da pintura dos carros e das bandeiras. */
  color: number;
  /** Cor de destaque (detalhes da bandeira, HUD). */
  accent: number;
  css: string;
}

export const FACTIONS: Record<FactionId, Faction> = {
  vermelhos: { id: 'vermelhos', nameKey: 'faction.vermelhos', color: 0xb3141b, accent: 0xffffff, css: '#e0353c' },
  amarelos: { id: 'amarelos', nameKey: 'faction.amarelos', color: 0xe8b400, accent: 0x1c1c1c, css: '#f2c200' },
};
export const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];

export const other = (f: FactionId): FactionId => (f === 'vermelhos' ? 'amarelos' : 'vermelhos');

export interface Territory {
  faction: FactionId;
  nameKey: StringKey;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Eixos do mapa: −X norte, +X sul, −Z leste, +Z oeste (ver world/city/layout.ts). */
export const TERRITORIES: Territory[] = [
  // Superquadras da asa norte (entre o Eixão e o limite oeste, longe do QG e do Estádio).
  { faction: 'vermelhos', nameKey: 'territory.asaNorte', minX: -2300, maxX: -220, minZ: 1110, maxZ: 1800 },
  { faction: 'vermelhos', nameKey: 'territory.feira', minX: -340, maxX: -160, minZ: 870, maxZ: 1050 },
  // Superquadras da asa sul e o Lago Sul (mansões).
  { faction: 'amarelos', nameKey: 'territory.asaSul', minX: 220, maxX: 2300, minZ: 1110, maxZ: 1800 },
  { faction: 'amarelos', nameKey: 'territory.lagoSul', minX: 920, maxX: 2300, minZ: -2600, maxZ: -1460 },
];

export function territoryAt(x: number, z: number): Territory | null {
  return TERRITORIES.find((t) => x > t.minX && x < t.maxX && z > t.minZ && z < t.maxZ) ?? null;
}

/** Polarização: um "calor" de 0 a 100 por facção. Valores por segundo salvo indicação. */
export const POLARIZATION = {
  max: 100,
  /** No território, com passageiro da facção rival. */
  rivalPassenger: 4,
  /** No território, com passageiro da própria facção (bem recebido: esfria). */
  friendlyPassenger: -1.5,
  /** No território, sem passageiro ou com passageiro neutro (carro oficial já é suspeito). */
  officialCar: 0.6,
  /** No território acima de 90 km/h. */
  speeding: 1.5,
  /** Buzinando no território. */
  horn: 1,
  /** Por poste/árvore/placa derrubado no território (evento). */
  propBroken: 6,
  /** Por batida num carro da facção com o carro oficial acima de `hitMinKmh` (o jogador partiu para cima). */
  hitFactionCar: 8,
  hitMinKmh: 25,
  /** Ao entregar um passageiro: a facção dele esfria, a rival esquenta (eventos). */
  deliveredOwn: -12,
  deliveredRival: 5,
  /** Quando um perseguidor desiste (despistado): despistar tem que valer a pena. */
  escaped: -25,
  /** Esfriamento: fora de qualquer território / dentro, sem provocar. */
  decayNeutral: 1.6,
  decayInside: 0.3,
  /** Parar na garagem do Tribunal ("imunidade"): zera tudo. */
  garageReset: true,
  /** Calor mínimo para cada perseguidor da facção (1º, 2º, 3º…). */
  pursuerThresholds: [30, 60, 85],
};

/** Perseguidores ao mesmo tempo (somando as facções), por qualidade gráfica. */
export const MAX_PURSUERS = { baixa: 2, media: 3, alta: 4, ultra: 4, personalizada: 3 } as const;

/** Comportamento dos perseguidores. */
export const PURSUIT = {
  /** Fração da velocidade máxima do modelo (o jogador precisa conseguir fugir). */
  speedMul: 0.9,
  /** Distância de surgimento (m), fora da vista quando possível. */
  spawnMin: 140,
  spawnMax: 280,
  /** Intervalo mínimo entre surgimentos (s), e o respiro depois de despistar alguém. */
  spawnInterval: 3,
  escapeBreather: 10,
  /** Desiste se ficar a mais disto do jogador por `loseTime` segundos (despistado). */
  loseDistance: 420,
  loseTime: 4,
  /** Perto assim, larga a rota e vai direto no carro (m). */
  attackDistance: 45,
  /** Tomates: alcance (m) e intervalo (s). */
  tomatoRange: 26,
  tomatoInterval: 2.6,
  /** Bônus da corrida por perseguidor despistado com passageiro a bordo (R$). */
  escapeBonus: 30,
};

/**
 * Modelos da frota reaproveitados pelos perseguidores (versões leves), na ordem dos carros do pool. No
 * multiplayer o pool é dividido pela sala inteira (no máximo src/net/protocol.ts → MAX_NET_PURSUERS).
 */
export const PURSUER_MODELS = ['fusao', 'equinocio', 'corolinha', 'sw4', 'equinocio', 'fusao'];
