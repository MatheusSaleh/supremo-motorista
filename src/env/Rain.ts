// Chuva: milhares de riscos numa só LineSegments, animados no vertex shader. As gotas ficam presas a
// uma grade do mundo que "dá a volta" em torno da câmera (não andam junto com ela).
import * as THREE from 'three';

const COUNT = 9000;
const BOX = new THREE.Vector3(70, 36, 70);

export class Rain {
  readonly mesh: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private time = 0;

  constructor() {
    const pos = new Float32Array(COUNT * 2 * 3);
    const end = new Float32Array(COUNT * 2);
    const rand = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      const x = Math.random() * BOX.x;
      const y = Math.random() * BOX.y;
      const z = Math.random() * BOX.z;
      const r = Math.random();
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
        rand[i * 2 + k] = r;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uBox: { value: BOX },
        uIntensity: { value: 0 },
        uColor: { value: new THREE.Color(0xb9c4cf) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uOrigin;
        uniform vec3 uBox;
        uniform float uIntensity;
        attribute float aEnd;
        attribute float aRand;
        varying float vAlpha;
        void main() {
          vec3 base = uOrigin - uBox * 0.5;
          float speed = 22.0 + aRand * 8.0;
          vec3 p = position;
          p.y -= uTime * speed;
          vec3 w = base + mod(p - base, uBox);
          // Risco de ~0,9 m, levemente inclinado pelo vento.
          w += aEnd * vec3(0.12, 0.9, 0.05);
          vAlpha = (aRand < uIntensity ? 1.0 : 0.0) * mix(0.8, 0.1, aEnd);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.0) discard;
          gl_FragColor = vec4(uColor, vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'chuva';
    this.mesh.renderOrder = 2;
  }

  /** intensity 0..1 (fração das gotas visíveis). */
  update(dt: number, cameraPos: THREE.Vector3, intensity: number, darkness: number): void {
    this.mesh.visible = intensity > 0.01;
    if (!this.mesh.visible) return;
    this.time = (this.time + dt) % 600; // evita perda de precisão no shader em sessões longas
    const u = this.mesh.material.uniforms;
    u.uTime.value = this.time;
    (u.uOrigin.value as THREE.Vector3).copy(cameraPos);
    u.uIntensity.value = intensity;
    // À noite os riscos ficam escuros (só aparecem perto dos faróis/postes, na prática).
    (u.uColor.value as THREE.Color).setRGB(0.73, 0.77, 0.81).multiplyScalar(1 - 0.75 * darkness);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
