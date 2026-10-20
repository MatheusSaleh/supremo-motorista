// Sedã procedural simples: reserva caso o .glb do carro não carregue (ver CarVisual.ts).
// Frente = +Z; origem = centro do chassi físico.
import * as THREE from 'three';
import type { CarModel } from './CarVisual';

export function createProceduralCarModel(wheelRadius: number): CarModel {
  const root = new THREE.Group();
  root.name = 'carro-oficial';

  // Sem env map, metalness alto deixa tudo preto chapado; um cinza bem escuro e pouco metálico lê melhor.
  const paint = new THREE.MeshStandardMaterial({ color: 0x1c1f24, metalness: 0.1, roughness: 0.32 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x3a5466, metalness: 0.2, roughness: 0.08 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.7 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.8, roughness: 0.25 });
  const headlight = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff2c8, emissiveIntensity: 0.8 });
  const taillight = new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0xb01010, emissiveIntensity: 0.6 });

  const width = 1.85;
  // Perfil lateral (z, y) extrudado na largura. ExtrudeGeometry extruda em Z; giramos para Z virar X.
  const profile = (points: [number, number][], depth: number, mat: THREE.Material) => {
    const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.rotateY(-Math.PI / 2); // (u, v, d) → (x = −d, y = v, z = u)
    geo.translate(depth / 2, 0, 0);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    return m;
  };

  // Carroceria (até a linha de cintura).
  root.add(
    profile(
      [[-2.4, -0.3], [2.4, -0.3], [2.42, 0.08], [2.15, 0.3], [-2.1, 0.34], [-2.42, 0.2]],
      width,
      paint,
    ),
  );
  // Estufa de vidro (cabine), um pouco mais estreita.
  // Vidro inclinado não recebe sombra (evita "acne" de auto-sombreamento no para-brisa).
  const greenhouse = profile([[-1.3, 0.32], [1.25, 0.32], [0.6, 0.84], [-0.88, 0.84]], width - 0.14, glass);
  greenhouse.receiveShadow = false;
  root.add(greenhouse);
  // Teto.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 0.05, 1.42), paint);
  roof.position.set(0, 0.865, -0.14);
  roof.castShadow = true;
  root.add(roof);

  // Para-choques, faróis e lanternas.
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  box(width + 0.04, 0.16, 0.12, trim, 0, -0.2, 2.42);
  box(width + 0.04, 0.16, 0.12, trim, 0, -0.2, -2.42);
  box(0.9, 0.12, 0.04, chrome, 0, 0.03, 2.43); // grade
  for (const s of [-1, 1]) {
    box(0.36, 0.1, 0.04, headlight, s * 0.66, 0.06, 2.43);
    box(0.4, 0.1, 0.04, taillight, s * 0.64, 0.14, -2.43);
    box(0.06, 0.08, 0.2, paint, s * (width / 2 + 0.03), 0.45, 1.05); // retrovisores
  }
  box(0.5, 0.11, 0.02, chrome, 0, -0.18, -2.49); // placa traseira

  // Rodas: pneu + calota. Cilindro deitado em X.
  const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.26, 14).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(wheelRadius * 0.55, wheelRadius * 0.55, 0.27, 8).rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
  const wheels: THREE.Group[] = [];
  const wheelSpins: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    const hub = new THREE.Mesh(hubGeo, chrome);
    tire.castShadow = true;
    spin.add(tire, hub);
    g.add(spin);
    root.add(g);
    wheels.push(g);
    wheelSpins.push(spin);
  }
  const seat = new THREE.Object3D();
  seat.position.set(0.42, -0.3, -0.1);
  root.add(seat);
  const eyes = new THREE.Object3D();
  eyes.position.set(0.42, 0.45, -0.1);
  const rearSeat = new THREE.Object3D();
  rearSeat.position.set(-0.45, -0.3, -0.9);
  root.add(eyes, rearSeat);
  return {
    root,
    wheels,
    wheelSpins,
    seat,
    eyes,
    rearSeat,
    grips: null,
    updateInterior: () => {},
    setLights: (brake) => (taillight.emissiveIntensity = brake ? 2.2 : 0.6),
    setEnvironment: () => {},
    setDirt: () => {},
    setPaint: (color) => paint.color.setHex(color),
    dent: () => {},
    repair: () => {},
  };
}
