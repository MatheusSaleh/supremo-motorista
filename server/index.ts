// Servidor do multiplayer (modo livre): salas de até ROOM_SIZE jogadores; repassa o estado de cada um
// para os outros da sala. Não simula nada (cada cliente manda no próprio carro).
//
//   node server/index.ts              (Node 24+: roda TypeScript direto)
//
// Variáveis de ambiente:
//   PORT=8787                         porta local (o Nginx faz o wss:// público e repassa para cá)
//   ALLOWED_ORIGINS=https://a,https://b   origens aceitas (padrão: o site e a Vercel; localhost e rede local sempre)
//   MAX_CLIENTS=200                   conexões simultâneas no servidor inteiro
//   SIM_LATENCY_MS=0 SIM_LOSS=0       só para testes: atraso (ms) e perda (0..1) no repasse do estado
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  ROOM_SIZE,
  SEND_RATE,
  cleanName,
  cleanWants,
  isPursuersPacket,
  isVec3,
  PURSUER_SIDES,
  stampClientState,
  type ClientMessage,
  type PeerInfo,
  type ServerMessage,
} from '../src/net/protocol.ts';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_CLIENTS = Number(process.env.MAX_CLIENTS ?? 200);
const SIM_LATENCY_MS = Number(process.env.SIM_LATENCY_MS ?? 0);
const SIM_LOSS = Number(process.env.SIM_LOSS ?? 0);
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ??
  'https://www.matheussaleh.com.br,https://matheussaleh.com.br,https://supremo-motorista.vercel.app,app://game'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
/** Sem "hello" válido nesse tempo, a conexão cai. */
const HELLO_TIMEOUT_MS = 5000;
/**
 * Ping do próprio WebSocket a cada intervalo; quem não responder ao anterior cai. O navegador responde
 * sozinho, mesmo com a aba em segundo plano (quando o jogo para de mandar estado).
 */
const PING_INTERVAL_MS = 10_000;
/**
 * Mensagens por segundo aceitas; acima disso, descarta e, se insistir, derruba. O anfitrião manda o
 * próprio estado e o dos perseguidores (2 × SEND_RATE), mais eventos: a folga cobre isso.
 */
const RATE_LIMIT = SEND_RATE * 4;
const MAX_PAYLOAD = 1024;

interface Client {
  ws: WebSocket;
  id: number;
  name: string;
  room: Room | null;
  /** Garagem do jogador na sala (0 a ROOM_SIZE − 1). */
  garage: number;
  alive: boolean;
  tokens: number;
  strikes: number;
}

interface Room {
  id: number;
  clients: Set<Client>;
  /** Quem simula os perseguidores da sala (o mais antigo; troca quando ele sai). */
  host: Client | null;
}

const rooms: Room[] = [];
let nextClientId = 1;
let nextRoomId = 1;

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Desenvolvimento: localhost e endereços de rede local (jogar de outro PC da mesma rede), qualquer porta.
  return /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin);
}

function send(c: Client, msg: ServerMessage): void {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: ServerMessage, except?: Client): void {
  const text = JSON.stringify(msg);
  for (const other of room.clients) if (other !== except && other.ws.readyState === other.ws.OPEN) other.ws.send(text);
}

function relay(room: Room, data: Uint8Array, from: Client): void {
  const go = () => {
    for (const other of room.clients) if (other !== from && other.ws.readyState === other.ws.OPEN) other.ws.send(data);
  };
  if (SIM_LOSS > 0 && Math.random() < SIM_LOSS) return;
  if (SIM_LATENCY_MS > 0) setTimeout(go, SIM_LATENCY_MS * (0.75 + Math.random() * 0.5));
  else go();
}

/** Primeira sala com vaga (ou uma nova). */
function pickRoom(): Room {
  let room = rooms.find((r) => r.clients.size < ROOM_SIZE);
  if (!room) {
    room = { id: nextRoomId++, clients: new Set(), host: null };
    rooms.push(room);
  }
  return room;
}

function peerOf(c: Client): PeerInfo {
  return { id: c.id, name: c.name };
}

function join(c: Client, name: string | null): void {
  c.name = name ?? `Motorista ${c.id}`;
  const room = pickRoom();
  c.room = room;
  // Menor garagem livre (quem sai libera a dele para o próximo).
  const taken = new Set([...room.clients].map((o) => o.garage));
  c.garage = 0;
  while (taken.has(c.garage)) c.garage++;
  room.clients.add(c);
  room.host ??= c;
  send(c, { type: 'welcome', id: c.id, room: room.id, peers: [...room.clients].filter((o) => o !== c).map(peerOf), host: room.host.id, garage: c.garage });
  broadcast(room, { type: 'join', peer: peerOf(c) }, c);
  log(`entrou #${c.id} "${c.name}" na sala ${room.id}, garagem ${c.garage + 1} (${room.clients.size}/${ROOM_SIZE})`);
}

function leave(c: Client): void {
  const room = c.room;
  if (!room) return;
  c.room = null;
  room.clients.delete(c);
  broadcast(room, { type: 'leave', id: c.id });
  if (room.host === c) {
    room.host = room.clients.values().next().value ?? null;
    if (room.host) broadcast(room, { type: 'host', id: room.host.id });
  }
  if (room.clients.size === 0) rooms.splice(rooms.indexOf(room), 1);
  log(`saiu #${c.id} da sala ${room.id} (${room.clients.size}/${ROOM_SIZE})`);
}

/** Balde de fichas: RATE_LIMIT por segundo. Estourar repetidamente derruba a conexão. */
function allow(c: Client): boolean {
  if (c.tokens >= 1) {
    c.tokens -= 1;
    return true;
  }
  if (++c.strikes > RATE_LIMIT * 5) {
    send(c, { type: 'error', reason: 'rate' });
    c.ws.close(1008, 'rate');
  }
  return false;
}

function onMessage(c: Client, raw: RawData, isBinary: boolean): void {
  if (!allow(c)) return;
  if (isBinary) {
    if (!c.room) return;
    const buf = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
    const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const stamped = stampClientState(data, c.id);
    if (stamped) relay(c.room, stamped, c);
    // Poses dos perseguidores: só do anfitrião, repassadas como vieram.
    else if (c.room.host === c && isPursuersPacket(data)) relay(c.room, new Uint8Array(data), c);
    return;
  }
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw.toString()) as ClientMessage;
  } catch {
    return;
  }
  if (msg.type === 'hello' && !c.room) {
    if (msg.version !== PROTOCOL_VERSION) {
      send(c, { type: 'error', reason: 'version' });
      c.ws.close(1008, 'version');
      return;
    }
    join(c, cleanName(msg.name));
  } else if (msg.type === 'rename' && c.room) {
    c.name = cleanName(msg.name) ?? c.name;
    broadcast(c.room, { type: 'rename', peer: peerOf(c) });
  } else if (c.room) {
    onPursuitMessage(c, c.room, msg);
  }
}

/** Perseguidores compartilhados: pedidos vão para o anfitrião; eventos dele vão para o alvo. */
function onPursuitMessage(c: Client, room: Room, msg: ClientMessage): void {
  const host = room.host;
  if (!host) return;
  if (msg.type === 'want' && c !== host) {
    const w = cleanWants(msg.w);
    if (w) send(host, { type: 'want', id: c.id, w });
  } else if (msg.type === 'clear' && c !== host) {
    send(host, { type: 'clear', id: c.id });
  } else if (msg.type === 'pev' && c === host) {
    const to = [...room.clients].find((o) => o.id === msg.to);
    const kinds = ['spawn', 'escape', 'photo', 'tomato', 'ram'];
    if (to && to !== c && kinds.includes(msg.kind) && PURSUER_SIDES.includes(msg.side)) send(to, { type: 'pev', kind: msg.kind, side: msg.side });
  } else if (msg.type === 'tomato' && c === host) {
    if (isVec3(msg.from) && isVec3(msg.to) && typeof msg.dur === 'number' && msg.dur > 0 && msg.dur < 3)
      broadcast(room, { type: 'tomato', from: msg.from, to: msg.to, dur: msg.dur }, c);
  }
}

const clients = new Set<Client>();
const wss = new WebSocketServer({
  port: PORT,
  maxPayload: MAX_PAYLOAD,
  perMessageDeflate: false, // pacotes pequenos e frequentes: comprimir só gastaria CPU
  verifyClient: ({ origin }, done) => {
    if (clients.size >= MAX_CLIENTS) return done(false, 503, 'cheio');
    if (!originAllowed(origin)) return done(false, 403, 'origem');
    done(true);
  },
});

wss.on('connection', (ws) => {
  const c: Client = { ws, id: nextClientId, name: '', room: null, garage: 0, alive: true, tokens: RATE_LIMIT, strikes: 0 };
  nextClientId = (nextClientId % 65535) + 1; // o id viaja como u16
  clients.add(c);
  const helloTimer = setTimeout(() => {
    if (!c.room) ws.close(1008, 'hello');
  }, HELLO_TIMEOUT_MS);
  ws.on('message', (raw, isBinary) => onMessage(c, raw, isBinary));
  ws.on('pong', () => (c.alive = true));
  ws.on('close', () => {
    clearTimeout(helloTimer);
    clients.delete(c);
    leave(c);
  });
  ws.on('error', () => ws.terminate());
});

// Recarrega as fichas do limite de mensagens.
setInterval(() => {
  for (const c of clients) {
    c.tokens = Math.min(RATE_LIMIT, c.tokens + RATE_LIMIT / 4);
    c.strikes = Math.max(0, c.strikes - RATE_LIMIT / 4);
  }
}, 250);

// Derruba quem sumiu sem fechar a conexão (internet caiu, computador dormiu).
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, PING_INTERVAL_MS);

function log(text: string): void {
  console.log(`${new Date().toISOString()} ${text}`);
}

log(`multiplayer ouvindo na porta ${PORT} (origens: ${ALLOWED_ORIGINS.join(', ')}; localhost e rede local liberados)`);
if (SIM_LATENCY_MS || SIM_LOSS) log(`simulando atraso de ${SIM_LATENCY_MS} ms e perda de ${SIM_LOSS * 100}%`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    for (const c of clients) c.ws.close(1001, 'desligando');
    wss.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
