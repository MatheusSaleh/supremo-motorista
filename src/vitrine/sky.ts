// Céu e luz da vitrine: a mesma tabela de cores por elevação do sol do jogo (env/Atmosphere), aplicada a
// uma cena sem física. Recebe o EnvSnapshot real (hora de Brasília + clima da Open-Meteo).
import * as THREE from 'three';
import type { EnvSnapshot } from '../env/Environment';

const KEYS = [
  { el: -18, top: 0x050a18, bottom: 0x141b30, sun: 0x9db2ff, sunI: 0.4, hemiSky: 0x44557c, hemiGround: 0x181a20, hemiI: 0.62 },
  { el: -6, top: 0x0e1a3a, bottom: 0x353c5c, sun: 0x9db2ff, sunI: 0.4, hemiSky: 0x4d5b80, hemiGround: 0x1c1d24, hemiI: 0.66 },
  { el: -1, top: 0x284780, bottom: 0xd98a62, sun: 0xff9050, sunI: 0.55, hemiSky: 0x8c8fb0, hemiGround: 0x3b3328, hemiI: 0.7 },
  { el: 6, top: 0x3d6fc0, bottom: 0xf0c59c, sun: 0xffc387, sunI: 1.7, hemiSky: 0xc9d8f0, hemiGround: 0x5d6446, hemiI: 0.9 },
  { el: 20, top: 0x3d7fd6, bottom: 0xcfe3f2, sun: 0xfff3e0, sunI: 2.6, hemiSky: 0xdcecff, hemiGround: 0x6b7a4f, hemiI: 1.1 },
];
const MOON_DIR = new THREE.Vector3(-0.35, 0.85, 0.4).normalize();
const FOG = { near: 250, far: 2600 };

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, rate * dt);

export class ShowcaseSky {
  readonly sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  readonly hemi = new THREE.HemisphereLight(0xdcecff, 0x6b7a4f, 1.1);
  /** Escuridão (0 dia → 1 noite). */
  night = 0;
  /** Chuva suavizada (0..1). */
  rain = 0;
  /** Luzes da cidade acesas (noite ou temporal). */
  lightsOn = 0;
  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly fog: THREE.Fog;
  private readonly lamps: THREE.MeshStandardMaterial[] = [];
  private readonly windows: THREE.MeshStandardMaterial[] = [];
  private readonly roads: { mat: THREE.MeshStandardMaterial; color: THREE.Color; roughness: number }[] = [];
  private cloud = 0;
  private fogAmt = 0;
  private dry = 0;
  private wet = 0;
  private first = true;
  private readonly dir = new THREE.Vector3();
  private readonly c = { top: new THREE.Color(), bottom: new THREE.Color(), sun: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color() };
  private readonly tmp = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    /** Centro da área de sombra (a sala). */
    private readonly focus: THREE.Vector3,
    radius: number,
  ) {
    scene.background = new THREE.Color(0xcfe3f2);
    this.fog = new THREE.Fog(0xcfe3f2, FOG.near, FOG.far);
    scene.fog = this.fog;
    this.dome = createDome(radius);
    this.dome.position.copy(focus);
    scene.add(this.dome, this.hemi, this.sun, this.sun.target);

    // Sombra só em volta da sala: o sol que entra pela janela desenha os caixilhos no chão.
    const s = this.sun.shadow;
    s.mapSize.setScalar(1024);
    s.camera.near = 1;
    s.camera.far = 160;
    s.camera.left = s.camera.bottom = -9;
    s.camera.right = s.camera.top = 9;
    s.bias = 0.0002;
    s.normalBias = 0.04;
    this.sun.castShadow = true;
  }

  /** Materiais da cidade que reagem à noite e à chuva (mesma convenção de userData do jogo). */
  collect(root: THREE.Object3D): void {
    const seen = new Set<THREE.Material>();
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of [o.material].flat()) {
        if (seen.has(m) || !(m instanceof THREE.MeshStandardMaterial)) continue;
        seen.add(m);
        if (m.userData.lampGlow) this.lamps.push(m);
        if (m.userData.nightGlow) this.windows.push(m);
        if (m.userData.wetRoad) this.roads.push({ mat: m, color: m.color.clone(), roughness: m.roughness });
      }
    });
  }

  update(dt: number, s: EnvSnapshot): void {
    const w = s.weather;
    const rate = this.first ? 1e3 : 0.25;
    this.first = false;
    this.cloud = approach(this.cloud, w.cloud, rate, dt);
    this.rain = approach(this.rain, w.rain, rate, dt);
    this.fogAmt = approach(this.fogAmt, w.kind === 'fog' ? 1 : 0, rate, dt);
    this.dry = approach(this.dry, s.dry ? 1 : 0, rate, dt);
    this.wet = approach(this.wet, w.rain > 0 ? 1 : 0, w.rain > 0 ? Math.max(rate, 0.3) : Math.min(rate, 0.02), dt);

    const el = s.sunElevation;
    const n = smoothstep(2, -6, el);
    this.night = n;
    let sunI: number;
    let hemiI: number;
    {
      let i = 0;
      while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
      const a = KEYS[i];
      const b = KEYS[i + 1];
      const t = Math.min(1, Math.max(0, (el - a.el) / (b.el - a.el)));
      const mix = (x: number, y: number, out: THREE.Color) => out.setHex(x).lerp(this.tmp.setHex(y), t);
      mix(a.top, b.top, this.c.top);
      mix(a.bottom, b.bottom, this.c.bottom);
      mix(a.sun, b.sun, this.c.sun);
      mix(a.hemiSky, b.hemiSky, this.c.hs);
      mix(a.hemiGround, b.hemiGround, this.c.hg);
      sunI = a.sunI + (b.sunI - a.sunI) * t;
      hemiI = a.hemiI + (b.hemiI - a.hemiI) * t;
    }

    const grey = Math.min(1, this.cloud * 0.6 + this.rain * 0.6);
    const dayLum = (1 - 0.88 * n) * (1 - 0.3 * this.rain);
    this.c.top.lerp(this.tmp.setHex(0x6f7780).multiplyScalar(dayLum), grey);
    this.c.bottom.lerp(this.tmp.setHex(0x9da4ab).multiplyScalar(dayLum), grey);
    sunI *= (1 - 0.7 * this.cloud) * (1 - 0.5 * this.rain) * (1 - 0.5 * this.fogAmt);
    hemiI *= 1 - 0.2 * this.rain;
    this.c.bottom.lerp(this.tmp.setHex(0xd8c19a).multiplyScalar(dayLum), 0.45 * this.dry);
    this.c.sun.lerp(this.tmp.setHex(0xffd9a8), 0.4 * this.dry);

    const u = this.dome.material.uniforms;
    (u.topColor.value as THREE.Color).copy(this.c.top);
    (u.bottomColor.value as THREE.Color).copy(this.c.bottom);
    (this.scene.background as THREE.Color).copy(this.c.bottom);
    this.fog.color.copy(this.c.bottom);
    this.fog.near = FOG.near * (1 - 0.85 * this.rain) * (1 - 0.9 * this.fogAmt);
    this.fog.far = FOG.far * (1 - 0.8 * this.rain) * (1 - 0.85 * this.fogAmt) * (1 - 0.42 * this.dry);
    this.sun.color.copy(this.c.sun);
    this.sun.intensity = sunI;
    this.hemi.color.copy(this.c.hs);
    this.hemi.groundColor.copy(this.c.hg);
    this.hemi.intensity = hemiI;

    if (el > -2) {
      this.dir.copy(s.sunDir);
      if (this.dir.y < 0.08) this.dir.setY(0.08).normalize();
    } else this.dir.copy(MOON_DIR);
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(this.dir, 80);

    this.lightsOn = Math.max(n, 0.45 * this.rain * this.cloud, 0.6 * this.fogAmt);
    for (const m of this.lamps) m.emissiveIntensity = (m.userData.lampGlow as number) * this.lightsOn;
    for (const m of this.windows) m.emissiveIntensity = (m.userData.nightGlow as number) * n;
    for (const r of this.roads) {
      r.mat.color.copy(r.color).multiplyScalar(1 - 0.45 * this.wet);
      r.mat.roughness = r.roughness + (0.32 - r.roughness) * this.wet;
    }
  }
}

function createDome(radius: number): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x3d7fd6) },
      bottomColor: { value: new THREE.Color(0xcfe3f2) },
      exponent: { value: 0.6 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float exponent;
      varying vec3 vDir;
      void main() {
        float h = max(normalize(vDir).y, 0.0);
        gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, exponent)), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}
