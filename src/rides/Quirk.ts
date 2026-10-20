// Fase 10: o jeito de cada passageiro (arquétipo) durante a corrida. O RideManager cria um Quirk por
// corrida e repassa os eventos (salto, batida, buzina, derrapagem, foto); o Quirk decide falas, status no
// painel e as linhas extras da conta. A parada do Palestrante (endereço) fica no RideManager.
import { t, type StringKey } from '../core/i18n';
import { ARCHETYPE_RULES as R, BUSY_AREAS } from '../data/archetypes';
import type { Archetype, LineTrigger } from '../data/rides';

export interface QuirkFrame {
  dt: number;
  kmh: number;
  slip: number;
  x: number;
  z: number;
  horn: boolean;
}

/** Falas: gatilho, forçar (ignora o intervalo entre falas) e duração do balão (s). */
export type Say = (trigger: LineTrigger, force?: boolean, ttl?: number) => void;

type Add = (key: StringKey, value: number, params?: Record<string, number>) => void;

const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);

export class Quirk {
  /** Novato: medroso (true) ou empolgado (false). */
  readonly scared: boolean;
  // Orador.
  private speechTimer = rand(R.orador.speechEvery);
  private speaking = 0;
  private speeches = 0;
  private interrupts = 0;
  private hornWas = false;
  // Novato medroso: gorjeta perdida.
  private scareCost = 0;
  // Presidente.
  private slowRun = 0;
  // Discreto: segundos visto.
  private exposure = 0;
  private busy = false;

  constructor(readonly kind: Archetype) {
    this.scared = kind === 'novato' && Math.random() < R.novato.scaredChance;
  }

  /** Perfil mostrado no chamado do rádio (null = sem regras especiais). */
  get profile(): string | null {
    switch (this.kind) {
      case 'novato':
        return t(this.scared ? 'archetype.novato.scared' : 'archetype.novato.thrilled');
      case 'banqueiro':
        return null;
      default:
        return t(`archetype.${this.kind}`);
    }
  }

  /** Multiplicador do tempo limite. */
  get timeMul(): number {
    return this.kind === 'presidente' ? R.presidente.timeMul : 1;
  }

  /** Multiplicador dos bônus de salto e derrapagem. */
  get bonusMul(): number {
    return this.kind === 'novato' && !this.scared ? R.novato.thrilledMul : 1;
  }

  /** Discursando (as outras falas esperam). */
  get busyTalking(): boolean {
    return this.speaking > 0;
  }

  update(f: QuirkFrame, say: Say): void {
    switch (this.kind) {
      case 'orador':
        if (this.speaking > 0) {
          if ((this.speaking -= f.dt) <= 0) {
            this.speeches++;
            say('speechEnd', true);
          }
        } else if ((this.speechTimer -= f.dt) <= 0) {
          this.speaking = R.orador.speechSeconds;
          this.speechTimer = rand(R.orador.speechEvery);
          say('speech', true, R.orador.speechSeconds);
        }
        if (f.horn && !this.hornWas) this.interrupt(say);
        this.hornWas = f.horn;
        break;
      case 'novato':
        if (!this.scared) break;
        if (f.slip > 0.5 && f.kmh > 25) this.scareCost += R.novato.scaredDrift * f.dt;
        if (f.kmh > R.novato.scaredSpeedKmh) this.scareCost += R.novato.scaredSpeed * f.dt;
        break;
      case 'presidente':
        this.slowRun = f.kmh < R.presidente.slowKmh ? this.slowRun + f.dt : Math.min(this.slowRun, 0);
        if (this.slowRun > 6) {
          this.slowRun = -12;
          say('rush', true);
        }
        break;
      case 'discreto': {
        const busy = BUSY_AREAS.some((a) => f.x > a.minX && f.x < a.maxX && f.z > a.minZ && f.z < a.maxZ);
        if (busy) this.exposure += f.dt;
        if (busy !== this.busy) say(busy ? 'exposed' : 'hidden', busy);
        this.busy = busy;
        break;
      }
      default:
        break;
    }
  }

  /** Salto. Retorna true se o arquétipo já falou (a fala comum não precisa). */
  jumped(say: Say): boolean {
    if (this.kind === 'orador') return this.interrupt(say);
    if (this.kind === 'novato') {
      if (this.scared) this.scareCost += R.novato.scaredJump;
      say(this.scared ? 'scared' : 'thrilled', true);
      return true;
    }
    return false;
  }

  crashed(say: Say): boolean {
    return this.kind === 'orador' && this.interrupt(say);
  }

  /** Início de uma derrapagem longa. */
  drifted(say: Say): boolean {
    if (this.kind !== 'novato') return false;
    say(this.scared ? 'scared' : 'thrilled', true);
    return true;
  }

  photographed(): void {
    if (this.kind === 'discreto') this.exposure += R.discreto.photoSeconds;
  }

  /** Linha de status no painel da corrida. */
  status(): string | null {
    switch (this.kind) {
      case 'orador':
        return this.speaking > 0 ? t('status.speech') : t('status.speeches', { ok: this.speeches, bad: this.interrupts });
      case 'novato':
        return t(this.scared ? 'status.scared' : 'status.thrilled');
      case 'presidente':
        return t('status.rush');
      case 'discreto':
        return this.busy ? t('status.exposed') : t('status.exposure', { pct: Math.round(this.exposureFraction * 100) });
      default:
        return null;
    }
  }

  /** Linhas extras da conta. `tip` = gorjeta por pontualidade já calculada (0 se atrasou). */
  result(add: Add, late: boolean, tip: number): void {
    switch (this.kind) {
      case 'orador':
        add('result.speeches', this.speeches * R.orador.speechBonus, { n: this.speeches });
        add('result.interrupted', -this.interrupts * R.orador.interruptPenalty, { n: this.interrupts });
        break;
      case 'novato':
        if (this.scared) add('result.scared', -this.scareCost);
        break;
      case 'presidente':
        if (late) add('result.presidentLate', -R.presidente.latePenalty);
        else add('result.presidentTip', tip * (R.presidente.tipMul - 1));
        break;
      case 'discreto': {
        const clean = 1 - this.exposureFraction;
        if (!late) add('result.discretion', R.discreto.bonus * clean, { pct: Math.round(clean * 100) });
        break;
      }
      default:
        break;
    }
  }

  private get exposureFraction(): number {
    return Math.min(1, this.exposure / R.discreto.exposureLimit);
  }

  private interrupt(say: Say): boolean {
    if (this.speaking <= 0) return false;
    this.speaking = 0;
    this.interrupts++;
    say('interrupted', true);
    return true;
  }
}
