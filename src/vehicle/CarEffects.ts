// Efeitos visuais do carro: fumaça de pneu (drift no asfalto), poeira (grama), sujeira acumulada e
// amassados nas batidas. Partículas num único THREE.Points (1 draw call), com alfa por partícula.
import * as THREE from 'three';
import type { Car, CarEvent } from './Car';
import type { CarModel } from './CarVisual';

const MAX = 220;
const SMOKE = new THREE.Color(0xd9d9d6);
const DUST = new THREE.Color(0xa08a63);
const SPRAY = new THREE.Color(0xc9d1d8);

export class CarEffects {
  private readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly col = new Float32Array(MAX * 4);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(Infinity);
  private readonly life = new Float32Array(MAX);
  private readonly alpha0 = new Float32Array(MAX);
  private next = 0;
  private smokeAcc = 0;
  private dustAcc = 0;
  private sprayAcc = 0;
  /** Pista molhada (0..1): rodas levantam spray no asfalto. Ajustado pelo env/Atmosphere. */
  wet = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const sprite = softCircle();
    this.points = new THREE.Points(
      geo,
      // alphaMap arredonda o sprite (sem ele cada partícula vira um quadrado).
      new THREE.PointsMaterial({ size: 1.5, alphaMap: sprite, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
    this.points.name = 'fumaca-poeira';
    scene.add(this.points);
  }

  update(dt: number, car: Car, model: CarModel): void {
    const grounded = car.wheelsOnGround >= 2;
    const speed = Math.abs(car.forwardSpeed);
    // Fumaça: derrapando no asfalto. Poeira: andando na grama (mais ainda derrapando).
    if (grounded) {
      this.smokeAcc += (!car.offroad && car.slip > 0.3 ? car.slip * 70 : 0) * dt;
      this.dustAcc += (car.offroad && speed > 5 ? Math.min(speed / 18, 1.6) * 28 + car.slip * 40 : 0) * dt;
      this.sprayAcc += (!car.offroad && speed > 8 ? Math.min(speed / 20, 2) * 30 * this.wet : 0) * dt;
    }
    for (; this.sprayAcc >= 1; this.sprayAcc--) this.emit(model, SPRAY, 0.22, 0.7);
    for (; this.smokeAcc >= 1; this.smokeAcc--) this.emit(model, SMOKE, 0.32, 1.5);
    for (; this.dustAcc >= 1; this.dustAcc--) this.emit(model, DUST, 0.3, 1.1);

    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= this.life[i]) {
        this.col[i * 4 + 3] = 0;
        continue;
      }
      this.age[i] += dt;
      const k = i * 3;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.vel[k] *= 0.94;
      this.vel[k + 2] *= 0.94;
      const t = this.age[i] / this.life[i];
      this.col[i * 4 + 3] = this.alpha0[i] * (1 - t) * Math.min(1, t * 6);
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;

    // Sujeira: acumula na grama, sai devagar no vento do asfalto em alta.
    if (grounded && car.offroad && speed > 5) car.dirt += dt * 0.012 * Math.min(speed / 15, 2);
    else if (!car.offroad && speed > 18) car.dirt -= dt * 0.0015;
    car.dirt = Math.min(1, Math.max(0, car.dirt));
    model.setDirt(car.dirt);
  }

  /** Batidas viram amassados (só as fortes o bastante). */
  handleEvents(events: readonly CarEvent[], model: CarModel): void {
    for (const e of events) if (e.type === 'impact' && e.strength > 3) model.dent(e.localDir, e.strength);
  }

  /** Caiu no lago: volta enlameado. */
  splash(car: Car): void {
    car.dirt = Math.min(1, car.dirt + 0.45);
  }

  repair(car: Car): void {
    const model = car.model;
    car.dirt = 0;
    car.damaged = false;
    model.repair();
    model.setDirt(0);
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }

  /** Respingo no ponto dado (ex.: tomate acertando): partículas que se espalham e caem. */
  burst(at: THREE.Vector3Like, color: number, count = 14): void {
    const c = this.tmpColor.setHex(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const k = i * 3;
      this.pos[k] = at.x;
      this.pos[k + 1] = at.y;
      this.pos[k + 2] = at.z;
      this.vel[k] = (Math.random() - 0.5) * 6;
      this.vel[k + 1] = 1 + Math.random() * 3;
      this.vel[k + 2] = (Math.random() - 0.5) * 6;
      this.col[i * 4] = c.r;
      this.col[i * 4 + 1] = c.g;
      this.col[i * 4 + 2] = c.b;
      this.age[i] = 0;
      this.life[i] = 0.5 + Math.random() * 0.4;
      this.alpha0[i] = 0.9;
    }
  }

  private emit(model: CarModel, color: THREE.Color, alpha: number, life: number): void {
    // Sai de uma das rodas traseiras, no chão.
    const wheel = model.wheels[2 + (this.next % 2)];
    wheel.getWorldPosition(this.tmp);
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const k = i * 3;
    this.pos[k] = this.tmp.x + (Math.random() - 0.5) * 0.4;
    this.pos[k + 1] = this.tmp.y + 0.45; // acima do chão: o sprite não é cortado pelo asfalto
    this.pos[k + 2] = this.tmp.z + (Math.random() - 0.5) * 0.4;
    this.vel[k] = (Math.random() - 0.5) * 1.6;
    this.vel[k + 1] = 0.3 + Math.random() * 0.6;
    this.vel[k + 2] = (Math.random() - 0.5) * 1.6;
    this.col[i * 4] = color.r;
    this.col[i * 4 + 1] = color.g;
    this.col[i * 4 + 2] = color.b;
    this.age[i] = 0;
    this.life[i] = life * (0.8 + Math.random() * 0.4);
    this.alpha0[i] = alpha;
  }
}

function softCircle(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
