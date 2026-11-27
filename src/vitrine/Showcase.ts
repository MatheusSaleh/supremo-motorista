// Vitrine do portfólio: Josué num escritório no alto, digitando, com a Esplanada dos Ministérios "ao vivo"
// pela janela (hora, sol e clima reais de Brasília). Sem física, áudio, HUD nem tráfego: só a cidade
// gerada pelo mesmo código do jogo, a sala e o personagem. Câmera fixa com um balanço leve.
//
// Embutida num iframe (pointer-events: none) no topo de matheussaleh.com.br. Conversa com a página por
// postMessage: informa o progresso da montagem ({ type: 'supremo-vitrine:progress', stage, progress }, para a tela de
// carregamento do portfólio), avisa 'supremo-vitrine:ready' quando o primeiro quadro sai e aceita
// 'supremo-vitrine:pause' / 'supremo-vitrine:resume' (o portfólio pausa quando o topo sai da tela).
//
// Parâmetros de teste: ?hora=0..24 força a hora; ?clima=rain|storm|fog|cloudy|clear força o tempo.
import * as THREE from 'three';
import { config } from '../config';
import { Assets } from '../core/Assets';
import { Environment, type WeatherOverride } from '../env/Environment';
import { Rain } from '../env/Rain';
import { loadCharacterAsset } from '../player/CharacterAsset';
import { SeatedDriver } from '../player/SeatedDriver';
import { createShowcaseCity } from './city';
import type { Rect } from '../world/city/builder';
import { buildOffice, CHAIR, DESK, KEYBOARD, ROOM, type Office } from './office';
import { CodeScreen, DeskClock } from './screens';
import { ShowcaseSky } from './sky';

/**
 * Onde fica a sala: sobre o gramado do Eixo, a oeste dos ministérios, com a janela para o leste (−Z). O giro (yaw)
 * compensa a câmera de lado: assim o Congresso cai perto do meio do quadro, entre o texto do portfólio e a mesa.
 */
const SITE = { x: 0, z: 260, height: 34, yaw: 0.55 };
/**
 * Enquadramentos da câmera (locais à sala), escolhidos pela proporção da tela. O campo de visão horizontal (hfov,
 * graus) é fixo em cada um e o vertical se ajusta, para a composição ficar igual em qualquer tamanho.
 *  - paisagem (desktop, fundo do topo): atrás e à esquerda do personagem; texto do portfólio à esquerda,
 *    Congresso a ~60% da largura, mesa e personagem a ~80%;
 *  - retrato (celular, quadro no topo): mais perto, por cima do ombro, com o Congresso no alto da janela.
 */
interface CameraPreset {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  hfov: number;
  /** Proporção (largura/altura) usada para descartar a cidade fora do quadro, com folga. */
  probeAspect: number;
}
const LANDSCAPE: CameraPreset = { pos: new THREE.Vector3(-2.2, 1.66, 2.2), look: new THREE.Vector3(0.18, 1.3, -3.2), hfov: 80, probeAspect: 2.8 };
const PORTRAIT: CameraPreset = { pos: new THREE.Vector3(0.2, 1.72, 0.4), look: new THREE.Vector3(2.15, 1.42, -3.2), hfov: 56, probeAspect: 0.9 };
/** Abaixo desta proporção, o enquadramento retrato. */
const PORTRAIT_BELOW = 1.25;
const FPS = 30;

export class Showcase {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 3200);
  private readonly env = new Environment(true);
  private readonly rain = new Rain();
  private readonly code = new CodeScreen();
  private readonly clock = new DeskClock();
  private sky!: ShowcaseSky;
  private office!: Office;
  private driver: SeatedDriver | null = null;
  private readonly room = new THREE.Group();
  private readonly grips = { left: new THREE.Object3D(), right: new THREE.Object3D(), poleLeft: new THREE.Object3D(), poleRight: new THREE.Object3D() };
  private neck: { bone: THREE.Object3D; base: THREE.Quaternion } | null = null;
  private readonly rainCenter = new THREE.Vector3();
  private readonly camBase = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private paused = false;
  private running = false;
  private last = 0;
  private acc = 0;
  private time = 0;
  private envTimer = 0;
  private readyPosted = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    const q = new URLSearchParams(location.search);
    const hour = Number(q.get('hora'));
    if (q.has('hora') && hour >= 0 && hour <= 24) this.env.override.hour = hour;
    const weather = q.get('clima');
    if (weather && ['rain', 'storm', 'fog', 'cloudy', 'partly', 'clear', 'dry'].includes(weather)) this.env.override.weather = weather as WeatherOverride;

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.data === 'supremo-vitrine:pause') this.paused = true;
      if (e.data === 'supremo-vitrine:resume') this.paused = false;
    });
  }

  async init(): Promise<void> {
    const assets = new Assets();
    progress('character', 0);
    const characterPromise = loadCharacterAsset(assets, config, (f) => progress('character', f)).finally(() => progress('character', 1)).catch((err: unknown) => {
      console.warn('[vitrine] personagem não carregou; a sala fica vazia.', err);
      return null;
    });

    // A cidade é gerada em código, em etapas (ver city.ts): dá um quadro para a página respirar antes.
    await new Promise((r) => requestAnimationFrame(r));
    const t0 = performance.now();
    progress('city', 0);
    const city = await createShowcaseCity(...viewProbe());
    progress('city', 1);
    if (new URLSearchParams(location.search).has('debug')) console.info(`[vitrine] cidade em ${Math.round(performance.now() - t0)} ms`);
    this.scene.add(city.root);
    city.root.traverse((o) => {
      o.matrixAutoUpdate = false;
    });

    const floorY = SITE.height; // cidade plana (city.ts)
    this.room.position.set(SITE.x, floorY, SITE.z);
    this.room.rotation.y = SITE.yaw;
    this.room.updateMatrixWorld(true);
    this.scene.add(this.room);
    this.office = buildOffice(this.code, this.clock);
    this.room.add(this.office.root);

    const focus = new THREE.Vector3(SITE.x, floorY + ROOM.h / 2, SITE.z);
    this.sky = new ShowcaseSky(this.scene, focus, this.camera.far * 0.9);
    this.sky.collect(city.root);
    this.scene.add(this.rain.mesh);
    // A chuva cai lá fora: a caixa dela (70 m, alinhada aos eixos do mundo, não gira com a sala) fica além do vidro.
    this.room.localToWorld(this.rainCenter.set(0, 0, -ROOM.d / 2 - 60));

    hideFarDetail(city.root, this.room.position);

    const character = await characterPromise;
    if (character) this.seat(new SeatedDriver(character, config));

    this.resize();
    this.applyEnvironment(1);
    progress('shaders', 0);
    await new Promise((r) => setTimeout(r, 0));
    this.renderer.compile(this.scene, this.camera);
    progress('shaders', 1);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      if (this.paused) return;
      this.acc += dt;
      if (this.acc < 1 / FPS) return;
      this.frame(this.acc);
      this.acc = 0;
    };
    requestAnimationFrame(loop);
  }

  private seat(driver: SeatedDriver): void {
    this.driver = driver;
    const r = driver.root;
    r.rotation.y = Math.PI; // de frente para a janela (−Z)
    r.position.set(CHAIR.x, 0, CHAIR.z);
    this.room.add(r);
    driver.visible = true;
    r.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });

    // Senta o quadril no assento, seja qual for a altura da pose "sentado" do clip.
    const hips = r.getObjectByName('mixamorigHips');
    if (hips) {
      this.room.updateMatrixWorld(true);
      const p = hips.getWorldPosition(new THREE.Vector3());
      this.room.worldToLocal(p);
      r.position.y += CHAIR.seat + 0.1 - p.y;
      r.position.z += CHAIR.z + 0.05 - p.z;
    }
    const neck = r.getObjectByName('mixamorigNeck');
    if (neck) this.neck = { bone: neck, base: neck.quaternion.clone() };

    // Cotovelos para fora e para baixo, atrás das mãos.
    this.grips.poleLeft.position.set(KEYBOARD.x - 0.55, DESK.top - 0.2, CHAIR.z + 0.15);
    this.grips.poleRight.position.set(KEYBOARD.x + 0.55, DESK.top - 0.2, CHAIR.z + 0.15);
    this.room.add(this.grips.left, this.grips.right, this.grips.poleLeft, this.grips.poleRight);
  }

  private frame(dt: number): void {
    this.time += dt;
    this.env.update(dt);
    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 1;
      this.applyEnvironment(1);
    }
    this.code.update(dt);
    this.animateTyping();

    // Balanço leve da câmera (respiração), para a cena parecer viva.
    const t = this.time;
    this.camera.position.copy(this.camBase).add(new THREE.Vector3(Math.sin(t * 0.21) * 0.06, Math.sin(t * 0.33) * 0.025, Math.cos(t * 0.17) * 0.04));
    this.camera.lookAt(this.lookAt);
    this.rain.update(dt, this.rainCenter, this.sky.rain, this.sky.night);

    this.renderer.render(this.scene, this.camera);
    if (!this.readyPosted) {
      this.readyPosted = true;
      if (new URLSearchParams(location.search).has('debug')) {
        const r = this.renderer.info.render;
        console.info(`[vitrine] pronta em ${Math.round(performance.now())} ms; ${r.calls} draw calls, ${(r.triangles / 1e6).toFixed(2)} M triângulos`);
      }
      window.parent?.postMessage('supremo-vitrine:ready', '*');
    }
  }

  /** Hora/clima reais → céu, luzes internas, telas. */
  private applyEnvironment(dt: number): void {
    const s = this.env.snapshot();
    this.sky.update(dt, s);
    const n = this.sky.night;
    const dim = Math.max(n, 0.6 * this.sky.rain);
    // Escritório com as luzes acesas também de dia (mais fracas); à noite a luminária e as telas mandam.
    this.office.lamp.intensity = 1.5 + 3 * dim;
    this.office.screenGlow.intensity = 0.4 + 1.6 * dim;
    this.office.ceiling.intensity = 9 - 4 * dim;
    this.office.ceilingPanels.emissiveIntensity = 1.4 - 0.6 * dim;
    this.clock.set(s.clock, s.live ? s.weather.temperature : null, s.weather.rain > 0);
  }

  /** Mãos "digitando" (alvos da IK pulando sobre o teclado) e a cabeça olhando de vez em quando o 2º monitor. */
  private animateTyping(): void {
    if (!this.driver) return;
    const t = this.time;
    const typing = this.code.typing ? 1 : 0;
    const hop = (phase: number) => typing * Math.max(0, Math.sin(t * 17 + phase)) * 0.018;
    this.grips.left.position.set(KEYBOARD.x - 0.15 + Math.sin(t * 2.3) * 0.02 * typing, KEYBOARD.y + 0.03 + hop(0), KEYBOARD.z + 0.01);
    this.grips.right.position.set(KEYBOARD.x + 0.15 + Math.sin(t * 1.9 + 1) * 0.02 * typing, KEYBOARD.y + 0.03 + hop(Math.PI * 0.7), KEYBOARD.z + 0.01);
    this.room.updateMatrixWorld(true);
    this.driver.update(this.grips);

    if (this.neck) {
      // A cada ~9 s olha um pouco para o monitor da direita, e volta.
      const glance = Math.max(0, Math.sin(t * 0.7)) ** 8;
      const yaw = -0.45 * glance + Math.sin(t * 0.5) * 0.04;
      const pitch = 0.12 + Math.sin(t * 0.9) * 0.02;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
      this.neck.bone.quaternion.copy(this.neck.base).multiply(q);
    }
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const preset = aspect < PORTRAIT_BELOW ? PORTRAIT : LANDSCAPE;
    this.room.localToWorld(this.camBase.copy(preset.pos));
    this.room.localToWorld(this.lookAt.copy(preset.look));
    const vfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(preset.hfov / 2)) / aspect);
    this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(vfov), 34, 80);
    this.camera.updateProjectionMatrix();
  }
}

/** Etapas da montagem, na ordem: personagem (download, 0..1), cidade e shaders (0 no início, 1 no fim). */
export type ShowcaseStage = 'character' | 'city' | 'shaders';

function progress(stage: ShowcaseStage, value: number): void {
  window.parent?.postMessage({ type: 'supremo-vitrine:progress', stage, progress: value }, '*');
}

/**
 * O que os enquadramentos podem ver, com folga: um frustum por enquadramento (para descartar o resto da cidade;
 * girar o celular troca de um para o outro) e o retângulo em planta que eles cobrem.
 */
function viewProbe(): [THREE.Frustum[], Rect] {
  const site = new THREE.Object3D();
  site.position.set(SITE.x, SITE.height, SITE.z);
  site.rotation.y = SITE.yaw;
  site.updateMatrixWorld(true);
  const frustums: THREE.Frustum[] = [];
  const area: Rect = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const grow = (p: THREE.Vector3) => {
    area.minX = Math.min(area.minX, p.x);
    area.maxX = Math.max(area.maxX, p.x);
    area.minZ = Math.min(area.minZ, p.z);
    area.maxZ = Math.max(area.maxZ, p.z);
  };
  for (const preset of [LANDSCAPE, PORTRAIT]) {
    const hfov = THREE.MathUtils.degToRad(preset.hfov + 14);
    const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / preset.probeAspect));
    const probe = new THREE.PerspectiveCamera(Math.min(vfov, 100), preset.probeAspect, 0.5, 3000);
    probe.position.copy(site.localToWorld(preset.pos.clone()));
    probe.lookAt(site.localToWorld(preset.look.clone()));
    probe.updateMatrixWorld(true);
    frustums.push(new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(probe.projectionMatrix, probe.matrixWorldInverse)));
    grow(probe.position);
    const p = new THREE.Vector3();
    for (const x of [-1, 1]) for (const y of [-1, 1]) grow(p.set(x, y, 1).unproject(probe));
  }
  return [frustums, area];
}

/** Câmera fixa: some de vez com os detalhes (árvores, postes, placas) além da distância de desenho. */
function hideFarDetail(root: THREE.Object3D, cam: THREE.Vector3): void {
  const sphere = new THREE.Sphere();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || typeof o.userData.cullDistance !== 'number') return;
    if (o instanceof THREE.InstancedMesh) {
      o.computeBoundingSphere();
      sphere.copy(o.boundingSphere!);
    } else {
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      sphere.copy(o.geometry.boundingSphere!);
    }
    sphere.applyMatrix4(o.matrixWorld);
    const max = (o.userData.cullDistance as number) * 1.5 + sphere.radius;
    o.visible = sphere.center.distanceToSquared(cam) < max * max;
  });
}
