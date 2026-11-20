// Conexão com o servidor do multiplayer: WebSocket nativo do navegador, reconexão automática e
// tradução das mensagens do protocolo. Se o servidor estiver fora, só fica tentando de tempos em
// tempos; o jogo continua normal (solo).
import {
  PROTOCOL_VERSION,
  decodePursuers,
  decodeServerState,
  encodeClientState,
  type ClientMessage,
  type PeerInfo,
  type PlayerState,
  type PursuerNetState,
  type ServerMessage,
} from './protocol';

export type NetStatus = 'off' | 'connecting' | 'online' | 'offline' | 'outdated';

export interface NetClientEvents {
  status(status: NetStatus): void;
  /** A conexão caiu ou foi desligada: some com todos os jogadores remotos. */
  reset(): void;
  welcome(id: number, peers: PeerInfo[], host: number, garage: number): void;
  /** O anfitrião da sala mudou. */
  host(id: number): void;
  join(peer: PeerInfo): void;
  leave(id: number): void;
  rename(peer: PeerInfo): void;
  state(id: number, state: PlayerState): void;
  /** Perseguidores compartilhados (ver Multiplayer). */
  message(msg: Extract<ServerMessage, { type: 'want' | 'clear' | 'pev' | 'tomato' }>): void;
  pursuers(states: PursuerNetState[]): void;
}

export class NetClient {
  private ws: WebSocket | null = null;
  private wanted = false;
  private name = '';
  private retryDelay: number;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _status: NetStatus = 'off';

  constructor(
    private readonly url: string,
    private readonly events: NetClientEvents,
    private readonly retry: { min: number; max: number },
  ) {
    this.retryDelay = retry.min;
  }

  get status(): NetStatus {
    return this._status;
  }

  get connected(): boolean {
    return this._status === 'online';
  }

  /** Liga/desliga a conexão. Trocar o apelido com a conexão aberta só renomeia. */
  setEnabled(enabled: boolean, name: string): void {
    const renamed = name !== this.name;
    this.name = name;
    if (enabled && !this.wanted) {
      this.wanted = true;
      this.retryDelay = this.retry.min;
      this.connect();
    } else if (!enabled && this.wanted) {
      this.wanted = false;
      this.clearRetry();
      this.ws?.close(1000, 'off');
      this.ws = null;
      this.events.reset();
      this.setStatus('off');
    } else if (enabled && renamed && this.connected) {
      this.sendJson({ type: 'rename', name });
    }
  }

  sendState(state: PlayerState): void {
    this.sendBinary(encodeClientState(state));
  }

  /** Mensagens frequentes: descartadas se a conexão estiver engasgada (a próxima já vem com o estado novo). */
  sendBinary(buf: ArrayBuffer): void {
    if (this.connected && this.ws!.bufferedAmount < 8192) this.ws!.send(buf);
  }

  send(msg: ClientMessage): void {
    if (this.connected) this.sendJson(msg);
  }

  dispose(): void {
    this.setEnabled(false, this.name);
  }

  private connect(): void {
    this.clearRetry();
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => this.sendJson({ type: 'hello', version: PROTOCOL_VERSION, name: this.name });
    ws.onmessage = (e: MessageEvent) => {
      if (e.data instanceof ArrayBuffer) {
        const s = decodeServerState(e.data);
        if (s) this.events.state(s.id, s.state);
        else {
          const list = decodePursuers(e.data);
          if (list) this.events.pursuers(list);
        }
        return;
      }
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'welcome':
          this.retryDelay = this.retry.min;
          this.setStatus('online');
          this.events.welcome(msg.id, msg.peers, msg.host, msg.garage);
          break;
        case 'host':
          this.events.host(msg.id);
          break;
        case 'want':
        case 'clear':
        case 'pev':
        case 'tomato':
          this.events.message(msg);
          break;
        case 'join':
          this.events.join(msg.peer);
          break;
        case 'leave':
          this.events.leave(msg.id);
          break;
        case 'rename':
          this.events.rename(msg.peer);
          break;
        case 'error':
          // Versão antiga do jogo (a página precisa recarregar): não adianta insistir.
          if (msg.reason === 'version') {
            this.wanted = false;
            this.setStatus('outdated');
          }
          break;
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // conexão antiga, já substituída ou desligada
      this.ws = null;
      this.events.reset();
      if (this.wanted) this.scheduleRetry();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleRetry(): void {
    this.setStatus('offline');
    this.clearRetry();
    this.retryTimer = setTimeout(() => this.connect(), this.retryDelay * 1000);
    this.retryDelay = Math.min(this.retry.max, this.retryDelay * 2);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private sendJson(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setStatus(s: NetStatus): void {
    if (s === this._status) return;
    this._status = s;
    this.events.status(s);
  }
}
