// Sons do Josué a pé: passos conforme o piso (grama, asfalto/concreto, madeira), pulo e aterrissagem.
import type { Player } from '../player/Player';
import type { World } from '../world/World';
import type { AudioSystem } from './AudioSystem';
import type { SoundId } from './sounds';

const STEP_SOUND: Record<string, SoundId> = {
  grass: 'stepGrass',
  wood: 'stepWood',
  asphalt: 'stepConcrete',
  concrete: 'stepConcrete',
};

export class PlayerAudio {
  private lastStepAt = 0;

  constructor(
    private readonly audio: AudioSystem,
    private readonly player: Player,
    private readonly world: World,
  ) {}

  update(): void {
    const p = this.player;
    for (const e of p.drainEvents()) {
      if (e.type === 'jump') this.audio.play('jump');
      else {
        this.audio.play('playerLand', { volume: Math.min(1, 0.5 + e.airTime) });
        this.step(1);
      }
    }
    // Um passo a cada ~0,8 m andando ou ~1,3 m correndo.
    const running = p.state.moveState === 'run';
    const stride = running ? 1.3 : 0.8;
    if (p.distanceWalked - this.lastStepAt >= stride) {
      this.lastStepAt = p.distanceWalked;
      this.step(running ? 1 : 0.7);
    }
  }

  /** Reinicia a contagem de passos (ex.: depois de teleporte/sair do carro). */
  reset(): void {
    this.lastStepAt = this.player.distanceWalked;
  }

  private step(volume: number): void {
    const surface = this.world.surfaceAt(this.player.position);
    this.audio.play(STEP_SOUND[surface] ?? 'stepConcrete', { volume, rate: 0.92 + Math.random() * 0.16 });
  }
}
