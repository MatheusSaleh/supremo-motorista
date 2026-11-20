// Eixão (norte–sul, logo a oeste da Rodoviária) com as tesourinhas. As superquadras 100 ficam em oeste.ts.
// Tesourinha (versão de jogo): o Eixão sobe numa "lombada-viaduto" sobre a pista local, que passa por
// baixo; a crista da rampa rende saltos. As alças em trevo são decorativas (no nível do chão).
import * as THREE from 'three';
import { t } from '../../core/i18n';
import { sectorName } from '../../data/addresses';
import { rectOf, type CityBuilder } from './builder';
import { EIXAO, ROAD } from './layout';

export function buildEixao(b: CityBuilder): void {
  const g = b.group('eixao');
  const z = EIXAO.z;
  const half = EIXAO.hump.run + EIXAO.hump.deck / 2; // meia extensão da lombada (60 m)

  // Trechos planos entre as tesourinhas.
  const stops = [EIXAO.minX, ...EIXAO.tesourinhas.flatMap((x) => [x - half, x + half]), EIXAO.maxX];
  for (let i = 0; i < stops.length; i += 2) b.road(g, 'main', stops[i], z, stops[i + 1], z, 'both');
  // Por cima das lombadas-viaduto: liga os trechos planos no grafo de navegação.
  for (const x of EIXAO.tesourinhas) b.navLink(x - half, z, x + half, z, ROAD.main);

  EIXAO.tesourinhas.forEach((xc, i) => buildTesourinha(b, g, xc, i + 1));

  b.landmarks.push({ name: t('place.eixao'), x: -1150, z });
  b.signs.push({ x: 300, z: z - ROAD.main / 2 - 4, yaw: 0, title: 'EPT · Eixão', subtitle: sectorName('EPT') });
}

function buildTesourinha(b: CityBuilder, g: THREE.Object3D, xc: number, n: number): void {
  const m = b.mats;
  const z = EIXAO.z;
  const { height: H, run, kick, kickRise, deck } = EIXAO.hump;
  const w = ROAD.main;

  // Rampas (cunhas sólidas) dos dois lados: trecho suave + kicker; tabuleiro sobre a pista local.
  for (const s of [-1, 1]) {
    const edge = xc + s * (deck / 2);
    const mid = xc + s * (deck / 2 + kick);
    const foot = xc + s * (deck / 2 + run);
    b.wedge(g, 'x', Math.min(foot, mid), Math.max(foot, mid), s < 0 ? 0 : H - kickRise, s < 0 ? H - kickRise : 0, z, w, m.asphaltSolid);
    b.wedge(g, 'x', Math.min(mid, edge), Math.max(mid, edge), s < 0 ? H - kickRise : H, s < 0 ? H : H - kickRise, z, w, m.asphaltSolid);
    // Faixas pintadas sobre as rampas (mesma textura do Eixão).
    rampDecal(b, g, foot, 0, mid, H - kickRise, z);
    rampDecal(b, g, mid, H - kickRise, edge, H, z);
    // Aviso antes do salto, para quem vem deste lado (placa virada para o motorista).
    const signX = xc + s * (half(EIXAO.hump) + 45);
    b.signs.push({ x: signX, z: z - s * (w / 2 + 4), yaw: s < 0 ? -Math.PI / 2 : Math.PI / 2, title: t('sign.jump.title'), subtitle: t('sign.jump.subtitle') });
  }
  rampDecal(b, g, xc - deck / 2, H, xc + deck / 2, H, z);
  b.box(g, deck, 1.2, w, m.asphaltSolid, xc, H - 0.6, z);
  // Guarda-corpos baixos no tabuleiro (o carro não cai de lado sem querer).
  for (const s of [-1, 1]) b.box(g, deck, 0.6, 0.3, m.concrete, xc, H + 0.3, z + s * (w / 2 - 0.15));
  b.occupy(rectOf(xc, z, deck + 2 * run, w, 3));

  // Pista local que passa por baixo.
  b.road(g, 'local', xc, EIXAO.crossRoad.minZ, xc, EIXAO.crossRoad.maxZ, 'none');

  // Alças em trevo: 3/4 de anel em cada quadrante, com a abertura voltada para o cruzamento.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const gap = Math.atan2(sz, -sx); // direção do cruzamento no plano do anel (ver rotação abaixo)
      const ring = new THREE.Mesh(new THREE.RingGeometry(23, 31, 28, 1, gap + Math.PI / 4, Math.PI * 1.5), m.asphalt);
      ring.rotation.x = -Math.PI / 2; // (x, y) do anel → (x, −z) no chão
      ring.position.set(xc + sx * 45, 0.015, z + sz * 45);
      ring.receiveShadow = true;
      ring.userData.noCollision = true;
      g.add(ring);
    }
  }

  b.signs.push({ x: xc + ROAD.local / 2 + 4, z: z + w / 2 + 40, yaw: Math.PI, title: `EPT · ${t('addr.trecho', { v: n })}`, subtitle: sectorName('EPT') });
}

function half(h: { run: number; deck: number }): number {
  return h.run + h.deck / 2;
}

/** Faixa de asfalto pintado sobre um trecho de rampa ao longo de X, de (a0, h0) a (a1, h1). */
function rampDecal(b: CityBuilder, g: THREE.Object3D, a0: number, h0: number, a1: number, h1: number, z: number): void {
  const len = Math.hypot(a1 - a0, h1 - h0);
  const geo = new THREE.PlaneGeometry(ROAD.main, len);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / 12));
  geo.rotateX(-Math.PI / 2); // comprimento ao longo de Z
  geo.rotateY(Math.PI / 2); // … agora ao longo de X
  geo.rotateZ(Math.atan2(h1 - h0, a1 - a0)); // inclinação da rampa
  const m = new THREE.Mesh(geo, b.mats.road);
  m.position.set((a0 + a1) / 2, (h0 + h1) / 2 + 0.03, z);
  m.receiveShadow = true;
  m.userData.noCollision = true;
  m.userData.surface = 'asphalt';
  g.add(m);
}
