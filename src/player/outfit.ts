// Visuais dos passageiros: o mesmo modelo de executivo com terno e pele em outros tons, para não
// parecerem clones do Josué. As cores multiplicam as texturas (valores > 1 clareiam).
import * as THREE from 'three';

export interface Look {
  suit: [number, number, number];
  skin: [number, number, number];
}

export const PASSENGER_LOOKS: readonly Look[] = [
  { suit: [0.9, 1.15, 2.3], skin: [1, 1, 1] }, // azul-marinho
  { suit: [2.1, 2.1, 2.2], skin: [1.2, 1.12, 1.06] }, // cinza
  { suit: [1.9, 1.45, 1.05], skin: [0.72, 0.62, 0.56] }, // marrom
  { suit: [1.25, 1.25, 1.3], skin: [1.12, 1.05, 1] }, // grafite
  { suit: [1.3, 1.6, 1.3], skin: [0.85, 0.76, 0.68] }, // verde-oliva escuro
];

const SUIT = 'Suit';
const SKIN = 'maleBody';

/** Clona os materiais do terno e da pele deste boneco e devolve quem aplica um visual. */
export function makeDresser(root: THREE.Object3D): (look: Look) => void {
  const owned = new Map<string, THREE.MeshStandardMaterial[]>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
    const name = o.material.name;
    if (name !== SUIT && name !== SKIN) return;
    const m = (o.material as THREE.MeshStandardMaterial).clone();
    o.material = m;
    owned.set(name, [...(owned.get(name) ?? []), m]);
  });
  return (look) => {
    for (const m of owned.get(SUIT) ?? []) m.color.setRGB(...look.suit);
    for (const m of owned.get(SKIN) ?? []) m.color.setRGB(...look.skin);
  };
}
