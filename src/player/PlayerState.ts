// Estado mínimo de um personagem: o Player o produz a partir da física e o Avatar só o aplica.

export type MoveState = 'idle' | 'walk' | 'run' | 'jump' | 'fall';

export interface PlayerState {
  id: string;
  name: string;
  /** Posição dos pés, em metros. */
  x: number;
  y: number;
  z: number;
  /** Rotação do corpo em torno de Y (0 = olhando para +Z). */
  yaw: number;
  moveState: MoveState;
  /** Velocidade horizontal (m/s), usada para escolher/escalar animações. */
  speed: number;
}

export function createPlayerState(id: string, name: string): PlayerState {
  return { id, name, x: 0, y: 0, z: 0, yaw: 0, moveState: 'idle', speed: 0 };
}
