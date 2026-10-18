// AnimationMixer com crossfade entre idle/walk/run/jump/fall a partir do PlayerState.
// Só depende de moveState e speed, então serve para qualquer personagem (jogador ou NPC).
import * as THREE from 'three';
import type { Config } from '../config';
import type { MoveState } from './PlayerState';

export type AnimKey = 'idle' | 'walk' | 'run' | 'jump' | 'fall';

// Se um clip não existir no modelo, usa o próximo da lista.
const FALLBACKS: Record<AnimKey, AnimKey[]> = {
  idle: [],
  walk: ['run', 'idle'],
  run: ['walk', 'idle'],
  jump: ['fall', 'idle'],
  fall: ['jump', 'idle'],
};
const LOOPING: ReadonlySet<AnimKey> = new Set(['idle', 'walk', 'run']);

export class PlayerAnimator {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<AnimKey, THREE.AnimationAction>();
  private currentKey: AnimKey | null = null;
  private current: THREE.AnimationAction | null = null;
  private airTime = 0;

  constructor(
    root: THREE.Object3D,
    clips: readonly THREE.AnimationClip[],
    private readonly cfg: Config,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    const names = cfg.character.clips;
    for (const key of Object.keys(names) as AnimKey[]) {
      const clip = findClip(clips, names[key]);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      if (!LOOPING.has(key)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(key, action);
    }
    if (this.actions.size === 0) console.warn('[animator] nenhum clip encontrado; confira config.character.clips');
  }

  update(dt: number, state: MoveState, speed: number): void {
    const target = this.chooseKey(dt, state);
    const resolved = this.resolve(target);
    if (resolved && resolved.action !== this.current) this.play(resolved.key, resolved.action);
    if (this.current && this.currentKey) this.current.timeScale = this.timeScaleFor(this.currentKey, speed);
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }

  private chooseKey(dt: number, state: MoveState): AnimKey {
    if (state === 'jump') {
      this.airTime = Infinity;
      return 'jump';
    }
    if (state === 'fall') {
      this.airTime += dt;
      // Termina o clip de pulo antes de trocar para a queda.
      if (this.currentKey === 'jump' && this.current && this.current.time < this.current.getClip().duration) return 'jump';
      // Pequenas quedas (descer degrau/rampa) não disparam a animação de queda.
      if (this.airTime < this.cfg.character.airDelay) return this.currentKey ?? 'idle';
      return 'fall';
    }
    this.airTime = 0;
    return state;
  }

  private resolve(key: AnimKey): { key: AnimKey; action: THREE.AnimationAction } | null {
    for (const k of [key, ...FALLBACKS[key]]) {
      const action = this.actions.get(k);
      if (action) return { key: k, action };
    }
    return null;
  }

  private play(key: AnimKey, next: THREE.AnimationAction): void {
    const prev = this.current;
    const prevKey = this.currentKey;
    const fade = this.cfg.character.fadeTime;

    next.reset();
    if (key === 'jump') next.time = this.cfg.character.jumpClipOffset;
    // walk ↔ run: mantém a fase do passo para os pés não "pularem" na transição.
    if (prev && prevKey && (prevKey === 'walk' || prevKey === 'run') && (key === 'walk' || key === 'run')) {
      next.time = (prev.time / prev.getClip().duration) * next.getClip().duration;
    }
    next.fadeIn(fade).play();
    prev?.fadeOut(fade);

    this.current = next;
    this.currentKey = key;
  }

  /** Acelera/desacelera o ciclo de passos conforme a velocidade real, para reduzir o "patinar". */
  private timeScaleFor(key: AnimKey, speed: number): number {
    const c = this.cfg.character;
    if (key === 'walk') return THREE.MathUtils.clamp(speed / c.walkClipSpeed, 0.5, 1.8);
    if (key === 'run') return THREE.MathUtils.clamp(speed / c.runClipSpeed, 0.6, 1.8);
    return 1;
  }
}

/** Busca pelo nome exato; senão, pelo primeiro que contenha o nome (sem diferenciar maiúsculas). */
function findClip(clips: readonly THREE.AnimationClip[], name: string): THREE.AnimationClip | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return clips.find((c) => c.name === name) ?? clips.find((c) => c.name.toLowerCase().includes(lower));
}
