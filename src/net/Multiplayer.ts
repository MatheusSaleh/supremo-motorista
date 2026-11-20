// Multiplayer (modo livre): liga a conexão (NetClient) aos jogadores remotos (RemotePlayer) e manda o
// estado do jogador local. O Game só chama os ganchos: beforePhysics, update, sendLocal e os da
// perseguição. Corridas, carreira e campanha continuam individuais.
//
// Perseguidores compartilhados: o servidor escolhe um anfitrião por sala. O computador dele roda a IA de
// todos os perseguidores (cada um atrás de quem provocou) e transmite as poses; os outros ficam em modo
// réplica (factions/Pursuers.ts). Cada jogador manda ao anfitrião quantos perseguidores o próprio calor
// e a própria suspeição pedem, e recebe dele só os eventos que o atingem (tomate, foto, batida...).
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Config } from '../config';
import { LOCAL_TARGET, type PursuitEvent, type PursuitTarget, type Pursuers } from '../factions/Pursuers';
import { NetClient, type NetStatus } from './NetClient';
import { SEND_RATE, cleanWants, encodePursuers, type PlayerState, type PursuitWants } from './protocol';
import { RemotePlayer, type RemoteAssets } from './RemotePlayer';

/** Pausado ou no menu, a posição atual ainda vai 1x por segundo (quem chega na sala já vê você). */
const IDLE_PERIOD = 1;
/** Réplica: o pedido de perseguidores vai quando muda, e de tempos em tempos mesmo sem mudar. */
const WANT_REFRESH = 3;

export type NetRole = 'offline' | 'host' | 'replica';

export interface MultiplayerInfo {
  status: NetStatus;
  /** Jogadores na sala, contando você (0 fora do ar). */
  players: number;
}

const NO_WANTS: PursuitWants = { vermelhos: 0, amarelos: 0, imprensa: 0 };

export class Multiplayer {
  private readonly client: NetClient;
  private readonly remotes = new Map<number, RemotePlayer>();
  private sendTimer = 0;
  private selfId = 0;
  private hostId = 0;
  private _role: NetRole = 'offline';
  private pursuers: Pursuers | null = null;
  /** Anfitrião: o que cada jogador remoto pediu. */
  private readonly wants = new Map<number, PursuitWants>();
  /** Réplica: último pedido enviado (manda de novo quando muda). */
  private sentWants = '';
  private wantTimer = 0;
  private pursuerTimer = 0;
  /** Réplica: eventos que o anfitrião mandou para mim, esperando o Game ler. */
  private readonly incoming: PursuitEvent[] = [];
  private readonly targetsCache = new Map<number, PursuitTarget>();

  constructor(
    private readonly cfg: Config,
    private readonly scene: THREE.Scene,
    private readonly physics: RAPIER.World,
    private readonly assets: RemoteAssets,
    private readonly onInfo: (info: MultiplayerInfo) => void,
    /** Alguém entrou ou saiu da sala (aviso no HUD). */
    private readonly onPeer: (kind: 'join' | 'leave', name: string) => void = () => {},
    /** Garagem deste jogador: a que o servidor deu na sala, ou a 0 fora do ar. */
    private readonly onGarage: (index: number) => void = () => {},
  ) {
    const now = () => performance.now() / 1000;
    this.client = new NetClient(
      cfg.multiplayer.url,
      {
        status: (st) => {
          this.updateRole();
          this.emitInfo();
          // Desligou o online: volta para a garagem do solo. (Queda de conexão não: ao reconectar, o
          // servidor costuma devolver a mesma garagem.)
          if (st === 'off') this.onGarage(0);
        },
        reset: () => {
          this.clear();
          this.updateRole();
        },
        welcome: (id, peers, host, garage) => {
          this.clear();
          this.selfId = id;
          this.hostId = host;
          this.onGarage(garage);
          for (const p of peers) this.add(p.id, p.name);
          this.updateRole();
          this.emitInfo();
        },
        host: (id) => {
          this.hostId = id;
          this.updateRole();
        },
        join: (p) => {
          this.add(p.id, p.name);
          this.emitInfo();
          this.onPeer('join', p.name);
        },
        leave: (id) => {
          const r = this.remotes.get(id);
          this.wants.delete(id);
          if (!r) return;
          r.dispose();
          this.remotes.delete(id);
          this.emitInfo();
          this.onPeer('leave', r.name);
        },
        rename: (p) => this.remotes.get(p.id)?.setName(p.name),
        state: (id, s) => {
          // Estado de alguém cujo "join" ainda não chegou (ordem de rede): cria na hora.
          (this.remotes.get(id) ?? this.add(id, '…')).push(s, now());
        },
        message: (msg) => {
          if (msg.type === 'want' && this._role === 'host') {
            const w = cleanWants(msg.w);
            if (w) this.wants.set(msg.id, w);
          } else if (msg.type === 'clear' && this._role === 'host') {
            this.pursuers?.clearTarget(msg.id);
          } else if (msg.type === 'pev' && this._role === 'replica') {
            const f = msg.side;
            if (msg.kind === 'photo') this.incoming.push({ type: 'photo', faction: 'imprensa' });
            else if (msg.kind === 'spawn' || msg.kind === 'escape') this.incoming.push({ type: msg.kind, faction: f });
            else if (f !== 'imprensa') this.incoming.push({ type: msg.kind, faction: f });
          } else if (msg.type === 'tomato' && this._role === 'replica') {
            this.pursuers?.addNetTomato(msg.from, msg.to, msg.dur);
          }
        },
        pursuers: (list) => {
          if (this._role === 'replica') this.pursuers?.applyNet(list, now(), this.selfId);
        },
      },
      { min: cfg.multiplayer.reconnectMin, max: cfg.multiplayer.reconnectMax },
    );
  }

  get info(): MultiplayerInfo {
    return { status: this.client.status, players: this.client.connected ? this.remotes.size + 1 : 0 };
  }

  get role(): NetRole {
    return this._role;
  }

  setEnabled(enabled: boolean, name: string): void {
    this.client.setEnabled(enabled, name);
  }

  /** Perseguidores do jogo: o Multiplayer liga/desliga o modo réplica conforme o papel na sala. */
  attachPursuers(pursuers: Pursuers): void {
    this.pursuers = pursuers;
    pursuers.setReplica(this._role === 'replica');
  }

  /** Antes de cada leva de passos de física: corpos cinemáticos na pose atual dos remotos. */
  beforePhysics(): void {
    for (const r of this.remotes.values()) r.beforePhysics();
  }

  /** Por frame (também pausado): interpolação, apelidos. */
  update(dt: number, camera: THREE.Camera): void {
    const now = performance.now() / 1000;
    for (const r of this.remotes.values()) r.update(now, dt, camera);
  }

  /** Por frame: manda o estado local na taxa do protocolo (jogando) ou 1x por segundo (pausado, no menu). */
  sendLocal(dt: number, state: PlayerState, playing: boolean): void {
    if (!this.client.connected) return;
    this.sendTimer -= dt;
    if (this.sendTimer > 0) return;
    this.client.sendState(state);
    // Mantém a cadência média mesmo com frames irregulares (não acumula atraso).
    const period = playing ? 1 / SEND_RATE : IDLE_PERIOD;
    this.sendTimer = Math.max(this.sendTimer + period, period * 0.5);
  }

  // ---------------------------------------------------------------------------
  // Perseguição compartilhada

  /** Anfitrião: alvos remotos (com o que cada um pediu), para a IA dos perseguidores. */
  remoteTargets(): { target: PursuitTarget; wants: PursuitWants }[] {
    if (this._role !== 'host') return [];
    const now = performance.now() / 1000;
    const out: { target: PursuitTarget; wants: PursuitWants }[] = [];
    for (const [id, r] of this.remotes) {
      if (!r.hasState) continue;
      let target = this.targetsCache.get(id);
      if (!target) {
        target = { id, position: new THREE.Vector3(), velocity: { x: 0, y: 0, z: 0 }, collider: null };
        this.targetsCache.set(id, target);
      }
      target.collider = r.targetInfo(now, target.position, target.velocity);
      out.push({ target, wants: this.wants.get(id) ?? NO_WANTS });
    }
    return out;
  }

  /**
   * Por frame, depois da IA: réplica manda o próprio pedido ao anfitrião; anfitrião manda poses,
   * eventos para cada alvo e os tomates em voo.
   */
  syncPursuit(dt: number, myWants: PursuitWants): void {
    const p = this.pursuers;
    if (!p || !this.client.connected) return;
    if (this._role === 'replica') {
      const key = JSON.stringify(myWants);
      this.wantTimer -= dt;
      if (key !== this.sentWants || this.wantTimer <= 0) {
        this.client.send({ type: 'want', w: myWants });
        this.sentWants = key;
        this.wantTimer = WANT_REFRESH;
      }
      return;
    }
    if (this._role !== 'host') return;
    for (const e of p.remoteEvents.splice(0)) this.client.send({ type: 'pev', to: e.to, kind: e.kind, side: e.side });
    if (this.remotes.size > 0) for (const tm of p.thrown.splice(0)) this.client.send({ type: 'tomato', ...tm });
    else p.thrown.length = 0;
    this.pursuerTimer -= dt;
    if (this.pursuerTimer > 0 || this.remotes.size === 0) return;
    this.pursuerTimer = Math.max(this.pursuerTimer + 1 / SEND_RATE, 0.5 / SEND_RATE);
    this.client.sendBinary(encodePursuers(p.netStates(this.selfId)));
  }

  /** Réplica: eventos de perseguição que me atingiram desde o último frame. */
  drainPursuitEvents(): PursuitEvent[] {
    return this.incoming.splice(0);
  }

  /** Tira os perseguidores de mim (imunidade da garagem, novo dia). */
  clearMyPursuers(): void {
    if (this._role === 'replica') this.client.send({ type: 'clear' });
    else this.pursuers?.clearTarget(LOCAL_TARGET);
  }

  /** Marcadores para o minimapa. */
  actors(): { x: number; z: number; yaw: number; color: string }[] {
    const out: { x: number; z: number; yaw: number; color: string }[] = [];
    for (const r of this.remotes.values()) {
      const a = r.actor;
      if (a) out.push(a);
    }
    return out;
  }

  dispose(): void {
    this.client.dispose();
    this.clear();
  }

  private updateRole(): void {
    const role: NetRole = !this.client.connected || !this.selfId ? 'offline' : this.hostId === this.selfId ? 'host' : 'replica';
    if (role === this._role) return;
    this._role = role;
    this.wants.clear();
    this.sentWants = '';
    this.incoming.length = 0;
    this.pursuers?.setReplica(role === 'replica');
  }

  private add(id: number, name: string): RemotePlayer {
    const existing = this.remotes.get(id);
    if (existing) {
      if (name !== '…') existing.setName(name);
      return existing;
    }
    const r = new RemotePlayer(id, name, this.scene, this.physics, this.cfg, this.assets);
    this.remotes.set(id, r);
    return r;
  }

  private clear(): void {
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.wants.clear();
    this.targetsCache.clear();
    this.emitInfo();
  }

  private emitInfo(): void {
    this.onInfo(this.info);
  }
}
