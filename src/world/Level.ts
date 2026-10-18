// Contrato entre "fonte do cenário" (procedural ou .glb) e o resto do jogo.
// World só precisa de um Level; trocar esplanada.ts por um .glb do Blosm não afeta mais nada.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface Landmark {
  name: string;
  x: number;
  z: number;
}

export interface LevelBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Ponto de embarque/desembarque endereçável (usado pelas corridas). */
export interface AddressPoint {
  id: string;
  /** Endereço formatado (ex.: "SQB-N 106 Bloco C"). */
  label: string;
  x: number;
  z: number;
}

/** Área de água: abaixo de `level` (y) dentro do retângulo, carro/jogador voltam ao último ponto seguro. */
export interface WaterArea extends LevelBounds {
  level: number;
}

export interface Level {
  root: THREE.Object3D;
  /** Posição dos pés no spawn. */
  spawn: THREE.Vector3;
  /** Direção inicial do jogador (0 = olhando para +Z). */
  spawnYaw: number;
  /** Onde o carro oficial começa (posição no chão + direção). */
  vehicleSpawn: { position: THREE.Vector3; yaw: number };
  /** Vagas da frota, na ordem de data/vehicles FLEET (opcional: sem elas, só o carro padrão). */
  fleetSpawns?: { position: THREE.Vector3; yaw: number }[];
  /** Pontos de interesse (minimapa, teleporte de debug). */
  landmarks: Landmark[];
  /** Área jogável (minimapa). */
  bounds: LevelBounds;
  addresses: AddressPoint[];
  water: WaterArea[];
  /** Altura do chão em (x, z) (relevo); sem ela, o chão é plano em y = 0. */
  heightAt?: (x: number, z: number) => number;
}

/**
 * Converte um .glb em Level. Convenções (nomes de objetos no Blender):
 *  - "Spawn": empty com a posição/rotação inicial do jogador
 *  - "CarSpawn": empty com a posição/rotação inicial do carro
 *  - objetos com custom property `landmark` = "Nome" viram landmarks
 *  - custom properties `noCollision` / `cameraIgnore` são respeitadas pelo World
 */
export function levelFromGLTF(gltf: GLTF): Level {
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const spawn = new THREE.Vector3(0, 2, 0);
  let spawnYaw = 0;
  let vehicleSpawn: Level['vehicleSpawn'] | null = null;
  const yawOf = (o: THREE.Object3D) =>
    new THREE.Euler().setFromQuaternion(o.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
  const landmarks: Landmark[] = [];
  const tmp = new THREE.Vector3();

  root.traverse((o) => {
    if (o.name.toLowerCase() === 'spawn') {
      o.getWorldPosition(spawn);
      spawnYaw = yawOf(o);
      o.userData.noCollision = true;
    }
    if (o.name.toLowerCase() === 'carspawn') {
      vehicleSpawn = { position: o.getWorldPosition(new THREE.Vector3()), yaw: yawOf(o) };
      o.userData.noCollision = true;
    }
    if (typeof o.userData.landmark === 'string') {
      o.getWorldPosition(tmp);
      landmarks.push({ name: o.userData.landmark, x: tmp.x, z: tmp.z });
    }
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });

  const box = new THREE.Box3().setFromObject(root);
  return {
    root,
    spawn,
    spawnYaw,
    // Sem "CarSpawn": carro ao lado do jogador.
    vehicleSpawn: vehicleSpawn ?? { position: spawn.clone().add(new THREE.Vector3(4, 0, 0)), yaw: spawnYaw },
    landmarks,
    bounds: { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z },
    addresses: [],
    water: [],
  };
}
