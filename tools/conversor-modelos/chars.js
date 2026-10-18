// Monta o personagem do jogo: modelo de terno (Mixamo rig) + animações do Xbot (retarget em espaço de
// mundo) + poses procedurais (sentado, aceno, pulo). Exporta um .glb com tudo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const FPS = 30;
const mixName = (n) => 'mixamorig' + n.replace(/^mixamorig:?/, '').replace(/_\d+$/, '');

function bonesOf(root) {
  const map = new Map();
  root.traverse((o) => {
    if (o.isBone) map.set(o.name, o);
  });
  return map;
}
/** Ossos em ordem pai → filho. */
function ordered(root) {
  const list = [];
  root.traverse((o) => o.isBone && list.push(o));
  return list;
}
const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const wp = (o) => o.getWorldPosition(new THREE.Vector3());

function retarget(target, source, clip, name, keepHipsY = true) {
  const tB = bonesOf(target);
  const sB = bonesOf(source);
  const tList = ordered(target).filter((b) => sB.has(b.name));
  // Pose de descanso.
  const restT = new Map(tList.map((b) => [b.name, { q: b.quaternion.clone(), p: b.position.clone() }]));
  source.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  const Ws0 = new Map(tList.map((b) => [b.name, wq(sB.get(b.name))]));
  const Wt0 = new Map(tList.map((b) => [b.name, wq(b)]));
  const hipsS = sB.get('mixamorigHips');
  const hipsT = tB.get('mixamorigHips');
  const hs0 = wp(hipsS);
  const ht0 = wp(hipsT);
  const ratio = ht0.y / hs0.y;

  const mixer = new THREE.AnimationMixer(source);
  const action = mixer.clipAction(clip);
  action.play();
  const n = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const times = new Float32Array(n);
  const qs = new Map(tList.map((b) => [b.name, new Float32Array(n * 4)]));
  const hp = new Float32Array(n * 3);
  const tmp = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * clip.duration;
    times[i] = t;
    mixer.setTime(t);
    source.updateMatrixWorld(true);
    // Reseta o alvo e aplica de pai para filho.
    for (const b of tList) {
      const r = restT.get(b.name);
      b.quaternion.copy(r.q);
      b.position.copy(r.p);
    }
    target.updateMatrixWorld(true);
    for (const b of tList) {
      const Ws = wq(sB.get(b.name));
      const want = Ws.multiply(tmp.copy(Ws0.get(b.name)).invert()).multiply(Wt0.get(b.name));
      const parentW = b.parent ? wq(b.parent) : new THREE.Quaternion();
      b.quaternion.copy(parentW.invert().multiply(want));
      b.updateMatrixWorld(true);
      b.quaternion.toArray(qs.get(b.name), i * 4);
    }
    // Quadril: só o sobe-e-desce, escalado.
    const dy = (wp(hipsS).y - hs0.y) * ratio;
    const lp = restT.get('mixamorigHips').p.clone();
    const parentInv = hipsT.parent.matrixWorld.clone().invert();
    const world = hipsT.parent.localToWorld(lp.clone());
    world.y += keepHipsY ? dy : 0;
    world.applyMatrix4(parentInv);
    world.toArray(hp, i * 3);
  }
  action.stop();
  for (const b of tList) {
    const r = restT.get(b.name);
    b.quaternion.copy(r.q);
    b.position.copy(r.p);
  }
  const tracks = tList.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, qs.get(b.name)));
  tracks.push(new THREE.VectorKeyframeTrack('mixamorigHips.position', times, hp));
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

/**
 * Pose por direções em espaço de mundo (personagem olhando +Z, esquerda = +X): cada osso aponta para
 * o filho na direção pedida. Devolve quaternions locais.
 */
function aimPose(target, dirs, hipsY = null) {
  const list = ordered(target);
  const rest = new Map(list.map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
  target.updateMatrixWorld(true);
  const hips = list.find((b) => b.name === 'mixamorigHips');
  if (hipsY !== null) {
    const w = wp(hips);
    w.y = hipsY;
    hips.position.copy(hips.parent.worldToLocal(w));
    target.updateMatrixWorld(true);
  }
  for (const b of list) {
    const d = dirs[b.name.replace('mixamorig', '')];
    if (!d) continue;
    const child = b.children.find((c) => c.isBone);
    if (!child) continue;
    const cur = wp(child).sub(wp(b)).normalize();
    const goal = new THREE.Vector3(...d).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(cur, goal);
    const want = delta.multiply(wq(b));
    b.quaternion.copy(wq(b.parent).invert().multiply(want));
    b.updateMatrixWorld(true);
  }
  const out = new Map(list.map((b) => [b.name, b.quaternion.clone()]));
  const hp = hips.position.clone();
  for (const [b, r] of rest) {
    b.quaternion.copy(r.q);
    b.position.copy(r.p);
  }
  target.updateMatrixWorld(true);
  return { q: out, hips: hp };
}

function poseClip(name, frames, duration) {
  // frames: [{t, pose}]
  const names = [...frames[0].pose.q.keys()];
  const times = new Float32Array(frames.map((f) => f.t));
  const tracks = names.map((n) => {
    const v = new Float32Array(frames.length * 4);
    frames.forEach((f, i) => f.pose.q.get(n).toArray(v, i * 4));
    return new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, v);
  });
  const hv = new Float32Array(frames.length * 3);
  frames.forEach((f, i) => f.pose.hips.toArray(hv, i * 3));
  tracks.push(new THREE.VectorKeyframeTrack('mixamorigHips.position', times, hv));
  return new THREE.AnimationClip(name, duration, tracks);
}

function clipSpeed(target, clip) {
  // Velocidade "natural": quanto o pé recua em relação ao quadril durante meio ciclo.
  const mixer = new THREE.AnimationMixer(target);
  mixer.clipAction(clip).play();
  const foot = bonesOf(target).get('mixamorigLeftFoot');
  const hips = bonesOf(target).get('mixamorigHips');
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= 60; i++) {
    mixer.setTime((i / 60) * clip.duration);
    target.updateMatrixWorld(true);
    const z = wp(foot).z - wp(hips).z;
    min = Math.min(min, z);
    max = Math.max(max, z);
  }
  mixer.stopAllAction();
  return (max - min) / (clip.duration / 2);
}

window.buildCharacter = async (cfg) => {
  const loader = new GLTFLoader();
  const model = await loader.loadAsync(cfg.model);
  const xbot = await loader.loadAsync(cfg.anim);
  const root = model.scene;
  root.traverse((o) => {
    if (o.isBone) o.name = mixName(o.name);
  });
  xbot.scene.traverse((o) => {
    if (o.isBone) o.name = mixName(o.name);
  });
  const log = [];
  // Malhas sem skinning (dentes/língua) não acompanham o esqueleto: fora.
  const rigid = [];
  root.traverse((o) => o.isMesh && !o.isSkinnedMesh && rigid.push(o));
  for (const o of rigid) {
    log.push(`removida (sem skin): ${o.name} ${o.material.name}`);
    o.removeFromParent();
  }
  root.updateMatrixWorld(true);
  const B = bonesOf(root);
  const lh = wp(B.get('mixamorigLeftHand'));
  const head = wp(B.get('mixamorigHead'));
  log.push(`mão esquerda x=${lh.x.toFixed(2)} cabeça y=${head.y.toFixed(2)} quadril y=${wp(B.get('mixamorigHips')).y.toFixed(2)}`);
  const s = lh.x > 0 ? 1 : -1; // lado esquerdo do personagem

  const src = (n) => xbot.animations.find((a) => a.name === n);
  const clips = [
    retarget(root, xbot.scene, src('idle'), 'Idle'),
    retarget(root, xbot.scene, src('walk'), 'Walking'),
    retarget(root, xbot.scene, src('run'), 'Running'),
  ];
  log.push(`velocidades: andar ${clipSpeed(root, clips[1]).toFixed(2)} correr ${clipSpeed(root, clips[2]).toFixed(2)} m/s`);

  const hipsRestY = wp(B.get('mixamorigHips')).y;
  const L = (x, y, z) => [x * s, y, z];
  // Sentado (motorista/passageiro). Coxas para a frente, canelas para baixo.
  const sit = aimPose(
    root,
    {
      Spine: [0, 1, -0.1],
      Spine1: [0, 1, -0.08],
      Spine2: [0, 1, -0.05],
      Neck: [0, 1, 0.12],
      LeftUpLeg: L(0.1, 0.12, 1),
      RightUpLeg: L(-0.1, 0.12, 1),
      LeftLeg: L(0.02, -1, 0.55),
      RightLeg: L(-0.02, -1, 0.55),
      LeftFoot: [0, -0.3, 1],
      RightFoot: [0, -0.3, 1],
      LeftArm: L(0.3, -0.75, 0.55),
      RightArm: L(-0.3, -0.75, 0.55),
      LeftForeArm: L(-0.2, -0.5, 0.85),
      RightForeArm: L(0.2, -0.5, 0.85),
    },
    cfg.sitHipsY,
  );
  clips.push(poseClip('Sitting', [{ t: 0, pose: sit }, { t: 0.5, pose: sit }], 0.5));

  // Aceno: braço direito levantado, antebraço balançando.
  const arms = (fx) => ({
    LeftArm: L(0.18, -1, 0.02),
    LeftForeArm: L(0.08, -1, 0.12),
    RightArm: L(-0.75, 0.55, 0.15),
    RightForeArm: L(-0.15 + fx, 1, 0.2),
  });
  const w1 = aimPose(root, arms(-0.35));
  const w2 = aimPose(root, arms(0.3));
  clips.push(poseClip('Wave', [{ t: 0, pose: w1 }, { t: 0.35, pose: w2 }, { t: 0.7, pose: w1 }], 0.7));

  // Pulo: pernas recolhidas, braços para cima.
  const jumpDirs = {
    LeftUpLeg: L(0.1, -0.6, 0.75),
    RightUpLeg: L(-0.1, -0.75, 0.55),
    LeftLeg: L(0, -1, -0.45),
    RightLeg: L(0, -1, -0.3),
    LeftArm: L(0.7, 0.55, 0.1),
    RightArm: L(-0.7, 0.55, 0.1),
    LeftForeArm: L(0.35, 0.9, 0.2),
    RightForeArm: L(-0.35, 0.9, 0.2),
  };
  const j = aimPose(root, jumpDirs);
  const j0 = aimPose(root, { ...jumpDirs, LeftUpLeg: L(0.08, -0.9, 0.3), RightUpLeg: L(-0.08, -0.9, 0.3), LeftLeg: L(0, -1, -0.15), RightLeg: L(0, -1, -0.15) });
  clips.push(poseClip('Jump', [{ t: 0, pose: j0 }, { t: 0.25, pose: j }, { t: 0.9, pose: j }], 0.9));
  log.push(`quadril em repouso y=${hipsRestY.toFixed(2)}`);

  // Texturas opacas em JPEG; as com alfa (cabelo) continuam PNG.
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    for (const m of [o.material].flat()) {
      for (const k of ['map', 'metalnessMap', 'roughnessMap', 'normalMap']) {
        const t = m[k];
        if (t) t.userData.mimeType = m.transparent || m.alphaTest > 0 ? 'image/png' : 'image/jpeg';
      }
    }
  });

  // Prévia: pose sentada, aceno, andando.
  const shots = {};
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(700, 700);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb8c4cf);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.8));
  const dl = new THREE.DirectionalLight(0xffffff, 2);
  dl.position.set(2, 4, 3);
  scene.add(dl, root, new THREE.GridHelper(4, 8));
  const cam = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  const restAll = ordered(root).map((b) => [b, b.quaternion.clone(), b.position.clone()]);
  const mixer = new THREE.AnimationMixer(root);
  for (const [clipName, t, view] of [
    ['Idle', 0.5, [2.2, 1.3, 3.2]],
    ['Walking', 0.3, [3.5, 1.2, 0.2]],
    ['Running', 0.2, [3.5, 1.2, 0.2]],
    ['Sitting', 0.1, [3.2, 1.0, 1.0]],
    ['Wave', 0.1, [0.8, 1.4, 3.2]],
    ['Jump', 0.5, [3.0, 1.2, 1.5]],
  ]) {
    mixer.stopAllAction();
    const a = mixer.clipAction(clips.find((c) => c.name === clipName));
    a.play();
    mixer.setTime(t);
    cam.position.set(...view);
    cam.lookAt(0, 0.9, 0);
    r.render(scene, cam);
    shots[clipName] = r.domElement.toDataURL('image/png');
  }
  mixer.stopAllAction();
  for (const [b, q, p] of restAll) b.quaternion.copy(q), b.position.copy(p);
  scene.remove(root);
  root.position.set(0, 0, 0);

  const buf = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips, maxTextureSize: cfg.tex || 1024 });
  let bin = '';
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return { log, glb: btoa(bin), shots };
};
