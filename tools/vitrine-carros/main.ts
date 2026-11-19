// Vitrine dos carros fictícios (ferramenta de desenvolvimento, fora do jogo):
//   npx vite --config tools/vitrine-carros/vite.config.mjs   → http://localhost:5191
// Parâmetros: ?car=fusao (um só), ?view=front|rear|side|top|three|rear3, ?low=1 (versão leve), ?paint=c03030.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FLEET } from '../../src/data/vehicles';
import { buildCarAsset } from '../../src/vehicle/carDesign';
import { createCarModelFromAsset } from '../../src/vehicle/CarVisual';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8c4cc);
const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x667766, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(6, 10, 8);
sun.castShadow = true;
sun.shadow.camera.left = sun.shadow.camera.bottom = -14;
sun.shadow.camera.right = sun.shadow.camera.top = 14;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const defs = q.get('car') ? FLEET.filter((d) => d.id === q.get('car')) : FLEET;
defs.forEach((def, i) => {
  const asset = buildCarAsset(def.design, q.get('low') === '1');
  const paint = q.get('paint');
  const m = createCarModelFromAsset(asset, paint ? parseInt(paint, 16) : def.paint);
  m.setEnvironment(env);
  // Rodas: posição de repouso (no jogo quem faz isso é o Car, pela suspensão).
  asset.geometry.wheels.forEach(([x, z], k) => m.wheels[k].position.set(x, asset.geometry.groundOffset + asset.geometry.wheelRadius, z));
  m.root.position.set((i - (defs.length - 1) / 2) * 2.6, -asset.geometry.groundOffset, 0);
  scene.add(m.root);
});

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 200);
const span = defs.length === 1 ? 0 : defs.length * 2.6;
const views: Record<string, [number, number, number]> = {
  three: span ? [span * 0.55, span * 0.3 + 1.5, span * 0.75 + 4] : [4.6, 2.0, 6.2],
  front: [0, 1.0, span * 1.2 + 6.5],
  rear: [0, 1.2, -(span * 1.2 + 6.5)],
  side: [span * 0.9 + 8, 0.9, 0],
  top: [0.01, span + 6, 0.01],
  rear3: span ? [span * 0.5, span * 0.25 + 1.5, -(span * 0.7 + 4)] : [4.6, 2.0, -6.2],
};
camera.position.set(...(views[q.get('view') ?? 'three'] ?? views.three));
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.7, 0);
controls.update();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
