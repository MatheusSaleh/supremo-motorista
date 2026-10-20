// Materiais e texturas procedurais (canvas) do cenário.
import * as THREE from 'three';
import { t } from '../../core/i18n';
import { createRng } from '../../core/random';
import { FACTIONS, type FactionId } from '../../data/factions';
import { ROAD } from './layout';

export type Materials = ReturnType<typeof createMaterials>;

export function createMaterials() {
  const std = (color: number, roughness = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  // Pistas ficam coplanares ao chão: polygonOffset evita z-fighting. Pistas locais um pouco "acima"
  // das principais, para o cruzamento sempre mostrar a mesma.
  const decal = (units: number) => ({ polygonOffset: true, polygonOffsetFactor: units, polygonOffsetUnits: units });

  const grass = createGrassTexture();
  // Efeitos do ambiente (env/Atmosphere) leem estes marcadores em userData:
  //  wetRoad → escurece e brilha com chuva; nightGlow → janelas acesas à noite (intensidade máxima).
  const wet = <T extends THREE.Material>(m: T) => ((m.userData.wetRoad = true), m);
  const windows = (m: THREE.MeshStandardMaterial, glow: number) => {
    m.emissive.set(0xffd9a0);
    m.emissiveMap = m.map;
    m.emissiveIntensity = 0;
    m.userData.nightGlow = glow;
    return m;
  };
  return {
    grassTexture: grass,
    road: wet(std(0xffffff, 0.9, { map: createRoadTexture(ROAD.main, 6, false), ...decal(-2) })),
    roadLocal: wet(std(0xffffff, 0.9, { map: createRoadTexture(ROAD.local, 2, true), ...decal(-3) })),
    asphalt: wet(std(0x3f4043, 0.92, decal(-2))),
    asphaltSolid: wet(std(0x46474a, 0.9)),
    runway: wet(std(0xffffff, 0.9, { map: createRunwayTexture(), ...decal(-2) })),
    walk: std(0xc9c4b8, 0.95),
    plaza: std(0xdedad0, 0.9),
    concrete: std(0xeeece6, 0.8),
    concreteDark: std(0xb9b6ae, 0.9),
    roof: std(0x8f8d88, 0.95),
    glass: windows(std(0xffffff, 0.35, { map: createGlassFacadeTexture(25, 10), metalness: 0.2 }), 0.55),
    towerGlass: windows(std(0xffffff, 0.35, { map: createGlassFacadeTexture(22 / 3, 28), metalness: 0.2 }), 0.55),
    blockFacade: windows(std(0xffffff, 0.8, { map: createBlockFacadeTexture() }), 0.35),
    cathedralGlass: new THREE.MeshStandardMaterial({
      color: 0x9cc8e6,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    // Rugosidade moderada: com o sol alto, um espelho perfeito estoura para branco visto de cima.
    water: new THREE.MeshStandardMaterial({ color: 0x2a6383, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.9 }),
    lakeBed: std(0x5d5a48, 1),
    pool: std(0x4fc3e8, 0.1, decal(-4)),
    white: std(0xf6f5f0, 0.7),
    whiteDouble: std(0xf6f5f0, 0.7, { side: THREE.DoubleSide }),
    wood: std(0x8a6a48, 0.9),
    metal: std(0x8d9196, 0.5, { metalness: 0.5 }),
    /** Postes: só a luminária (UV na metade direita do emissiveMap) acende à noite. */
    streetLamp: lampMaterial(),
    signPost: std(0x7a7f85, 0.6, { metalness: 0.3 }),
    yellow: std(0xf2d24b, 0.8),
    /** Cor por instância (InstancedMesh.setColorAt). */
    tinted: std(0xffffff, 0.85),
    tintedFlat: std(0xffffff, 0.9, { flatShading: true }),
  };
}

function lampMaterial(): THREE.MeshStandardMaterial {
  const map = canvasTexture(2, 1, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = '#fff';
    ctx.fillRect(1, 0, 1, 1);
  });
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  const m = new THREE.MeshStandardMaterial({ color: 0x8d9196, roughness: 0.5, metalness: 0.5, emissive: 0xffe2a8, emissiveMap: map, emissiveIntensity: 0 });
  m.userData.lampGlow = 4;
  return m;
}

/** Bandeira: fundo, faixa de destaque e um texto. Usada no cenário e nos carros (facções, imprensa). */
export function flagMaterial(color: number, accent: number, text: string): THREE.MeshStandardMaterial {
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const tex = canvasTexture(256, 160, (ctx) => {
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = hex(accent);
    ctx.fillRect(0, 118, 256, 14);
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 66, 236);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 });
}

/** Bandeira de uma facção fictícia (cor, faixa de destaque e o nome). */
export function factionFlagMaterial(f: FactionId): THREE.MeshStandardMaterial {
  const fac = FACTIONS[f];
  return flagMaterial(fac.color, fac.accent, t(`faction.flag.${f}`));
}

/** Material de grama com a textura repetida a cada 6 m para um retângulo w×d. */
export function lawnMaterial(mats: Materials, w: number, d: number): THREE.MeshStandardMaterial {
  const tex = mats.grassTexture.clone();
  tex.repeat.set(w / 6, d / 6);
  tex.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function createGrassTexture(): THREE.CanvasTexture {
  const rng = createRng(7);
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#6a9a45';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      const v = Math.floor(rng() * 30);
      ctx.fillStyle = `rgb(${90 + v}, ${135 + v}, ${55 + v / 2})`;
      ctx.fillRect(rng() * 128, rng() * 128, 2, 2);
    }
  });
}

/**
 * Asfalto com faixas: U = largura da pista, V = 12 m de comprimento (tracejado de 4 m).
 * Pista local: faixa central amarela tracejada; principal: divisórias brancas.
 */
function createRoadTexture(widthM: number, lanes: number, local: boolean): THREE.CanvasTexture {
  const ppm = 10;
  const w = widthM * ppm;
  const h = 12 * ppm;
  const rng = createRng(3 + lanes);
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = '#3c3d40';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < w * 6; i++) {
      ctx.fillStyle = rng() > 0.5 ? '#45464a' : '#353639';
      ctx.fillRect(rng() * w, rng() * h, 2, 2);
    }
    const shoulder = local ? 1 : 1.5;
    const lane = (widthM - 2 * shoulder) / lanes;
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(shoulder * ppm - 2, 0, 3, h); // bordas contínuas
    ctx.fillRect(w - shoulder * ppm - 1, 0, 3, h);
    for (let k = 1; k < lanes; k++) {
      const x = (shoulder + k * lane) * ppm;
      ctx.fillStyle = local ? '#e8c440' : '#f2f2f2';
      ctx.fillRect(x - 1, 0, local ? 3 : 2, 4 * ppm); // tracejado
    }
  });
}

/** Pista do aeroporto: U = 45 m de largura, V = 60 m (faixa central tracejada de 30 m). */
function createRunwayTexture(): THREE.CanvasTexture {
  const ppm = 6;
  const w = 45 * ppm;
  const h = 60 * ppm;
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = '#2f3033';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(2 * ppm, 0, ppm, h);
    ctx.fillRect(w - 3 * ppm, 0, ppm, h);
    ctx.fillRect(w / 2 - ppm / 2, 0, ppm, 30 * ppm);
  });
}

/** Fachada de vidro: um módulo por textura, repetido (colunas × andares). */
export function createGlassFacadeTexture(columns: number, floors: number): THREE.CanvasTexture {
  const tex = canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = '#4f736f';
    ctx.fillRect(0, 0, 64, 64);
    const g = ctx.createLinearGradient(0, 0, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#d9d7cf';
    ctx.fillRect(0, 52, 64, 12); // peitoril entre andares
    ctx.fillRect(0, 0, 3, 64); // montante
  });
  tex.repeat.set(columns, floors);
  return tex;
}

/** Fachada de bloco residencial (superquadra): faixas de janelas, sem repetição (UV 0..1 por face). */
function createBlockFacadeTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = '#e9e4d8';
    ctx.fillRect(0, 0, 256, 128);
    // Pilotis (térreo livre) escuro.
    ctx.fillStyle = '#6f6c66';
    ctx.fillRect(0, 108, 256, 20);
    ctx.fillStyle = '#56758a';
    for (let floor = 0; floor < 6; floor++) {
      const y = 8 + floor * 16.5;
      for (let x = 4; x < 252; x += 12) ctx.fillRect(x, y, 9, 10);
    }
  });
}
