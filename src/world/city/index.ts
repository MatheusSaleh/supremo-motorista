// Gerador procedural da "Brasília condensada". Só produz um Level: o World cria os colisores a partir
// das malhas. Para trocar por um .glb do OpenStreetMap (Blosm), use levelFromGLTF() e não mexa no resto.
import type { GarageSlot, Level } from '../Level';
import { buildAeroporto } from './aeroporto';
import { buildAsas } from './asas';
import { buildCentro } from './centro';
import { buildOeste } from './oeste';
import { buildOrla } from './orla';
import { buildVida } from './vida';
import { CityBuilder, type Rect } from './builder';
import { buildEixao } from './eixao';
import { buildEsplanada } from './esplanada';
import { buildLago, lakeWater } from './lago';
import { BOUNDS, EIXO, LAKE, OPEN_ON_PURPOSE, garageLayout } from './layout';
import { lawnMaterial } from './materials';
import { buildMarcos } from './marcos';
import { buildPonte } from './ponte';
import { buildPraca, garageSpawns } from './praca';
import { buildBounds, buildFactionFlags, buildSigns, buildStreetLights, buildTrees } from './props';
import { drapeOnTerrain } from './drape';
import { tintGround } from './ground';
import { CityKit } from './quadras';
import { createTerrain } from './terrain';
import { measureOccupancy } from './occupancy';

/** @param month mês (0–11) para a floração dos ipês; padrão: o mês atual. */
export function createCity(seed = 1960, month = new Date().getMonth()): Level {
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
    m.userData.drape = 'ground'; // deformado antes do resto (drape.ts)
  }
  // O gramado central da Esplanada fica livre de árvores.
  b.occupy({ minX: -EIXO.lawnHalfWidth, maxX: EIXO.lawnHalfWidth, minZ: EIXO.walkStartZ, maxZ: EIXO.walkEndZ });

  buildEsplanada(b);
  const garageLamps = buildPraca(b);
  buildLago(b);
  buildEixao(b);
  buildAeroporto(b);
  buildMarcos(b);
  buildPonte(b);

  // Cidade densa (docs/PLANO-MAPA.md): as regiões novas usam o kit de quadras/lotes.
  const kit = new CityKit(b);
  buildAsas(b, kit);
  buildCentro(b, kit);
  buildOeste(b, kit);
  buildOrla(b, kit);
  const busStops = buildVida(b);
  kit.flush();

  buildSigns(b);
  buildStreetLights(b);
  buildFactionFlags(b);
  buildTrees(b, land, 2600, month);
  buildBounds(b, BOUNDS);

  // Diagnóstico (só em dev): quanto da terra firme ainda é gramado vazio. Ver docs/PLANO-MAPA.md.
  if (import.meta.env.DEV) {
    const lawn = { minX: -EIXO.lawnHalfWidth, maxX: EIXO.lawnHalfWidth, minZ: EIXO.walkStartZ, maxZ: EIXO.walkEndZ };
    const report = measureOccupancy(b.root, BOUNDS, land, [lawn, ...OPEN_ON_PURPOSE]);
    b.root.userData.occupancy = report;
    console.info(`[cidade] gramado vazio: ${(report.emptyFraction * 100).toFixed(1)}% da terra firme; maior mancha ${report.largestEmptyKm2.toFixed(2)} km²`);
  }

  // Relevo real (ver terrain.ts): a cidade foi gerada no plano e agora acompanha o terreno.
  const terrain = createTerrain();
  const heightAt = (x: number, z: number) => terrain.heightAt(x, z);
  drapeOnTerrain(b.root, heightAt);
  tintGround(b.root);
  if (import.meta.env.DEV) console.info(`[cidade] relevo: escala vertical ${terrain.verticalScale.toFixed(2)}, Praça ${heightAt(0, -1150).toFixed(1)} m, Rodoviária ${heightAt(0, 960).toFixed(1)} m, Torre ${heightAt(0, 1620).toFixed(1)} m`);

  b.root.updateMatrixWorld(true);
  const onGround = <T extends { x: number; y: number; z: number }>(p: T) => ((p.y += heightAt(p.x, p.z)), p);
  const garages: GarageSlot[] = garageLamps.map((lamp, i) => {
    const s = garageSpawns(i);
    onGround(s.player);
    for (const f of s.fleet) onGround(f.position);
    const { x, z } = garageLayout(i);
    return { center: { x, z }, spawn: s.player, spawnYaw: s.playerYaw, fleet: s.fleet, lamp };
  });
  const home = garages[0];
  return {
    root: b.root,
    spawn: home.spawn,
    spawnYaw: home.spawnYaw,
    vehicleSpawn: home.fleet[2],
    fleetSpawns: home.fleet,
    garages,
    heightAt,
    roads: b.roadSegments,
    busStops,
    landmarks: b.landmarks,
    bounds: { ...BOUNDS },
    addresses: b.addresses,
    water: lakeWater(),
  };
}
