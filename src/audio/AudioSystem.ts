// Sistema de áudio sobre a Web Audio API, usando o THREE.AudioListener (preso à câmera) para a
// posição/orientação do ouvinte. Canais (buses) com volume próprio → master → listener.
// Navegadores só liberam áudio após um gesto do usuário: o contexto é retomado no primeiro clique/tecla.
import * as THREE from 'three';
import { SOUNDS, type Bus, type SoundId } from './sounds';

export interface Volumes {
  master: number;
  vehicle: number;
  sfx: number;
  ambient: number;
  ui: number;
  muted: boolean;
}

export interface PlayOptions {
  volume?: number;
  /** Velocidade de reprodução (também muda o tom). */
  rate?: number;
  /** Posição no mundo; sem ela o som é "na cabeça" do jogador. */
  position?: THREE.Vector3Like;
  /** Atraso em segundos (para encadear sons, ex.: porta → motor). */
  delay?: number;
}

/** Som contínuo controlável (motor, vento, multidão…). */
export interface LoopHandle {
  setVolume(v: number, rampSeconds?: number): void;
  setRate(r: number, rampSeconds?: number): void;
  setPosition(p: THREE.Vector3Like): void;
  stop(fadeSeconds?: number): void;
}

export class AudioSystem {
  readonly listener = new THREE.AudioListener();
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly buses: Record<Bus, GainNode>;
  /** Filtro passa-baixa do ambiente (abafa o mundo de fora quando dentro do carro). */
  private readonly ambientFilter: BiquadFilterNode;
  private readonly duck: GainNode;
  private readonly buffers = new Map<SoundId, AudioBuffer[]>();
  private volumes: Volumes = { master: 0.8, vehicle: 1, sfx: 1, ambient: 0.8, ui: 0.8, muted: false };
  private readonly unlock = () => void this.ctx.resume();

  constructor() {
    this.ctx = this.listener.context;
    this.master = this.ctx.createGain();
    this.master.connect(this.listener.getInput());
    // "duck" abaixa tudo menos a interface (ex.: no menu de pausa).
    this.duck = this.ctx.createGain();
    this.duck.connect(this.master);
    this.ambientFilter = this.ctx.createBiquadFilter();
    this.ambientFilter.type = 'lowpass';
    this.ambientFilter.frequency.value = 20000;
    this.ambientFilter.connect(this.duck);
    const bus = (dest: AudioNode) => {
      const g = this.ctx.createGain();
      g.connect(dest);
      return g;
    };
    this.buses = { vehicle: bus(this.duck), sfx: bus(this.duck), ambient: bus(this.ambientFilter), ui: bus(this.master) };
    for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, this.unlock);
  }

  /** Carrega todos os sons do manifesto. Falhas viram aviso (o jogo segue sem aquele som). */
  async load(onProgress?: (fraction: number) => void): Promise<void> {
    const entries = Object.entries(SOUNDS) as [SoundId, (typeof SOUNDS)[SoundId]][];
    const total = entries.reduce((n, [, d]) => n + d.files.length, 0);
    let done = 0;
    await Promise.all(
      entries.map(async ([id, def]) => {
        const list = await Promise.all(
          def.files.map(async (f) => {
            try {
              const res = await fetch(`${import.meta.env.BASE_URL}audio/${f}`);
              if (!res.ok) throw new Error(`${res.status}`);
              return await this.ctx.decodeAudioData(await res.arrayBuffer());
            } catch (err) {
              console.warn(`[audio] falha ao carregar ${f}`, err);
              return null;
            } finally {
              onProgress?.(++done / total);
            }
          }),
        );
        const ok = list.filter((b): b is AudioBuffer => b !== null);
        if (ok.length) this.buffers.set(id, ok);
      }),
    );
  }

  setVolumes(v: Volumes): void {
    this.volumes = { ...v };
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.muted ? 0 : v.master, t, 0.05);
    for (const b of Object.keys(this.buses) as Bus[]) this.buses[b].gain.setTargetAtTime(v[b], t, 0.05);
  }

  get currentVolumes(): Volumes {
    return { ...this.volumes };
  }

  /** Pausa: abaixa tudo menos a interface. */
  setDucked(on: boolean): void {
    this.duck.gain.setTargetAtTime(on ? 0.15 : 1, this.ctx.currentTime, 0.08);
  }

  /** Dentro do carro: ambiente abafado. */
  setMuffled(on: boolean): void {
    this.ambientFilter.frequency.setTargetAtTime(on ? 1400 : 20000, this.ctx.currentTime, 0.15);
  }

  /** Toca um som uma vez (variação sorteada). */
  play(id: SoundId, opts: PlayOptions = {}): void {
    const list = this.buffers.get(id);
    if (!list || this.ctx.state !== 'running') return;
    const def = SOUNDS[id];
    const src = this.ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = opts.rate ?? 1;
    const gain = this.ctx.createGain();
    gain.gain.value = def.volume * (opts.volume ?? 1);
    src.connect(gain);
    this.route(gain, def.bus, opts.position);
    src.start(this.ctx.currentTime + (opts.delay ?? 0));
  }

  /** Inicia um som em loop. Retorna null se o som não carregou. */
  loop(id: SoundId, opts: PlayOptions = {}): LoopHandle | null {
    const list = this.buffers.get(id);
    if (!list) return null;
    const def = SOUNDS[id];
    const src = this.ctx.createBufferSource();
    src.buffer = list[0];
    src.loop = true;
    src.playbackRate.value = opts.rate ?? 1;
    // Começa em ponto aleatório para loops iguais não soarem em fase.
    const offset = Math.random() * src.buffer.duration;
    const gain = this.ctx.createGain();
    gain.gain.value = def.volume * (opts.volume ?? 1);
    src.connect(gain);
    const panner = this.route(gain, def.bus, opts.position);
    src.start(this.ctx.currentTime + (opts.delay ?? 0), offset);
    return this.handle(src, gain, def.volume, panner);
  }

  /** Ruído filtrado contínuo (base da cantada de pneu, que não tem gravação CC0 adequada). */
  noiseLoop(bus: Bus, frequency: number, q: number): LoopHandle & { filter: BiquadFilterNode } {
    const len = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain);
    this.route(gain, bus);
    src.start();
    return Object.assign(this.handle(src, gain, 1, null), { filter });
  }

  dispose(): void {
    for (const ev of ['pointerdown', 'keydown'] as const) window.removeEventListener(ev, this.unlock);
    this.listener.removeFromParent();
    void this.ctx.close();
  }

  private route(node: AudioNode, bus: Bus, position?: THREE.Vector3Like): PannerNode | null {
    if (!position) {
      node.connect(this.buses[bus]);
      return null;
    }
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 8;
    p.maxDistance = 400;
    p.rolloffFactor = 1.2;
    p.positionX.value = position.x;
    p.positionY.value = position.y;
    p.positionZ.value = position.z;
    node.connect(p).connect(this.buses[bus]);
    return p;
  }

  private handle(src: AudioBufferSourceNode, gain: GainNode, base: number, panner: PannerNode | null): LoopHandle {
    const ctx = this.ctx;
    return {
      setVolume: (v, ramp = 0.08) => gain.gain.setTargetAtTime(base * v, ctx.currentTime, ramp),
      setRate: (r, ramp = 0.05) => src.playbackRate.setTargetAtTime(r, ctx.currentTime, ramp),
      setPosition: (pos) => {
        if (!panner) return;
        const t = ctx.currentTime;
        panner.positionX.setTargetAtTime(pos.x, t, 0.05);
        panner.positionY.setTargetAtTime(pos.y, t, 0.05);
        panner.positionZ.setTargetAtTime(pos.z, t, 0.05);
      },
      stop: (fade = 0.15) => {
        gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
        src.stop(ctx.currentTime + fade + 0.05);
      },
    };
  }
}
