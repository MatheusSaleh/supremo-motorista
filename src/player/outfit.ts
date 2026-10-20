// Visuais dos passageiros: o mesmo modelo de executivo com terno e pele em outros tons, para não
// parecerem clones do Josué. As cores multiplicam as texturas (valores > 1 clareiam).
import * as THREE from 'three';

export interface Look {
  suit: [number, number, number];
  skin: [number, number, number];
  /**
   * Tecido do terno recolorido para esta cor (hex), em vez de só multiplicar: necessário para ternos
   * claros, já que o tecido original é quase preto. Camisa e gravata ficam como estão.
   */
  fabric?: number;
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

/** Texturas de terno recoloridas (uma por textura original + cor), geradas na primeira vez. */
const fabricCache = new Map<string, THREE.Texture>();

function recolorFabric(src: THREE.Texture, color: number): THREE.Texture {
  const key = `${src.uuid}:${color}`;
  const hit = fabricCache.get(key);
  if (hit) return hit;
  const img = src.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = data.data;
  const target = new THREE.Color(color);
  const [tr, tg, tb] = [target.r * 255, target.g * 255, target.b * 255];
  for (let i = 0; i < d.length; i += 4) {
    const max = Math.max(d[i], d[i + 1], d[i + 2]);
    const min = Math.min(d[i], d[i + 1], d[i + 2]);
    // Tecido: escuro e sem cor (camisa é clara; gravata, saturada). Mantém as dobras pelo brilho.
    if (max > 95 || max - min > 28) continue;
    const shade = 0.55 + (max / 95) * 0.75;
    d[i] = Math.min(255, tr * shade);
    d[i + 1] = Math.min(255, tg * shade);
    d[i + 2] = Math.min(255, tb * shade);
  }
  ctx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = src.flipY;
  tex.colorSpace = src.colorSpace;
  tex.wrapS = src.wrapS;
  tex.wrapT = src.wrapT;
  fabricCache.set(key, tex);
  return tex;
}

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
  const originalMaps = new Map((owned.get(SUIT) ?? []).map((m) => [m, m.map] as const));
  return (look) => {
    for (const m of owned.get(SUIT) ?? []) {
      // Trocar de textura (mantendo uma) não recompila o shader.
      const original = originalMaps.get(m) ?? null;
      m.map = look.fabric !== undefined && original ? recolorFabric(original, look.fabric) : original;
      m.color.setRGB(...look.suit);
    }
    for (const m of owned.get(SKIN) ?? []) m.color.setRGB(...look.skin);
  };
}
