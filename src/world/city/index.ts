// Gerador procedural da "Brasília condensada". Só produz um Level: o World cria os colisores a partir
// das malhas. Para trocar por um .glb do OpenStreetMap (Blosm), use levelFromGLTF() e não mexa no resto.
import type { Level } from '../Level';
import { buildAeroporto } from './aeroporto';
import { CityBuilder, type Rect } from './builder';
import { buildEixao } from './eixao';
import { buildEsplanada } from './esplanada';
import { buildLago, lakeWater } from './lago';
import { BOUNDS, EIXO, LAKE } from './layout';
import { lawnMaterial } from './materials';
import { buildMarcos } from './marcos';
import { buildPonte } from './ponte';
import { buildPraca, garageSpawns } from './praca';
import { buildBounds, buildSigns, buildStreetLights, buildTrees } from './props';
import { drapeOnTerrain } from './drape';
import { createTerrain } from './terrain';

export function createCity(seed = 1960): Level {
  const b = new CityBuilder(seed);

  // Terra firme: tudo ao norte/oeste da margem + a península do Lago Sul.
  const land: Rect[] = [
    { minX: BOUNDS.minX, maxX: BOUNDS.maxX, minZ: LAKE.shoreZ, maxZ: BOUNDS.maxZ },
    { minX: LAKE.shoreX, maxX: BOUNDS.maxX, minZ: BOUNDS.minZ, maxZ: LAKE.shoreZ },
  ];
  const ground = b.group('chao');
  for (const r of land) {
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const m = b.box(ground, w, 1, d, lawnMaterial(b.mats, w, d), (r.minX + r.maxX) / 2, -0.5, (r.minZ + r.maxZ) / 2);
    m.castShadow = false;
    m.userData.surface = 'grass';
  }
  // O gramado central da Esplanada fica livre de árvores.
  b.occupy({ minX: -EIXO.lawnHalfWidth, maxX: EIXO.lawnHalfWidth, minZ: EIXO.walkStartZ, maxZ: EIXO.walkEndZ });

  buildEsplanada(b);
  buildPraca(b);
  buildLago(b);
  buildEixao(b);
  buildAeroporto(b);
  buildMarcos(b);
  buildPonte(b);

  buildSigns(b);
  buildStreetLights(b);
  buildTrees(b, land, 2600);
  buildBounds(b, BOUNDS);

  // Relevo real (ver terrain.ts): a cidade foi gerada no plano e agora acompanha o terreno.
  const terrain = createTerrain();
  const heightAt = (x: number, z: number) => terrain.heightAt(x, z);
  drapeOnTerrain(b.root, heightAt);
  if (import.meta.env.DEV) console.info(`[cidade] relevo: escala vertical ${terrain.verticalScale.toFixed(2)}, Praça ${heightAt(0, -1150).toFixed(1)} m, Rodoviária ${heightAt(0, 960).toFixed(1)} m, Torre ${heightAt(0, 1620).toFixed(1)} m`);

  b.root.updateMatrixWorld(true);
  const s = garageSpawns();
  const onGround = <T extends { x: number; y: number; z: number }>(p: T) => ((p.y += heightAt(p.x, p.z)), p);
  onGround(s.player);
  for (const f of s.fleet) onGround(f.position);
  return {
    root: b.root,
    spawn: s.player,
    spawnYaw: s.playerYaw,
    vehicleSpawn: s.fleet[2],
    fleetSpawns: s.fleet,
    heightAt,
    landmarks: b.landmarks,
    bounds: { ...BOUNDS },
    addresses: b.addresses,
    water: lakeWater(),
  };
}
