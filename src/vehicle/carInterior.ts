// Interior do sedã oficial (procedural), no espaço do modelo: chão em y = 0, frente = +Z, motorista à
// esquerda (+X). Medidas tiradas da cabine do modelo: paredes em x = ±0,99 até a linha de cintura
// (y ≈ 1,1); acima, os vidros afunilam até x = ±0,77; teto interno em y ≈ 1,78 de z = −1,08 a 0,47;
// para-brisa de z ≈ 0,5 (alto) a 1,0 (baixo); vidro traseiro de z ≈ −1,1 (alto) a −1,3 (baixo).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { t } from '../core/i18n';
import type { Grips } from '../player/SeatedDriver';

export interface CarInterior {
  root: THREE.Group;
  /** Olhos do motorista (câmera de cockpit). */
  eyes: THREE.Object3D;
  /** Assento do motorista (onde o personagem é posicionado). */
  driverSeat: THREE.Object3D;
  /** Banco de trás, lado do passageiro (corridas). */
  rearSeat: THREE.Object3D;
  /** Pegadas das mãos no aro do volante (giram com ele) e referências dos cotovelos. */
  grips: Grips;
  /** @param steer ângulo das rodas dianteiras (rad); @param kmh velocidade; @param rpm 0..1 */
  update(steer: number, kmh: number, rpm: number): void;
}

const DRIVER_X = 0.42;
const FLOOR = 0.42;

export function createCarInterior(): CarInterior {
  const root = new THREE.Group();
  root.name = 'interior';

  const leather = new THREE.MeshStandardMaterial({ name: 'leather', color: 0x8a7458, roughness: 0.55 });
  const leatherDark = new THREE.MeshStandardMaterial({ name: 'leather-dark', color: 0x5e4e3b, roughness: 0.6 });
  const plastic = new THREE.MeshStandardMaterial({ name: 'plastic', color: 0x202124, roughness: 0.75 });
  const carpet = new THREE.MeshStandardMaterial({ name: 'carpet', color: 0x2c2a27, roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ name: 'wood', color: 0x5a3a22, roughness: 0.35, metalness: 0.1 });
  const chrome = new THREE.MeshStandardMaterial({ name: 'chrome', color: 0xc9ccd2, roughness: 0.2, metalness: 0.9 });

  // Peças estáticas agrupadas por material (poucas draw calls).
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (mat: THREE.Material, geo: THREE.BufferGeometry) => {
    let list = parts.get(mat);
    if (!list) parts.set(mat, (list = []));
    list.push(geo.index ? geo.toNonIndexed() : geo);
  };
  const box = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0) =>
    add(mat, new THREE.BoxGeometry(w, h, d).rotateX(rx).rotateY(ry).translate(x, y, z));

  // Sem forro do teto: os modelos reais já têm o teto, e um forro procedural atravessava os mais baixos.
  // Assoalho, forros das portas (com apoio de braço e maçaneta), painel corta-fogo.
  box(carpet, 1.96, 0.05, 2.25, 0, FLOOR, -0.15);
  for (const s of [-1, 1]) {
    box(leatherDark, 0.04, 0.62, 1.85, s * 0.96, 0.76, -0.3);
    box(plastic, 0.1, 0.05, 1.5, s * 0.91, 0.82, -0.3); // apoio de braço
    box(chrome, 0.03, 0.03, 0.14, s * 0.93, 0.95, 0.35); // maçaneta interna
  }

  // Painel: corpo principal, faixa de madeira, cobertura do quadro de instrumentos, console central.
  box(plastic, 1.9, 0.32, 0.36, 0, 0.98, 0.82);
  box(plastic, 1.9, 0.06, 0.3, 0, 1.13, 0.86, -0.25); // tampo inclinado
  box(wood, 1.4, 0.05, 0.02, 0, 1.03, 0.635);
  box(plastic, 0.42, 0.09, 0.2, DRIVER_X, 1.16, 0.7); // capô dos instrumentos
  box(plastic, 0.36, 0.42, 0.25, 0, 0.72, 0.72); // console central (frente)
  box(plastic, 0.24, 0.24, 0.95, 0, 0.56, 0.12); // console entre os bancos
  box(wood, 0.22, 0.02, 0.5, 0, 0.69, 0.25);
  box(leatherDark, 0.24, 0.08, 0.32, 0, 0.72, -0.15); // apoio de braço central
  // Alavanca do câmbio + manopla.
  add(chrome, new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6).translate(0, 0.77, 0.38));
  add(plastic, new THREE.SphereGeometry(0.035, 8, 6).translate(0, 0.85, 0.38));
  // Pedais.
  for (const px of [DRIVER_X + 0.12, DRIVER_X - 0.06]) box(plastic, 0.08, 0.12, 0.02, px, 0.55, 0.78, -0.4);
  // Saídas de ar.
  for (const vx of [-0.62, -0.12, 0.12, 0.72]) box(chrome, 0.12, 0.05, 0.02, vx, 1.07, 0.635);

  // Bancos: dianteiros individuais, traseiro inteiriço com três encostos de cabeça.
  const seat = (x: number, z: number, w: number) => {
    box(leather, w, 0.13, 0.5, x, FLOOR + 0.2, z);
    box(leather, w, 0.62, 0.13, x, FLOOR + 0.56, z - 0.27, -0.18);
    box(leatherDark, w * 0.9, 0.06, 0.48, x, FLOOR + 0.28, z + 0.01); // costura/almofada
  };
  for (const s of [-1, 1]) {
    seat(s * DRIVER_X, 0.05, 0.5);
    box(leather, 0.26, 0.18, 0.1, s * DRIVER_X, FLOOR + 0.98, -0.34, -0.15); // encosto de cabeça
    add(chrome, new THREE.CylinderGeometry(0.008, 0.008, 0.1, 5).translate(s * DRIVER_X - 0.07, FLOOR + 0.87, -0.32));
    add(chrome, new THREE.CylinderGeometry(0.008, 0.008, 0.1, 5).translate(s * DRIVER_X + 0.07, FLOOR + 0.87, -0.32));
  }
  seat(0, -0.82, 1.72);
  for (const hx of [-0.55, 0, 0.55]) box(leather, 0.24, 0.16, 0.09, hx, FLOOR + 0.92, -1.04, -0.15);
  box(carpet, 1.9, 0.03, 0.3, 0, 1.05, -1.33); // tampa do porta-malas (bagagito)

  // Retrovisor interno.
  box(plastic, 0.03, 0.06, 0.04, 0, 1.73, 0.44);
  box(plastic, 0.19, 0.05, 0.02, 0, 1.67, 0.42);

  for (const [mat, geos] of parts) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    // Sem sombras: dentro da lataria tudo ficaria na sombra do teto (escuro demais) e só custaria.
    m.receiveShadow = false;
    m.castShadow = false;
    root.add(m);
  }

  // Volante (gira com o esterço): aro, cubo e raios; coluna até o painel.
  const steering = new THREE.Group();
  steering.position.set(DRIVER_X, 1.0, 0.4);
  steering.rotation.x = -0.35; // inclinado para o motorista
  const wheelSpin = new THREE.Group();
  wheelSpin.add(new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 8, 28), leatherDark));
  wheelSpin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 12).rotateX(Math.PI / 2), plastic));
  for (const a of [Math.PI / 2, -Math.PI / 6, (-5 * Math.PI) / 6]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.022, 0.012), plastic);
    spoke.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0);
    spoke.rotation.z = a;
    wheelSpin.add(spoke);
  }
  // Pegadas "10 e 10" (ou "9h15"): no aro, um pouco à frente dele (a mão envolve o aro).
  // Motorista olha para +Z: a esquerda dele é +X.
  const GRIP_ANGLE = 0.45; // rad acima da horizontal
  const leftGrip = new THREE.Object3D();
  leftGrip.position.set(Math.cos(GRIP_ANGLE) * 0.18, Math.sin(GRIP_ANGLE) * 0.18, -0.02);
  const rightGrip = new THREE.Object3D();
  rightGrip.position.set(-Math.cos(GRIP_ANGLE) * 0.18, Math.sin(GRIP_ANGLE) * 0.18, -0.02);
  wheelSpin.add(leftGrip, rightGrip);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.42, 8).rotateX(Math.PI / 2), plastic);
  column.position.z = 0.22;
  steering.add(wheelSpin, column);
  root.add(steering);

  // Instrumentos: velocímetro e conta-giros com ponteiros, voltados para o motorista (−Z).
  const speedo = gauge(t('car.gauge.kmh'), 0, 200, 20);
  speedo.dial.position.set(DRIVER_X - 0.08, 1.11, 0.605);
  const tacho = gauge(t('car.gauge.rpm'), 0, 8, 1);
  tacho.dial.position.set(DRIVER_X + 0.09, 1.11, 0.605);
  root.add(speedo.dial, tacho.dial);

  // Rádio do Tribunal (tela no console central).
  const radio = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.09), new THREE.MeshStandardMaterial({ map: radioScreen(), emissive: 0xffffff, emissiveMap: radioScreen(), emissiveIntensity: 0.8 }));
  radio.position.set(0, 0.93, 0.596);
  radio.rotation.y = Math.PI;
  root.add(radio);

  const eyes = new THREE.Object3D();
  eyes.position.set(DRIVER_X, 1.4, -0.06);
  const driverSeat = new THREE.Object3D();
  // Um pouco à frente do centro do banco: os braços do personagem alcançam o volante.
  driverSeat.position.set(DRIVER_X, FLOOR + 0.18, 0.15);
  const rearSeat = new THREE.Object3D();
  rearSeat.position.set(-0.45, FLOOR + 0.18, -0.8);
  // Cotovelos para fora e para baixo.
  const poleLeft = new THREE.Object3D();
  poleLeft.position.set(DRIVER_X + 0.5, 0.75, 0.05);
  const poleRight = new THREE.Object3D();
  poleRight.position.set(DRIVER_X - 0.5, 0.75, 0.05);
  root.add(eyes, driverSeat, rearSeat, poleLeft, poleRight);

  return {
    root,
    eyes,
    driverSeat,
    rearSeat,
    grips: { left: leftGrip, right: rightGrip, poleLeft, poleRight },
    update(steer, kmh, rpm) {
      // Relação de direção estilizada (até ~90° de volante: as mãos não cruzam).
      wheelSpin.rotation.z = -steer * 2.2;
      speedo.set(kmh / 200);
      tacho.set(rpm);
    },
  };
}

/** Mostrador redondo (canvas) com ponteiro; set(0..1) varre 240°. */
function gauge(label: string, min: number, max: number, step: number): { dial: THREE.Group; set(v: number): void } {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2;
  ctx.fillStyle = '#0b0c0e';
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c9ccd2';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = '#e8e6df';
  ctx.strokeStyle = '#e8e6df';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const start = (Math.PI * 5) / 6; // 150° (canto inferior esquerdo), sentido horário até 30°
  const sweep = (Math.PI * 4) / 3;
  for (let v = min; v <= max + 1e-6; v += step) {
    const a = start + ((v - min) / (max - min)) * sweep;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (cx - 14), cx + Math.sin(a) * (cx - 14));
    ctx.lineTo(cx + Math.cos(a) * (cx - 30), cx + Math.sin(a) * (cx - 30));
    ctx.stroke();
    ctx.fillText(String(v), cx + Math.cos(a) * (cx - 52), cx + Math.sin(a) * (cx - 52));
  }
  ctx.font = '18px system-ui, sans-serif';
  ctx.fillText(label, cx, cx + 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const dial = new THREE.Group();
  dial.rotation.y = Math.PI; // face para o motorista (−Z)
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.075, 32), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.4 }));
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.008, 0.002).translate(0.028, 0, 0), new THREE.MeshBasicMaterial({ color: 0xff5a2a }));
  needle.position.z = 0.002;
  dial.add(face, needle);
  return {
    dial,
    set(v: number) {
      // Canvas: ângulo cresce no sentido horário (y para baixo); no plano 3D, invertido.
      needle.rotation.z = -(start + Math.min(1, Math.max(0, v)) * sweep);
    },
  };
}

function radioScreen(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 104;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#06210f';
  ctx.fillRect(0, 0, 256, 104);
  ctx.fillStyle = '#6dff9a';
  ctx.font = 'bold 30px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('87,7 FM', 128, 44);
  ctx.font = '18px ui-monospace, monospace';
  ctx.fillText(t('car.radio'), 128, 80, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
