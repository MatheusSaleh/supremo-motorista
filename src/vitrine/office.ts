// Escritório da vitrine: sala com parede de vidro (virada para −Z, o leste: a Esplanada), mesa com dois
// monitores, cadeira, estante, planta e luminária. Coordenadas locais: chão em y = 0, centro da sala na origem.
import * as THREE from 'three';
import { StatsPanel, type CodeScreen, type CommitScreen, type DeskClock } from './screens';

export const ROOM = { w: 9, d: 6.4, h: 3.2 };
const WIN_Z = -ROOM.d / 2;

/** Onde ficam a mesa, o teclado e a cadeira (o personagem senta de frente para a janela). */
export const DESK = { x: 1.5, z: -1.95, top: 0.76, w: 1.7, d: 0.8 };
export const RUG_TOP = 0.01;
export const CHAIR = { x: DESK.x, z: -1.05, seat: 0.5, width: 0.6, depth: 0.55 };
export const KEYBOARD = { x: DESK.x, y: DESK.top + 0.02, z: DESK.z + 0.24 };

export interface Office {
  root: THREE.Group;
  /** Luzes internas (intensidade ajustada conforme a noite). */
  lamp: THREE.PointLight;
  screenGlow: THREE.PointLight;
  ceiling: THREE.PointLight;
  ceilingPanels: THREE.MeshStandardMaterial;
}

export function buildOffice(code: CodeScreen, commits: CommitScreen, stats: StatsPanel, clock: DeskClock): Office {
  const root = new THREE.Group();
  root.name = 'escritorio-vitrine';
  const std = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const mats = {
    floor: woodFloor(),
    wall: std(0x9a948b, 0.95),
    ceiling: std(0xb4b0a8, 0.95),
    frame: std(0x22252b, 0.5, 0.6),
    desk: std(0x3b2a1e, 0.55),
    deskLeg: std(0x1b1d22, 0.4, 0.7),
    black: std(0x0f1014, 0.45, 0.2),
    chair: std(0x1e2128, 0.7),
    book: [0x9fd671, 0x43e6ed, 0xedbd9a, 0xb545ff, 0xd94f4f, 0xe8d6a8].map((c) => std(c, 0.85)),
    rug: std(0x2b3346, 1),
    pot: std(0xc7b9a6, 0.9),
    leaf: std(0x3f7a33, 0.8),
  };

  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const { w, d, h } = ROOM;
  const T = 0.2; // espessura das paredes

  // Chão, teto e paredes (a de −Z é de vidro).
  box(w + T * 2, T, d + T * 2, mats.floor, 0, -T / 2, 0);
  box(w + T * 2, T, d + T * 2, mats.ceiling, 0, h + T / 2, 0);
  box(w + T * 2, h, T, mats.wall, 0, h / 2, d / 2 + T / 2);
  box(T, h, d, mats.wall, -w / 2 - T / 2, h / 2, 0);
  box(T, h, d, mats.wall, w / 2 + T / 2, h / 2, 0);

  // Parede de vidro: peitoril baixo, caixilhos verticais a cada 1,5 m, viga no alto e um vidro levíssimo.
  const sill = 0.35;
  box(w, sill, T, mats.wall, 0, sill / 2, WIN_Z - T / 2);
  box(w, 0.25, T, mats.wall, 0, h - 0.125, WIN_Z - T / 2);
  for (let x = -w / 2; x <= w / 2 + 1e-3; x += 1.5) box(0.07, h, 0.12, mats.frame, x, h / 2, WIN_Z);
  box(w, 0.06, 0.12, mats.frame, 0, sill, WIN_Z);
  box(w, 0.05, 0.1, mats.frame, 0, 2.35, WIN_Z);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h - sill - 0.25),
    new THREE.MeshStandardMaterial({ color: 0x9fc4dd, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.07, depthWrite: false }),
  );
  glass.position.set(0, sill + (h - sill - 0.25) / 2, WIN_Z - 0.02);
  root.add(glass);

  // Tapete, mesa e cadeira.
  box(3.2, RUG_TOP, 2.4, mats.rug, DESK.x, RUG_TOP / 2, (DESK.z + CHAIR.z) / 2).castShadow = false;
  box(DESK.w, 0.04, DESK.d, mats.desk, DESK.x, DESK.top - 0.02, DESK.z);
  for (const sx of [-1, 1]) box(0.05, DESK.top - 0.04, DESK.d - 0.1, mats.deskLeg, DESK.x + sx * (DESK.w / 2 - 0.06), (DESK.top - 0.04) / 2, DESK.z);
  box(CHAIR.width, 0.08, CHAIR.depth, mats.chair, CHAIR.x, CHAIR.seat - 0.04, CHAIR.z);
  box(0.56, 0.62, 0.07, mats.chair, CHAIR.x, CHAIR.seat + 0.36, CHAIR.z + 0.3).rotation.x = -0.12;
  box(0.06, CHAIR.seat - 0.08, 0.06, mats.deskLeg, CHAIR.x, (CHAIR.seat - 0.08) / 2, CHAIR.z);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = box(0.36, 0.04, 0.05, mats.deskLeg, CHAIR.x + Math.cos(a) * 0.18, 0.05, CHAIR.z + Math.sin(a) * 0.18);
    leg.rotation.y = -a;
  }

  // Monitor com o editor, de frente para a cadeira.
  const screenMat = new THREE.MeshBasicMaterial({ map: code.texture, toneMapped: false });
  const monitor = (width: number, x: number, z: number, yaw: number, face: THREE.Material) => {
    const g = new THREE.Group();
    g.position.set(x, DESK.top, z);
    g.rotation.y = yaw;
    root.add(g);
    const height = width * 0.5625;
    box(width + 0.03, height + 0.03, 0.03, mats.black, 0, 0.18 + height / 2, 0, g);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(width, height), face);
    scr.position.set(0, 0.18 + height / 2, 0.017);
    g.add(scr);
    box(0.04, 0.18, 0.04, mats.black, 0, 0.09, -0.04, g);
    box(0.22, 0.015, 0.16, mats.black, 0, 0.008, -0.04, g);
    return g;
  };
  monitor(0.68, DESK.x - 0.12, DESK.z - 0.2, 0, screenMat);

  // Telão dos commits ("o que estou codando agora"): num pedestal à direita da mesa, na altura da cabeça do
  // personagem sentado. Fica à direita dele nos dois enquadramentos (atrás dele, a cabeça cobriria o texto) e
  // girado para a câmera do desktop.
  const BIG = { x: DESK.x + 2.1, y: 1.3, z: DESK.z - 0.05, width: 0.9, yaw: -0.9 };
  const big = new THREE.Group();
  big.position.set(BIG.x, 0, BIG.z);
  big.rotation.y = BIG.yaw;
  root.add(big);
  const bigH = BIG.width * 0.5625;
  box(BIG.width + 0.05, bigH + 0.05, 0.05, mats.black, 0, BIG.y, 0, big);
  const bigScreen = new THREE.Mesh(new THREE.PlaneGeometry(BIG.width, bigH), new THREE.MeshBasicMaterial({ map: commits.texture, toneMapped: false }));
  bigScreen.position.set(0, BIG.y, 0.027);
  big.add(bigScreen);
  box(0.06, BIG.y, 0.06, mats.deskLeg, 0, BIG.y / 2, -0.06, big);
  box(0.5, 0.03, 0.4, mats.deskLeg, 0, 0.015, -0.06, big);

  // Teclado, mouse, caneca e o relógio de mesa com hora e temperatura reais.
  box(0.44, 0.02, 0.14, mats.black, KEYBOARD.x, DESK.top + 0.01, KEYBOARD.z);
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.12), new THREE.MeshBasicMaterial({ color: 0x43e6ed, transparent: true, opacity: 0.18 }));
  keys.rotation.x = -Math.PI / 2;
  keys.position.set(KEYBOARD.x, DESK.top + 0.021, KEYBOARD.z);
  root.add(keys);
  box(0.06, 0.025, 0.1, mats.black, KEYBOARD.x + 0.34, DESK.top + 0.012, KEYBOARD.z + 0.02);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 16), std(0x9fd671, 0.6));
  mug.position.set(DESK.x - 0.66, DESK.top + 0.05, DESK.z + 0.1);
  mug.castShadow = true;
  root.add(mug);
  const clockBody = box(0.2, 0.1, 0.06, mats.black, DESK.x - 0.6, DESK.top + 0.05, DESK.z - 0.18);
  clockBody.rotation.y = 0.35;
  const clockFace = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.09), new THREE.MeshBasicMaterial({ map: clock.texture, toneMapped: false }));
  clockFace.position.set(0, 0, 0.031);
  clockBody.add(clockFace);

  // Luminária de mesa (haste + cúpula) com a luz quente.
  box(0.14, 0.02, 0.14, mats.black, DESK.x - 0.72, DESK.top + 0.01, DESK.z - 0.25);
  box(0.02, 0.42, 0.02, mats.black, DESK.x - 0.72, DESK.top + 0.22, DESK.z - 0.25);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.12, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x1a1c22, emissive: 0xffc98a, emissiveIntensity: 0.3, side: THREE.DoubleSide }));
  shade.position.set(DESK.x - 0.66, DESK.top + 0.43, DESK.z - 0.2);
  shade.rotation.z = -0.5;
  root.add(shade);
  const lamp = new THREE.PointLight(0xffc98a, 0, 5, 2);
  lamp.position.set(DESK.x - 0.62, DESK.top + 0.36, DESK.z - 0.16);
  root.add(lamp);

  const screenGlow = new THREE.PointLight(0x6fd8ff, 0, 3, 2);
  screenGlow.position.set(DESK.x - 0.1, DESK.top + 0.35, DESK.z + 0.2);
  root.add(screenGlow);

  // Estante na parede da esquerda (lado −X), cheia de livros coloridos.
  const shelfX = -w / 2 + 0.2;
  for (let s = 0; s < 5; s++) box(0.36, 0.03, 1.8, mats.desk, shelfX, 0.3 + s * 0.45, 0.6);
  box(0.36, 2.15, 0.03, mats.desk, shelfX, 1.08, 0.6 - 0.9);
  box(0.36, 2.15, 0.03, mats.desk, shelfX, 1.08, 0.6 + 0.9);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let s = 0; s < 4; s++) {
    let z = 0.6 - 0.86;
    while (z < 0.6 + 0.8) {
      const bw = 0.04 + rnd() * 0.05;
      const bh = 0.26 + rnd() * 0.12;
      box(0.24, bh, bw, mats.book[Math.floor(rnd() * mats.book.length)], shelfX + 0.02, 0.315 + s * 0.45 + bh / 2, z + bw / 2);
      z += bw + 0.005;
    }
  }

  // Plantas nos cantos da janela.
  for (const [px, pz, s] of [
    [-w / 2 + 0.55, WIN_Z + 0.55, 1.2],
    [w / 2 - 0.5, WIN_Z + 0.5, 1],
  ] as const) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.15 * s, 0.4 * s, 16), mats.pot);
    pot.position.set(px, 0.2 * s, pz);
    pot.castShadow = true;
    root.add(pot);
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 10, 8), mats.leaf);
      leaf.scale.set(0.6, 1.3, 0.6);
      leaf.position.set(px + Math.cos(i) * 0.14 * s, (0.6 + (i % 3) * 0.22) * s, pz + Math.sin(i) * 0.14 * s);
      leaf.rotation.z = Math.cos(i * 2) * 0.4;
      leaf.castShadow = true;
      root.add(leaf);
    }
  }

  // Painel do GitHub na parede da direita, acima do telão (o "</>" neon que ficava aqui virou o cabeçalho dele).
  const panelW = 1.4;
  const panelH = (panelW * StatsPanel.HEIGHT) / StatsPanel.WIDTH;
  box(0.04, panelH + 0.06, panelW + 0.06, mats.black, w / 2 - 0.02, 2.3, -2.4);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), new THREE.MeshBasicMaterial({ map: stats.texture, toneMapped: false }));
  panel.position.set(w / 2 - 0.045, 2.3, -2.4);
  panel.rotation.y = -Math.PI / 2;
  root.add(panel);
  const neonGlow = new THREE.PointLight(0x43e6ed, 1.2, 4, 2);
  neonGlow.position.set(w / 2 - 0.4, 2.3, -2.4);
  root.add(neonGlow);

  // Painéis de luz no teto (emissivos) e uma luz geral suave, que só acende à noite.
  const ceilingPanels = new THREE.MeshStandardMaterial({ color: 0x202020, emissive: 0xfff1dc, emissiveIntensity: 0 });
  for (const x of [-2.5, 0, 2.5]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.5), ceilingPanels);
    p.position.set(x, h - 0.015, 0.8);
    root.add(p);
  }
  const ceiling = new THREE.PointLight(0xffe8cc, 0, 12, 1.6);
  ceiling.position.set(0, h - 0.4, 1);
  root.add(ceiling);

  return { root, lamp, screenGlow, ceiling, ceilingPanels };
}

/** Assoalho de madeira em canvas (tábuas com tons alternados). */
function woodFloor(): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const tones = ['#4a3426', '#523a2a', '#45301f', '#563d2c'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = tones[i % tones.length];
    g.fillRect(0, i * 32, 256, 32);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, i * 32, 256, 2);
    const cut = (i * 97) % 256;
    g.fillRect(cut, i * 32, 2, 32);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
}

