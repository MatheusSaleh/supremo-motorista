// Nível de teste da Fase 1: chão grande + obstáculos para testar colisão, rampa, degraus e pulo.
// Será substituído pelo cenário da Esplanada (world/esplanada.ts) na Fase 3.
import * as THREE from 'three';
import type { Level } from './Level';

export function createTestArena(): Level {
  const level = new THREE.Group();
  level.name = 'testArena';

  // Chão: caixa fina com topo em y = 0 (vira cuboide no Rapier).
  const groundSize = 400;
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(groundSize, 1, groundSize),
    new THREE.MeshStandardMaterial({ map: createCheckerTexture(groundSize / 4), roughness: 0.95 }),
  );
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  ground.userData.surface = 'grass';
  level.add(ground);

  const box = (w: number, h: number, d: number, x: number, z: number, color: number, y = h / 2) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
    );
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    level.add(m);
    return m;
  };

  // Cubos soltos.
  box(2, 2, 2, 6, -4, 0xc0504d);
  box(1, 1, 1, -5, -6, 0x4f81bd);
  box(3, 3, 3, -8, 6, 0x9bbb59);
  box(1.2, 0.8, 1.2, 3, 7, 0x8064a2); // dá para subir pulando

  // Parede longa para testar deslizamento.
  box(20, 3, 0.6, 0, -14, 0xd9d9d9);
  // Parede diagonal.
  box(12, 3, 0.6, 14, 4, 0xbfbfbf).rotation.y = Math.PI / 4;

  // Rampa (~17°).
  const ramp = box(4, 0.4, 10, -14, -4, 0xf2c14e);
  ramp.rotation.x = -0.3;
  ramp.position.y = 1.3;

  // Degraus (o autostep sobe degraus baixos sem pular).
  for (let i = 0; i < 6; i++) {
    const h = 0.25 * (i + 1);
    box(3, h, 1, 16, -10 - i, 0xa5a5a5);
  }

  // Plataforma alta (precisa da escada para chegar).
  box(3, 1.5, 4, 16, -18, 0x7f7f7f);

  // Pilares.
  for (let i = 0; i < 5; i++) box(0.6, 5, 0.6, -20 + i * 4, 14, 0xeeeeee);

  level.updateMatrixWorld(true);
  return {
    root: level,
    spawn: new THREE.Vector3(0, 0.5, 0),
    spawnYaw: Math.PI,
    vehicleSpawn: { position: new THREE.Vector3(5, 0, 4), yaw: Math.PI },
    landmarks: [{ name: 'Escada', x: 16, z: -12 }],
    bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
    addresses: [],
    water: [],
  };
}

function createCheckerTexture(repeat: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#6f9a4a';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#648d42';
  ctx.fillRect(0, 0, size / 2, size / 2);
  ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
