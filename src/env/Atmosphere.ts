// Traduz o estado do ambiente (hora, clima) em visual e física: céu, neblina, sol/lua, luz ambiente,
// postes e janelas acesos à noite, faróis, asfalto molhado, chuva (visual e som) e aderência.
// Tudo que precisa existir (farol, chuva) é criado no início e só muda de intensidade/visibilidade:
// acender ou apagar luzes depois do carregamento recompilaria os shaders (travada).
import * as THREE from 'three';
import type { AudioSystem, LoopHandle } from '../audio/AudioSystem';
import type { Car } from '../vehicle/Car';
import type { CarEffects } from '../vehicle/CarEffects';
import type { Lighting, World } from '../world/World';
import type { EnvSnapshot } from './Environment';
import { Rain } from './Rain';

/** Céu e luz por elevação do sol (graus); interpolado entre as chaves. */
const KEYS = [
  // Noite "de jogo": escura, mas legível (lua + céu urbano).
  { el: -18, top: 0x050a18, bottom: 0x141b30, sun: 0x9db2ff, sunI: 0.4, hemiSky: 0x44557c, hemiGround: 0x181a20, hemiI: 0.62 },
  { el: -6, top: 0x0e1a3a, bottom: 0x353c5c, sun: 0x9db2ff, sunI: 0.4, hemiSky: 0x4d5b80, hemiGround: 0x1c1d24, hemiI: 0.66 },
  { el: -1, top: 0x284780, bottom: 0xd98a62, sun: 0xff9050, sunI: 0.55, hemiSky: 0x8c8fb0, hemiGround: 0x3b3328, hemiI: 0.7 },
  { el: 6, top: 0x3d6fc0, bottom: 0xf0c59c, sun: 0xffc387, sunI: 1.7, hemiSky: 0xc9d8f0, hemiGround: 0x5d6446, hemiI: 0.9 },
  { el: 20, top: 0x3d7fd6, bottom: 0xcfe3f2, sun: 0xfff3e0, sunI: 2.6, hemiSky: 0xdcecff, hemiGround: 0x6b7a4f, hemiI: 1.1 },
];
/** Lua (direção fixa, só para a luz noturna). */
const MOON_DIR = new THREE.Vector3(-0.35, 0.85, 0.4).normalize();
const FOG = { near: 250, far: 2600 };

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, rate * dt);

export class Atmosphere {
  /** Escuridão (0 dia → 1 noite), para quem quiser (HUD, falas, som ambiente). */
  night = 0;
  /** Chuva atual (suavizada), 0..1. */
  get rainLevel(): number {
    return this.rainAmt;
  }
  private readonly rain = new Rain();
  private rainSound: LoopHandle | null = null;
  private readonly headlight = new THREE.SpotLight(0xfff4e0, 0, 90, 0.5, 0.55, 1.4);
  private readonly lighting: Lighting = {
    skyTop: new THREE.Color(),
    skyBottom: new THREE.Color(),
    fogColor: new THREE.Color(),
    fogNear: FOG.near,
    fogFar: FOG.far,
    sunColor: new THREE.Color(),
    sunIntensity: 1,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 1,
  };
  // Clima suavizado (transições graduais quando muda).
  private cloud = 0;
  private rainAmt = 0;
  private fog = 0;
  private dry = 0;
  private wet = 0;
  private first = true;
  private readonly lamps: THREE.MeshStandardMaterial[] = [];
  private readonly windows: THREE.MeshStandardMaterial[] = [];
  private readonly roads: { mat: THREE.MeshStandardMaterial; color: THREE.Color; roughness: number }[] = [];
  private carLights: THREE.MeshStandardMaterial[] = [];
  private readonly dir = new THREE.Vector3();
  private readonly tmpA = new THREE.Color();
  private readonly tmpB = new THREE.Color();

  constructor(
    private readonly world: World,
    private readonly audio: AudioSystem,
  ) {
    world.scene.add(this.rain.mesh);
    for (const m of world.levelMaterials()) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      if (m.userData.lampGlow) this.lamps.push(m);
      if (m.userData.nightGlow) this.windows.push(m);
      if (m.userData.wetRoad) this.roads.push({ mat: m, color: m.color.clone(), roughness: m.roughness });
    }
    // Farol do carro atual: um SpotLight só, preso à frente do carro (ver attachCar).
    this.headlight.castShadow = false;
    this.headlight.name = 'farol';
  }

  /** O farol acompanha o carro em que Josué está; as lanternas de todos os carros acendem à noite. */
  attachCar(car: Car, all: readonly Car[]): void {
    const root = car.model.root;
    root.add(this.headlight, this.headlight.target);
    this.headlight.position.set(0, 0.35, 2.1);
    this.headlight.target.position.set(0, -0.6, 14);
    this.carLights = [];
    for (const c of all)
      c.model.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        for (const m of [o.material].flat())
          if (m instanceof THREE.MeshStandardMaterial && m.name === 'headlight' && !this.carLights.includes(m)) this.carLights.push(m);
      });
  }

  update(dt: number, s: EnvSnapshot, cameraPos: THREE.Vector3, cars: readonly Car[], effects: CarEffects, driving: boolean): void {
    const w = s.weather;
    const rate = this.first ? 1e3 : 0.25; // no primeiro frame já começa no estado certo
    this.first = false;
    this.cloud = approach(this.cloud, w.cloud, rate, dt);
    this.rainAmt = approach(this.rainAmt, w.rain, rate, dt);
    this.fog = approach(this.fog, w.kind === 'fog' ? 1 : 0, rate, dt);
    this.dry = approach(this.dry, s.dry ? 1 : 0, rate, dt);
    // Molha rápido, seca devagar (a pista continua molhada um tempo depois da chuva).
    this.wet = approach(this.wet, w.rain > 0 ? 1 : 0, w.rain > 0 ? Math.max(rate, 0.3) : Math.min(rate, 0.02), dt);

    const el = s.sunElevation;
    const n = smoothstep(2, -6, el);
    this.night = n;
    const L = this.lighting;
    this.sample(el, L);

    // Nuvens/chuva: céu acinzentado (escuro à noite), sol mais fraco.
    const grey = Math.min(1, this.cloud * 0.6 + this.rainAmt * 0.6);
    const dayLum = (1 - 0.88 * n) * (1 - 0.3 * this.rainAmt); // chuva escurece o céu
    L.skyTop.lerp(this.tmpA.setHex(0x6f7780).multiplyScalar(dayLum), grey);
    L.skyBottom.lerp(this.tmpB.setHex(0x9da4ab).multiplyScalar(dayLum), grey);
    L.sunIntensity *= (1 - 0.7 * this.cloud) * (1 - 0.5 * this.rainAmt) * (1 - 0.5 * this.fog);
    L.hemiIntensity *= 1 - 0.2 * this.rainAmt;
    // Seca: névoa de poeira amarelada no horizonte e sol mais quente.
    L.skyBottom.lerp(this.tmpA.setHex(0xd8c19a).multiplyScalar(dayLum), 0.45 * this.dry);
    L.sunColor.lerp(this.tmpA.setHex(0xffd9a8), 0.4 * this.dry);
    L.fogColor.copy(L.skyBottom);
    L.fogNear = FOG.near * (1 - 0.85 * this.rainAmt) * (1 - 0.9 * this.fog);
    L.fogFar = FOG.far * (1 - 0.8 * this.rainAmt) * (1 - 0.85 * this.fog) * (1 - 0.42 * this.dry);
    this.world.setLighting(L);

    // Sol de dia, lua à noite (o sol rasante é limitado para as sombras não ficarem infinitas).
    if (el > -2) {
      this.dir.copy(s.sunDir);
      if (this.dir.y < 0.15) this.dir.setY(0.15).normalize();
    } else this.dir.copy(MOON_DIR);
    this.world.setSunDirection(this.dir);

    // Luzes da cidade e dos carros: à noite, ou de dia com tempestade escura.
    const lightsOn = Math.max(n, 0.45 * this.rainAmt * this.cloud, 0.6 * this.fog);
    for (const m of this.lamps) m.emissiveIntensity = (m.userData.lampGlow as number) * lightsOn;
    for (const m of this.windows) m.emissiveIntensity = (m.userData.nightGlow as number) * n;
    this.headlight.intensity = driving ? 900 * lightsOn : 0; // estacionado: farol apagado
    for (const m of this.carLights) {
      if (m.emissive.getHex() === 0) m.emissive.setHex(0xfff2d6);
      m.emissiveIntensity = 0.3 + 2.2 * lightsOn;
    }

    // Asfalto molhado: mais escuro e mais liso (reflete faróis e sol).
    for (const r of this.roads) {
      r.mat.color.copy(r.color).multiplyScalar(1 - 0.45 * this.wet);
      r.mat.roughness = r.roughness + (0.32 - r.roughness) * this.wet;
    }
    for (const c of cars) c.weatherGrip = 1 - 0.22 * this.wet;
    effects.wet = this.wet;

    this.rain.update(dt, cameraPos, this.rainAmt, n);
    if (this.rainAmt > 0.01 && !this.rainSound) this.rainSound = this.audio.noiseLoop('ambient', 1600, 0.35);
    this.rainSound?.setVolume(0.55 * this.rainAmt, 0.5);
  }

  /**
   * Meio-dia de céu limpo, só para a captura do minimapa (que tem que sair igual de noite ou na chuva).
   * O próximo update() volta ao estado real.
   */
  applyDaylight(): void {
    const L = this.lighting;
    this.sample(60, L);
    L.fogColor.copy(L.skyBottom);
    L.fogNear = FOG.near;
    L.fogFar = FOG.far;
    this.world.setLighting(L);
    this.world.setSunDirection(this.dir.set(0.3, 1, 0.2));
    for (const m of [...this.lamps, ...this.windows]) m.emissiveIntensity = 0;
    for (const r of this.roads) {
      r.mat.color.copy(r.color);
      r.mat.roughness = r.roughness;
    }
    this.headlight.intensity = 0;
    this.rain.mesh.visible = false;
  }

  dispose(): void {
    this.rain.dispose();
    this.rainSound?.stop();
    this.headlight.removeFromParent();
    this.headlight.target.removeFromParent();
  }

  private sample(el: number, out: Lighting): void {
    let i = 0;
    while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = Math.min(1, Math.max(0, (el - a.el) / (b.el - a.el)));
    const mix = (x: number, y: number, c: THREE.Color) => c.setHex(x).lerp(this.tmpA.setHex(y), t);
    mix(a.top, b.top, out.skyTop);
    mix(a.bottom, b.bottom, out.skyBottom);
    mix(a.sun, b.sun, out.sunColor);
    mix(a.hemiSky, b.hemiSky, out.hemiSky);
    mix(a.hemiGround, b.hemiGround, out.hemiGround);
    out.sunIntensity = a.sunI + (b.sunI - a.sunI) * t;
    out.hemiIntensity = a.hemiI + (b.hemiI - a.hemiI) * t;
  }
}
