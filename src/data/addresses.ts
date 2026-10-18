// Setores e formato de endereços "no estilo de Brasília" — siglas e números FICTÍCIOS.
// Os nomes por extenso ficam no dicionário de i18n (chaves sector.*); aqui só a estrutura.
import { t, type StringKey } from '../core/i18n';

export type SectorId = 'SPTP' | 'EMB' | 'SRF' | 'EPT' | 'SQB' | 'SRL' | 'SHIP' | 'SAE' | 'SAA' | 'SBC' | 'SCR' | 'SMB';

export const SECTORS: Record<SectorId, { sigla: string; nameKey: StringKey }> = {
  SPTP: { sigla: 'SPTP', nameKey: 'sector.SPTP' },
  EMB: { sigla: 'EMB', nameKey: 'sector.EMB' },
  SRF: { sigla: 'SRF', nameKey: 'sector.SRF' },
  EPT: { sigla: 'EPT', nameKey: 'sector.EPT' },
  SQB: { sigla: 'SQB', nameKey: 'sector.SQB' },
  SRL: { sigla: 'SRL', nameKey: 'sector.SRL' },
  SHIP: { sigla: 'SHIP', nameKey: 'sector.SHIP' },
  SAE: { sigla: 'SAE', nameKey: 'sector.SAE' },
  SAA: { sigla: 'SAA', nameKey: 'sector.SAA' },
  SBC: { sigla: 'SBC', nameKey: 'sector.SBC' },
  SCR: { sigla: 'SCR', nameKey: 'sector.SCR' },
  SMB: { sigla: 'SMB', nameKey: 'sector.SMB' },
};

/** Partes de um endereço (cada uma vira "Bloco C", "Casa 12"…, traduzidas via i18n). */
export type AddressPart =
  | { kind: 'quadra'; v: string | number }
  | { kind: 'bloco'; v: string | number }
  | { kind: 'conjunto'; v: string | number }
  | { kind: 'casa'; v: string | number }
  | { kind: 'lote'; v: string | number }
  | { kind: 'trecho'; v: string | number }
  | { kind: 'raw'; v: string };

const PART_KEYS: Record<Exclude<AddressPart['kind'], 'raw'>, StringKey> = {
  quadra: 'addr.quadra',
  bloco: 'addr.bloco',
  conjunto: 'addr.conjunto',
  casa: 'addr.casa',
  lote: 'addr.lote',
  trecho: 'addr.trecho',
};

/** Ex.: formatAddress('SQB', 'N', [{kind:'quadra', v:106}, {kind:'bloco', v:'C'}]) → "SQB-N 106 Bloco C". */
export function formatAddress(sector: SectorId, parts: AddressPart[], wing?: 'N' | 'S'): string {
  const sigla = SECTORS[sector].sigla + (wing ? `-${wing}` : '');
  const rest = parts.map((p) => (p.kind === 'raw' ? p.v : t(PART_KEYS[p.kind], { v: p.v })));
  return [sigla, ...rest].join(' ');
}

export function sectorName(sector: SectorId): string {
  return t(SECTORS[sector].nameKey);
}

/** Letras de bloco usadas nas quadras e na Esplanada. */
export const BLOCK_LETTERS = 'ABCDEFGHIJKLMNOP';

/** Restaurantes fictícios da orla (chaves de i18n). */
export const RESTAURANT_KEYS: StringKey[] = [
  'restaurant.1',
  'restaurant.2',
  'restaurant.3',
  'restaurant.4',
  'restaurant.5',
];
