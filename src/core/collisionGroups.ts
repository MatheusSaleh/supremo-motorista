// Grupos de colisão do Rapier: 16 bits de "sou membro de" + 16 bits de "colido com".
// Dois colisores interagem se cada um está no filtro do outro.
//
// Postes/árvores/placas ("props") têm dois colisores:
//   - sólido (PROP): bloqueia o Josué a pé, mas o carro passa (não leva o tranco de uma parede);
//   - sensor (PROP_SENSOR): só detecta o carro, para quebrar o prop e virar destroço.

export const GROUP = {
  WORLD: 1 << 0,
  CAR: 1 << 1,
  PROP: 1 << 2,
  PROP_SENSOR: 1 << 3,
  DEBRIS: 1 << 4,
  PLAYER: 1 << 5,
} as const;

const ALL = 0xffff;

export function groups(memberships: number, filter: number): number {
  return ((memberships & 0xffff) << 16) | (filter & 0xffff);
}

export const COLLISION = {
  car: groups(GROUP.CAR, ALL & ~GROUP.PROP),
  propSolid: groups(GROUP.PROP, ALL & ~GROUP.CAR),
  propSensor: groups(GROUP.PROP_SENSOR, GROUP.CAR),
  debris: groups(GROUP.DEBRIS, ALL & ~GROUP.PROP_SENSOR),
  player: groups(GROUP.PLAYER, ALL & ~GROUP.PROP_SENSOR),
};
