// Protocolo do multiplayer (modo livre), compartilhado entre o jogo e o servidor (server/index.ts).
// Só sintaxe "apagável" de TypeScript e nenhum import: o Node roda este arquivo direto, sem build.
//
// Mensagens de controle (entrar, sair, nomes) vão em JSON; o estado de cada jogador, 20 vezes por
// segundo, vai em binário compacto. O servidor não interpreta o estado: só carimba o id de quem mandou
// e repassa para a sala.

export const PROTOCOL_VERSION = 3;
/** Jogadores por sala: um por garagem (src/world/city/layout.ts → GARAGES.count). */
export const ROOM_SIZE = 8;
/** Envios de estado por segundo (cada cliente). */
export const SEND_RATE = 20;
/** Apelido: tamanho máximo depois de limpo. */
export const NAME_MAX = 16;

/** Quem dirige um perseguidor (mesma ordem de PURSUER_SIDES). */
export type PursuerSideName = 'vermelhos' | 'amarelos' | 'imprensa';
export const PURSUER_SIDES: readonly PursuerSideName[] = ['vermelhos', 'amarelos', 'imprensa'];
/** Quantos perseguidores de cada lado um jogador quer agora (pelo próprio calor e suspeição). */
export type PursuitWants = Record<PursuerSideName, number>;
/** O que um perseguidor fez com o alvo dele (o anfitrião manda só para o alvo). */
export type PursuitEventKind = 'spawn' | 'escape' | 'photo' | 'tomato' | 'ram';

/** Cliente → servidor (JSON). As mensagens marcadas "anfitrião" só valem vindas dele. */
export type ClientMessage =
  | { type: 'hello'; version: number; name: string }
  | { type: 'rename'; name: string }
  /** Para o anfitrião: perseguidores que eu quero. */
  | { type: 'want'; w: PursuitWants }
  /** Para o anfitrião: tire os perseguidores de mim (imunidade da garagem, novo dia). */
  | { type: 'clear' }
  /** Anfitrião → alvo: evento de perseguição. */
  | { type: 'pev'; to: number; kind: PursuitEventKind; side: PursuerSideName }
  /** Anfitrião → todos: tomate em voo (só visual; o acerto vai por 'pev'). */
  | { type: 'tomato'; from: [number, number, number]; to: [number, number, number]; dur: number };

export interface PeerInfo {
  id: number;
  name: string;
}

/** Servidor → cliente (JSON). */
export type ServerMessage =
  /** `garage`: índice da garagem deste jogador (0 a ROOM_SIZE − 1). */
  | { type: 'welcome'; id: number; room: number; peers: PeerInfo[]; host: number; garage: number }
  | { type: 'join'; peer: PeerInfo }
  | { type: 'leave'; id: number }
  | { type: 'rename'; peer: PeerInfo }
  /** O anfitrião da sala mudou (o anterior saiu). */
  | { type: 'host'; id: number }
  | { type: 'want'; id: number; w: PursuitWants }
  | { type: 'clear'; id: number }
  | { type: 'pev'; kind: PursuitEventKind; side: PursuerSideName }
  | { type: 'tomato'; from: [number, number, number]; to: [number, number, number]; dur: number }
  | { type: 'error'; reason: 'version' | 'full' | 'rate' };

/** Bits de `flags` no estado. */
export const FLAG = {
  ON_FOOT: 1 << 0,
  BRAKE: 1 << 1,
  REVERSE: 1 << 2,
  HORN: 1 << 3,
  TURBO: 1 << 4,
} as const;

/** Estado de um jogador: o carro (dirigindo) ou o próprio Josué (a pé, só a posição vale). */
export interface PlayerState {
  flags: number;
  /** Índice do carro em FLEET. */
  vehicle: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Velocidade para frente (m/s, negativa em ré). */
  speed: number;
  /** Esterço das rodas dianteiras (rad). */
  steer: number;
}

/** Tipos das mensagens binárias (1º byte). */
const KIND_STATE = 1;
const KIND_PURSUERS = 2;
/** Bytes do estado sem cabeçalho: flags, carro, posição (3×f32), rotação (4×i16), velocidade (i16), esterço (i8). */
const PAYLOAD = 1 + 1 + 12 + 8 + 2 + 1;
/** Cliente → servidor: tipo + estado. */
export const CLIENT_STATE_BYTES = 1 + PAYLOAD;
/** Servidor → cliente: tipo + id (u16) + estado. */
export const SERVER_STATE_BYTES = 1 + 2 + PAYLOAD;

const Q = 32767;
const clampUnit = (v: number) => Math.max(-1, Math.min(1, v));

function writePayload(view: DataView, o: number, s: PlayerState): void {
  view.setUint8(o, s.flags & 0xff);
  view.setUint8(o + 1, s.vehicle & 0xff);
  view.setFloat32(o + 2, s.x, true);
  view.setFloat32(o + 6, s.y, true);
  view.setFloat32(o + 10, s.z, true);
  view.setInt16(o + 14, Math.round(clampUnit(s.qx) * Q), true);
  view.setInt16(o + 16, Math.round(clampUnit(s.qy) * Q), true);
  view.setInt16(o + 18, Math.round(clampUnit(s.qz) * Q), true);
  view.setInt16(o + 20, Math.round(clampUnit(s.qw) * Q), true);
  view.setInt16(o + 22, Math.round(Math.max(-327, Math.min(327, s.speed)) * 100), true);
  view.setInt8(o + 24, Math.round(clampUnit(s.steer) * 127));
}

function readPayload(view: DataView, o: number): PlayerState {
  return {
    flags: view.getUint8(o),
    vehicle: view.getUint8(o + 1),
    x: view.getFloat32(o + 2, true),
    y: view.getFloat32(o + 6, true),
    z: view.getFloat32(o + 10, true),
    qx: view.getInt16(o + 14, true) / Q,
    qy: view.getInt16(o + 16, true) / Q,
    qz: view.getInt16(o + 18, true) / Q,
    qw: view.getInt16(o + 20, true) / Q,
    speed: view.getInt16(o + 22, true) / 100,
    steer: view.getInt8(o + 24) / 127,
  };
}

export function encodeClientState(s: PlayerState): ArrayBuffer {
  const buf = new ArrayBuffer(CLIENT_STATE_BYTES);
  const view = new DataView(buf);
  view.setUint8(0, KIND_STATE);
  writePayload(view, 1, s);
  return buf;
}

/** Usado pelo servidor: valida o pacote do cliente e devolve a versão com o id, pronta para repassar. */
export function stampClientState(data: Uint8Array, id: number): Uint8Array | null {
  if (data.byteLength !== CLIENT_STATE_BYTES || data[0] !== KIND_STATE) return null;
  const out = new Uint8Array(SERVER_STATE_BYTES);
  out[0] = KIND_STATE;
  out[1] = id & 0xff;
  out[2] = (id >> 8) & 0xff;
  out.set(data.subarray(1), 3);
  // Posição precisa ser número finito (NaN/Infinity quebrariam a física de quem recebe).
  const view = new DataView(out.buffer);
  for (const o of [3 + 2, 3 + 6, 3 + 10]) if (!Number.isFinite(view.getFloat32(o, true))) return null;
  return out;
}

export function decodeServerState(buf: ArrayBuffer): { id: number; state: PlayerState } | null {
  if (buf.byteLength !== SERVER_STATE_BYTES) return null;
  const view = new DataView(buf);
  if (view.getUint8(0) !== KIND_STATE) return null;
  return { id: view.getUint16(1, true), state: readPayload(view, 3) };
}

/**
 * Limpa um apelido: só letras (com acento), números, espaço, hífen, ponto e sublinhado; espaços
 * repetidos viram um; corta em NAME_MAX. Vazio → null (o servidor dá um nome padrão).
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return name || null;
}

// ---------------------------------------------------------------------------
// Perseguidores compartilhados: o anfitrião manda, 20x por segundo, a pose de todos os que estão em cena.

/** Tamanho do pool de perseguidores (igual em todos os clientes: data/factions.ts → PURSUER_MODELS). */
export const MAX_NET_PURSUERS = 8;

/** Bits de `flags` de um perseguidor. Os "toggle" trocam de valor a cada buzinada/foto (eventos curtos). */
export const PURSUER_FLAG = {
  BRAKE: 1 << 0,
  REVERSE: 1 << 1,
  LEAVING: 1 << 2,
  HORN_TOGGLE: 1 << 3,
  PHOTO_TOGGLE: 1 << 4,
} as const;

export interface PursuerNetState {
  /** Posição no pool (cada slot tem um modelo de carro fixo). */
  slot: number;
  side: PursuerSideName;
  /** Id do jogador perseguido. */
  target: number;
  flags: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  speed: number;
  steer: number;
}

/** slot, lado, alvo (u16), flags, posição (3×f32), rotação (4×i16), velocidade (i16), esterço (i8). */
const PURSUER_BYTES = 1 + 1 + 2 + 1 + 12 + 8 + 2 + 1;

export function encodePursuers(list: readonly PursuerNetState[]): ArrayBuffer {
  const n = Math.min(list.length, MAX_NET_PURSUERS);
  const buf = new ArrayBuffer(2 + n * PURSUER_BYTES);
  const view = new DataView(buf);
  view.setUint8(0, KIND_PURSUERS);
  view.setUint8(1, n);
  for (let i = 0; i < n; i++) {
    const p = list[i];
    const o = 2 + i * PURSUER_BYTES;
    view.setUint8(o, p.slot);
    view.setUint8(o + 1, PURSUER_SIDES.indexOf(p.side));
    view.setUint16(o + 2, p.target, true);
    view.setUint8(o + 4, p.flags & 0xff);
    view.setFloat32(o + 5, p.x, true);
    view.setFloat32(o + 9, p.y, true);
    view.setFloat32(o + 13, p.z, true);
    view.setInt16(o + 17, Math.round(clampUnit(p.qx) * Q), true);
    view.setInt16(o + 19, Math.round(clampUnit(p.qy) * Q), true);
    view.setInt16(o + 21, Math.round(clampUnit(p.qz) * Q), true);
    view.setInt16(o + 23, Math.round(clampUnit(p.qw) * Q), true);
    view.setInt16(o + 25, Math.round(Math.max(-327, Math.min(327, p.speed)) * 100), true);
    view.setInt8(o + 27, Math.round(clampUnit(p.steer) * 127));
  }
  return buf;
}

/** Usado pelo servidor: pacote de perseguidores bem formado (o conteúdo é do anfitrião). */
export function isPursuersPacket(data: Uint8Array): boolean {
  if (data.byteLength < 2 || data[0] !== KIND_PURSUERS) return false;
  const n = data[1];
  if (n > MAX_NET_PURSUERS || data.byteLength !== 2 + n * PURSUER_BYTES) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < n; i++) {
    const o = 2 + i * PURSUER_BYTES;
    if (view.getUint8(o) >= MAX_NET_PURSUERS || view.getUint8(o + 1) >= PURSUER_SIDES.length) return false;
    for (const k of [5, 9, 13]) if (!Number.isFinite(view.getFloat32(o + k, true))) return false;
  }
  return true;
}

export function decodePursuers(buf: ArrayBuffer): PursuerNetState[] | null {
  const data = new Uint8Array(buf);
  if (!isPursuersPacket(data)) return null;
  const view = new DataView(buf);
  const out: PursuerNetState[] = [];
  for (let i = 0; i < data[1]; i++) {
    const o = 2 + i * PURSUER_BYTES;
    out.push({
      slot: view.getUint8(o),
      side: PURSUER_SIDES[view.getUint8(o + 1)],
      target: view.getUint16(o + 2, true),
      flags: view.getUint8(o + 4),
      x: view.getFloat32(o + 5, true),
      y: view.getFloat32(o + 9, true),
      z: view.getFloat32(o + 13, true),
      qx: view.getInt16(o + 17, true) / Q,
      qy: view.getInt16(o + 19, true) / Q,
      qz: view.getInt16(o + 21, true) / Q,
      qw: view.getInt16(o + 23, true) / Q,
      speed: view.getInt16(o + 25, true) / 100,
      steer: view.getInt8(o + 27) / 127,
    });
  }
  return out;
}

/** Usado pelo servidor e pelo anfitrião: pedido de perseguidores com números sãos. */
export function cleanWants(raw: unknown): PursuitWants | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out = { vermelhos: 0, amarelos: 0, imprensa: 0 };
  for (const side of PURSUER_SIDES) {
    const v = r[side];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[side] = Math.max(0, Math.min(MAX_NET_PURSUERS, Math.floor(v)));
  }
  return out;
}

/** Vetor [x, y, z] de números finitos (tomates). */
export function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}
