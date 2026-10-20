// Trilha (Fase 12): músicas longas tocadas em streaming (elemento <audio>) e ligadas ao canal "music" do
// AudioSystem, com troca suave entre faixas. Decodificar uma música inteira num AudioBuffer ocuparia dezenas
// de MB por faixa; o streaming não.
import type { AudioSystem } from './AudioSystem';

export const TRACKS = {
  menu: 'music/bossa_town.mp3',
  radio1: 'music/drive.mp3',
  radio2: 'music/chill_jazz.mp3',
  radio3: 'music/mad_bossa.ogg',
} as const;

export type TrackId = keyof typeof TRACKS;

/** Faixas do rádio do carro (tocam em sequência). */
export const RADIO_PLAYLIST: TrackId[] = ['radio1', 'radio2', 'radio3'];

interface Channel {
  el: HTMLAudioElement;
  gain: GainNode;
  track: TrackId;
}

export class Music {
  private current: Channel | null = null;
  private playlist: TrackId[] | null = null;
  private playlistIndex = 0;

  constructor(private readonly audio: AudioSystem) {}

  get track(): TrackId | null {
    return this.current?.track ?? null;
  }

  /** Toca uma faixa em loop (troca suave se já houver outra). */
  play(track: TrackId, volume = 1): void {
    this.playlist = null;
    if (this.current?.track === track) return;
    this.start(track, volume, true);
  }

  /** Toca uma lista em sequência, a partir de uma faixa sorteada (rádio do carro). */
  playList(tracks: TrackId[], volume = 1): void {
    if (this.playlist && this.current && tracks.includes(this.current.track)) return;
    this.playlist = tracks;
    this.playlistIndex = Math.floor(Math.random() * tracks.length);
    this.start(tracks[this.playlistIndex], volume, false);
  }

  stop(fadeSeconds = 1.2): void {
    this.playlist = null;
    if (this.current) this.fadeOut(this.current, fadeSeconds);
    this.current = null;
  }

  private start(track: TrackId, volume: number, loop: boolean): void {
    if (this.current) this.fadeOut(this.current, 1.2);
    const ctx = this.audio.ctx;
    const el = new Audio(`${import.meta.env.BASE_URL}audio/${TRACKS[track]}`);
    el.loop = loop;
    el.preload = 'auto';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain).connect(this.audio.busInput('music'));
    gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.5);
    const channel: Channel = { el, gain, track };
    el.addEventListener('ended', () => {
      if (this.current !== channel || !this.playlist) return;
      this.playlistIndex = (this.playlistIndex + 1) % this.playlist.length;
      this.start(this.playlist[this.playlistIndex], volume, false);
    });
    // Sem gesto do usuário o navegador recusa tocar; tenta de novo no primeiro clique/tecla.
    const tryPlay = () => void el.play().catch(() => undefined);
    tryPlay();
    for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, tryPlay, { once: true });
    this.current = channel;
  }

  private fadeOut(ch: Channel, seconds: number): void {
    const ctx = this.audio.ctx;
    ch.gain.gain.setTargetAtTime(0, ctx.currentTime, seconds / 3);
    window.setTimeout(() => {
      ch.el.pause();
      ch.el.removeAttribute('src');
      ch.el.load();
      ch.gain.disconnect();
    }, seconds * 1000 + 200);
  }
}
