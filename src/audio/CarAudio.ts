// Sons do carro: motor (rotação simulada com câmbio automático), pneus cantando no drift (ruído
// filtrado — não há gravação CC0 adequada), vento com a velocidade, turbo, freio de mão, buzina,
// batidas e pousos de salto.
import type { Config } from '../config';
import { clamp } from '../core/math';
import type { Car, CarEvent } from '../vehicle/Car';
import type { AudioSystem, LoopHandle } from './AudioSystem';

// Limites de cada marcha, como fração da velocidade máxima.
const GEARS = [0, 0.16, 0.33, 0.52, 0.74, 1.0];
const HORN_REPEAT = 0.42; // segurar H repete a buzina ("buzinaço")

export class CarAudio {
  private engine: LoopHandle | null = null;
  private readonly screech: ReturnType<AudioSystem['noiseLoop']>;
  private readonly wind: LoopHandle | null;
  private rpm = 0.2;

  /** Rotação simulada do motor, 0..1 (para o conta-giros). */
  get engineRpm(): number {
    return this.engine ? this.rpm : 0;
  }
  private wasTurbo = false;
  private wasHandbrake = false;
  private hornTimer = 0;
  private impactCooldown = 0;

  constructor(
    private readonly audio: AudioSystem,
    private car: Car,
    private readonly cfg: Config,
  ) {
    this.screech = audio.noiseLoop('vehicle', 1250, 6);
    this.wind = audio.loop('windLoop', { volume: 0 });
  }

  /** Troca o carro (frota): o som do motor segue o novo. */
  setCar(car: Car): void {
    this.car = car;
  }

  private get engineTone(): { pitch: number; volume: number } {
    return this.car.def?.engine ?? { pitch: 1, volume: 1 };
  }

  /** Entrar: abre a porta, fecha e dá a partida. */
  enter(): void {
    this.audio.play('doorOpen');
    this.audio.play('doorClose', { delay: 0.45 });
    this.audio.play('engineStart', { delay: 0.75 });
    if (!this.engine) {
      this.engine = this.audio.loop('engineLoop', { volume: 0, delay: 1.2 });
      this.engine?.setVolume(0.6 * this.engineTone.volume, 0.8);
    }
  }

  /** Sair: desliga o motor e abre/fecha a porta. */
  exit(): void {
    if (this.engine) {
      this.engine.stop(0.4);
      this.engine = null;
      this.audio.play('engineStop');
    }
    this.screech.setVolume(0);
    this.wind?.setVolume(0, 0.3);
    this.audio.play('doorOpen', { delay: 0.3 });
    this.audio.play('doorClose', { delay: 0.8 });
  }

  /** Chamado a cada frame enquanto H está pressionada. */
  horn(dt: number, held: boolean): void {
    if (!held) {
      this.hornTimer = 0;
      return;
    }
    this.hornTimer -= dt;
    if (this.hornTimer <= 0) {
      this.audio.play('horn');
      this.hornTimer = HORN_REPEAT;
    }
  }

  update(dt: number, throttle: number, events: readonly CarEvent[]): void {
    this.impactCooldown -= dt;
    // Eventos físicos tocam mesmo com o motor desligado (carro empurrado, caindo…).
    for (const e of events) {
      if (e.type === 'land') {
        this.audio.play('carLand', { volume: clamp(e.airTime / 1.2, 0.4, 1) });
      } else if (this.impactCooldown <= 0) {
        this.impactCooldown = 0.15;
        if (e.strength > 9) this.audio.play('crashHeavy', { volume: clamp(e.strength / 18, 0.6, 1) });
        else if (e.strength > 4) this.audio.play('impactMedium', { volume: clamp(e.strength / 9, 0.5, 1) });
        else this.audio.play('impactLight', { volume: clamp(e.strength / 4, 0.3, 0.8) });
      }
    }
    if (!this.engine) return;

    const c = this.car;
    const speed = Math.abs(c.forwardSpeed);
    const frac = clamp(speed / this.cfg.car.maxSpeed, 0, 1.3);
    // Câmbio automático: dentro de cada marcha a rotação sobe de 0,35 a 1.
    let gear = 0;
    while (gear < GEARS.length - 2 && frac > GEARS[gear + 1]) gear++;
    const lo = GEARS[gear];
    const hi = GEARS[gear + 1];
    const inGear = clamp((frac - lo) / (hi - lo), 0, 1);
    const airborne = c.wheelsOnGround === 0;
    // No ar ou parado acelerando, o motor "gira em falso".
    const target = airborne || speed < 1 ? 0.25 + Math.abs(throttle) * 0.6 : 0.35 + inGear * 0.65;
    this.rpm += (target - this.rpm) * clamp(dt * 6, 0, 1);
    const turboBoost = c.turboActive ? 0.12 : 0;
    const tone = this.engineTone;
    this.engine.setRate((0.65 + this.rpm * 1.2 + turboBoost) * tone.pitch);
    this.engine.setVolume((0.45 + Math.abs(throttle) * 0.35 + this.rpm * 0.2) * tone.volume);

    // Pneus cantando: volume e tom pela derrapagem.
    const slip = c.slip;
    this.screech.setVolume(slip * 0.5, 0.04);
    this.screech.filter.frequency.setTargetAtTime(1100 + slip * 500 + speed * 4, this.audio.ctx.currentTime, 0.05);

    // Vento: só aparece acima de ~50 km/h.
    this.wind?.setVolume(clamp((speed - 14) / 26, 0, 1) * 0.8, 0.2);
    this.wind?.setRate(0.85 + frac * 0.35);

    if (c.turboActive && !this.wasTurbo) this.audio.play('turbo');
    this.wasTurbo = c.turboActive;
    if (c.handbrake && !this.wasHandbrake) this.audio.play('handbrake');
    this.wasHandbrake = c.handbrake;
  }

  dispose(): void {
    this.engine?.stop(0.05);
    this.screech.stop(0.05);
    this.wind?.stop(0.05);
  }
}
