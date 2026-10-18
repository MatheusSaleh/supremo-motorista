// Ambiente: pássaros de dia e grilos à noite ao fundo, água perto do lago e falatório perto da feira
// (posicional).
// Tudo derivado do Level, então funciona com qualquer cenário (procedural ou .glb).
import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Level } from '../world/Level';
import type { AudioSystem, LoopHandle } from './AudioSystem';

export class AmbientAudio {
  private readonly birds: LoopHandle | null;
  private readonly crickets: LoopHandle | null;
  private readonly water: LoopHandle | null;
  private readonly crowds: LoopHandle[] = [];

  constructor(
    audio: AudioSystem,
    private readonly level: Level,
  ) {
    this.birds = audio.loop('birdsLoop');
    this.crickets = audio.loop('cricketsLoop', { volume: 0 });
    this.water = audio.loop('waterLoop', { volume: 0 });
    // Falatório onde houver endereços de feira (média das posições).
    const feira = level.addresses.filter((a) => a.id.startsWith('feira'));
    if (feira.length) {
      const pos = new THREE.Vector3(
        feira.reduce((s, a) => s + a.x, 0) / feira.length - 60,
        2,
        feira.reduce((s, a) => s + a.z, 0) / feira.length,
      );
      const crowd = audio.loop('crowdLoop', { position: pos });
      if (crowd) this.crowds.push(crowd);
    }
  }

  /**
   * @param listener posição de quem ouve (câmera).
   * @param night 0 (dia) → 1 (noite): pássaros dão lugar aos grilos.
   * @param rain 0..1: chuva abafa os dois.
   */
  update(listener: THREE.Vector3Like, night = 0, rain = 0): void {
    // Água: mais alta quanto mais perto da margem.
    let dist = Infinity;
    for (const w of this.level.water) {
      const dx = Math.max(w.minX - listener.x, 0, listener.x - w.maxX);
      const dz = Math.max(w.minZ - listener.z, 0, listener.z - w.maxZ);
      dist = Math.min(dist, Math.hypot(dx, dz));
    }
    this.water?.setVolume(clamp(1 - dist / 120, 0, 1), 0.3);
    // Natureza some com a altura acima do chão (câmera alta / pulos grandes) e com a chuva.
    const ground = this.level.heightAt?.(listener.x, listener.z) ?? 0;
    const nature = clamp(1 - (listener.y - ground - 20) / 80, 0.3, 1) * (1 - 0.7 * rain);
    this.birds?.setVolume(nature * (1 - night), 0.5);
    this.crickets?.setVolume(nature * night, 0.5);
  }

  dispose(): void {
    this.birds?.stop(0.05);
    this.crickets?.stop(0.05);
    this.water?.stop(0.05);
    this.crowds.forEach((c) => c.stop(0.05));
  }
}
