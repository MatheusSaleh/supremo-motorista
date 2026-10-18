// Conversor de carros do Sketchfab para o formato do jogo (body + wheel-*), roda no Chromium headless.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';

const re = (s) => (s ? new RegExp(s, 'i') : null);
const WHEELS = [
  ['wheel-front-left', 1, 1],
  ['wheel-front-right', -1, 1],
  ['wheel-rear-left', 1, -1],
  ['wheel-rear-right', -1, -1],
];

function toF32(attr, n) {
  const out = new Float32Array(attr.count * n);
  for (let i = 0; i < attr.count; i++) {
    out[i * n] = attr.getX(i);
    if (n > 1) out[i * n + 1] = attr.getY(i);
    if (n > 2) out[i * n + 2] = attr.getZ(i);
  }
  return out;
}

let cache = { url: null, gltf: null };
async function load(url) {
  if (cache.url !== url) cache = { url, gltf: await new GLTFLoader().loadAsync(url) };
  return cache.gltf;
}

/** Peças planas: posições/normais em mundo, índice por material. */
function collect(scene) {
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const pos = toF32(g.attributes.position, 3);
    const m = o.matrixWorld;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 3) {
      v.fromArray(pos, i).applyMatrix4(m).toArray(pos, i);
    }
    let nrm = null;
    if (g.attributes.normal) {
      nrm = toF32(g.attributes.normal, 3);
      const nm = new THREE.Matrix3().getNormalMatrix(m);
      for (let i = 0; i < nrm.length; i += 3) v.fromArray(nrm, i).applyMatrix3(nm).normalize().toArray(nrm, i);
    }
    const uv = g.attributes.uv ? toF32(g.attributes.uv, 2) : null;
    const index = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const chain = [];
    for (let p = o; p; p = p.parent) chain.push(p.name);
    const nodeName = chain.join('/');
    const groups = g.groups.length ? g.groups : [{ start: 0, count: index.length, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0];
      parts.push({ nodeName, mat, pos, nrm, uv, idx: index.subarray(gr.start, gr.start + gr.count) });
    }
  });
  return parts;
}

function bboxOf(parts, filter = () => true) {
  const b = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const p of parts) {
    if (!filter(p)) continue;
    for (let k = 0; k < p.idx.length; k++) b.expandByPoint(v.fromArray(p.pos, p.idx[k] * 3));
  }
  return b;
}

function transformParts(parts, m) {
  const done = new Set();
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const v = new THREE.Vector3();
  for (const p of parts) {
    if (done.has(p.pos)) continue;
    done.add(p.pos);
    for (let i = 0; i < p.pos.length; i += 3) v.fromArray(p.pos, i).applyMatrix4(m).toArray(p.pos, i);
    if (p.nrm) for (let i = 0; i < p.nrm.length; i += 3) v.fromArray(p.nrm, i).applyMatrix3(nm).normalize().toArray(p.nrm, i);
  }
}

function triCount(parts) {
  return parts.reduce((s, p) => s + p.idx.length / 3, 0);
}

/** Classifica materiais: regras {mat, node, to}; sem regra mantém o nome original. */
function classify(parts, cfg) {
  const rules = (cfg.mats || []).map((r) => ({ mat: re(r.mat), node: re(r.node), to: r.to }));
  for (const p of parts) {
    const mn = p.mat.name || 'mat';
    const r = rules.find((r) => (!r.mat || r.mat.test(mn)) && (!r.node || r.node.test(p.nodeName)));
    p.key = r ? r.to : mn;
  }
}

function centroidOf(parts, key) {
  const b = bboxOf(parts, (p) => p.key === key);
  return b.isEmpty() ? null : b.getCenter(new THREE.Vector3());
}

/** Separa os triângulos das rodas (dentro do cilindro de cada roda). */
function splitWheels(parts, cfg) {
  const wheels = [];
  const v = new THREE.Vector3();
  for (const [name, sx, sz] of WHEELS) {
    let c, r, xMin, xMax;
    if (cfg.wheelMode === 'material') {
      const b = new THREE.Box3();
      for (const p of parts) {
        if (p.key !== cfg.wheelKey) continue;
        for (let k = 0; k < p.idx.length; k++) {
          v.fromArray(p.pos, p.idx[k] * 3);
          if (Math.sign(v.x) === sx && Math.sign(v.z) === sz) b.expandByPoint(v);
        }
      }
      c = b.getCenter(new THREE.Vector3());
      r = Math.max(b.max.y - b.min.y, b.max.z - b.min.z) / 2;
      xMin = b.min.x - (sx < 0 ? 0.04 : 0.01);
      xMax = b.max.x + (sx > 0 ? 0.04 : 0.01);
    } else {
      // Foto-escaneado: pontos de contato com o chão definem a roda; raio informado.
      const b = new THREE.Box3();
      for (const p of parts)
        for (let k = 0; k < p.idx.length; k++) {
          v.fromArray(p.pos, p.idx[k] * 3);
          const band = cfg.bandY || [0, cfg.contactY];
          if (v.y > band[0] && v.y < band[1] && Math.sign(v.x) === sx && Math.sign(v.z) === sz && Math.abs(v.z) > 0.8 && Math.abs(v.z) < 2.0 && Math.abs(v.x) > 0.5) b.expandByPoint(v);
        }
      r = cfg.radius;
      const outer = cfg.wheelX ? sx * (cfg.wheelX + cfg.tireWidth / 2) : sx > 0 ? b.max.x : b.min.x;
      const zc = cfg.wheelZ ? sz * cfg.wheelZ[sz > 0 ? 0 : 1] : (b.min.z + b.max.z) / 2;
      c = new THREE.Vector3(outer - sx * cfg.tireWidth / 2, r, zc);
      console.log(name, 'banda z', b.min.z.toFixed(3), b.max.z.toFixed(3), 'x', b.min.x.toFixed(3), b.max.x.toFixed(3));
      xMin = sx > 0 ? outer - cfg.tireWidth - 0.05 : outer - 0.03;
      xMax = sx > 0 ? outer + 0.03 : outer + cfg.tireWidth + 0.05;
    }
    wheels.push({ name, c, r, xMin, xMax });
  }
  const rr = cfg.wheelRadiusMul ?? 1.02;
  const inside = (p, i) => {
    v.fromArray(p.pos, i * 3);
    for (const w of wheels) {
      if (v.x < w.xMin || v.x > w.xMax) continue;
      if (Math.hypot(v.y - w.c.y, v.z - w.c.z) <= w.r * rr) return w;
    }
    return null;
  };
  // Cada peça vira: corpo + por roda.
  const out = [];
  for (const p of parts) {
    const body = [];
    const per = wheels.map(() => []);
    for (let t = 0; t < p.idx.length; t += 3) {
      const a = inside(p, p.idx[t]);
      const b = a && inside(p, p.idx[t + 1]);
      const c = b && inside(p, p.idx[t + 2]);
      if (a && a === b && b === c) per[wheels.indexOf(a)].push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
      else body.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
    }
    if (body.length) out.push({ ...p, idx: Uint32Array.from(body), group: 'body' });
    per.forEach((list, i) => list.length && out.push({ ...p, idx: Uint32Array.from(list), group: wheels[i].name }));
  }
  return { parts: out, wheels };
}

/** Junta peças de mesmo grupo+material em uma geometria compacta. */
function mergeGroup(list, withUv) {
  let nv = 0;
  let ni = 0;
  for (const p of list) {
    nv += p.idx.length;
    ni += p.idx.length;
  }
  // Compacta por peça: remapeia só os vértices usados.
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = new Uint32Array(ni);
  let vi = 0;
  let ii = 0;
  for (const p of list) {
    const map = new Map();
    for (let k = 0; k < p.idx.length; k++) {
      const s = p.idx[k];
      let d = map.get(s);
      if (d === undefined) {
        d = vi++;
        map.set(s, d);
        pos.push(p.pos[s * 3], p.pos[s * 3 + 1], p.pos[s * 3 + 2]);
        if (p.nrm) nrm.push(p.nrm[s * 3], p.nrm[s * 3 + 1], p.nrm[s * 3 + 2]);
        else nrm.push(0, 1, 0);
        if (withUv) uv.push(p.uv ? p.uv[s * 2] : 0, p.uv ? p.uv[s * 2 + 1] : 0);
      }
      idx[ii++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  if (withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (list.every((p) => !p.nrm)) g.computeVertexNormals();
  return g;
}

function compact(g) {
  const idx = g.index.array;
  const remap = new Int32Array(g.attributes.position.count).fill(-1);
  let n = 0;
  for (let i = 0; i < idx.length; i++) if (remap[idx[i]] < 0) remap[idx[i]] = n++;
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const arr = new Float32Array(n * a.itemSize);
    for (let i = 0; i < a.count; i++) if (remap[i] >= 0) for (let k = 0; k < a.itemSize; k++) arr[remap[i] * a.itemSize + k] = a.array[i * a.itemSize + k];
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  const ni = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) ni[i] = remap[idx[i]];
  out.setIndex(new THREE.BufferAttribute(ni, 1));
  return out;
}

let crease = 0;
function simplify(g, target, err, mode) {
  const tris = g.index.count / 3;
  if (tris <= target) return crease ? mergeVertices(toCreasedNormals(g, crease), 1e-6) : g;
  if (mode === 'posmerge') {
    g.deleteAttribute('normal');
    const hasUv = !!g.attributes.uv;
    if (!hasUv) g = mergeVertices(g, 1e-4);
    else g = mergeVertices(g, 1e-4);
  } else {
    g = mergeVertices(g, 1e-5);
  }
  const [ind] = MeshoptSimplifier.simplify(Uint32Array.from(g.index.array), g.attributes.position.array, 3, target * 3, err, mode === 'posmerge' ? ['Prune'] : []);
  g.setIndex(new THREE.BufferAttribute(ind, 1));
  g = compact(g);
  if (crease) g = mergeVertices(toCreasedNormals(g, crease), 1e-6);
  else if (mode === 'posmerge') g.computeVertexNormals();
  return g;
}

function makeMaterial(src, name) {
  let m;
  if (src.isMeshBasicMaterial) m = new THREE.MeshStandardMaterial({ map: src.map, color: src.color, roughness: 0.55, metalness: 0 });
  else m = src.clone();
  m.name = name;
  return m;
}

/** Recolore pixels vermelhos (pintura) da textura para grafite; máscara protege lanternas; placa vira lisa. */
function recolorTexture(tex, parts, cfg) {
  const img = tex.image;
  const W = img.width;
  const H = img.height;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, W, H);
  const mask = (pred) => {
    const mc = document.createElement('canvas');
    mc.width = W;
    mc.height = H;
    const mx = mc.getContext('2d');
    mx.fillStyle = '#fff';
    const v = new THREE.Vector3();
    for (const p of parts) {
      if (!p.uv) continue;
      for (let t = 0; t < p.idx.length; t += 3) {
        let ok = true;
        for (let k = 0; k < 3; k++) if (!pred(v.fromArray(p.pos, p.idx[t + k] * 3))) ok = false;
        if (!ok) continue;
        mx.beginPath();
        for (let k = 0; k < 3; k++) {
          const s = p.idx[t + k];
          const x = p.uv[s * 2] * W;
          const y = p.uv[s * 2 + 1] * H; // flipY = false no glTF
          k ? mx.lineTo(x, y) : mx.moveTo(x, y);
        }
        mx.closePath();
        mx.fill();
      }
    }
    return mx.getImageData(0, 0, W, H).data;
  };
  const keep = cfg.keepRed ? mask((v) => cfg.keepRed(v)) : null;
  let plate = null;
  for (const platePred of cfg.plates || []) {
    // Placa = triângulos claros e pouco saturados na região indicada; apaga o retângulo deles.
    const src = data.data;
    const pb = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const p of parts) {
      if (!p.uv) continue;
      for (let t = 0; t < p.idx.length; t += 3) {
        let ok = true;
        let u = 0;
        let w = 0;
        for (let k = 0; k < 3; k++) {
          const sI = p.idx[t + k];
          if (!platePred(v.fromArray(p.pos, sI * 3))) ok = false;
          u += p.uv[sI * 2] / 3;
          w += p.uv[sI * 2 + 1] / 3;
        }
        if (!ok) continue;
        const px = (Math.min(H - 1, Math.floor(w * H)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
        const mx = Math.max(src[px], src[px + 1], src[px + 2]);
        const mn = Math.min(src[px], src[px + 1], src[px + 2]);
        if (mx > 150 && mx - mn < 40) for (let k = 0; k < 3; k++) pb.expandByPoint(v.fromArray(p.pos, p.idx[t + k] * 3));
      }
    }
    console.log('placa', pb.min.toArray().map((x) => x.toFixed(2)), pb.max.toArray().map((x) => x.toFixed(2)));
    if (!pb.isEmpty()) {
      pb.expandByScalar(0.01);
      const m = mask((q) => pb.containsPoint(q));
      if (!plate) plate = m;
      else for (let i = 0; i < m.length; i += 4) plate[i] = Math.max(plate[i], m[i]);
    }
  }
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const s = max > 0 ? (max - min) / max : 0;
    let h = 0;
    if (max > min) {
      if (max === r) h = ((g - b) / (max - min) + 6) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      h *= 60;
    }
    const hueW = h < 30 ? 1 : h > 330 ? 1 : h < 50 ? (50 - h) / 20 : h > 310 ? (h - 310) / 20 : 0;
    const satW = Math.min(1, Math.max(0, (s - (cfg.satMin ?? 0.08)) / 0.2));
    let w = hueW * satW;
    if (keep && keep[i] > 128) w = 0;
    if (plate && plate[i] > 128) {
      d[i] = d[i + 1] = d[i + 2] = 205;
      continue;
    }
    if (w <= 0) continue;
    const gray = Math.min(255, (0.05 + max * 0.32) * 255);
    const tint = cfg.tint || [1, 1, 1.06];
    d[i] = d[i] * (1 - w) + gray * tint[0] * w;
    d[i + 1] = d[i + 1] * (1 - w) + gray * tint[1] * w;
    d[i + 2] = d[i + 2] * (1 - w) + Math.min(255, gray * tint[2]) * w;
  }
  cx.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.flipY = false;
  t.colorSpace = tex.colorSpace;
  t.userData.mimeType = 'image/jpeg';
  return t;
}

function preview(root) {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(900, 520);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb8c4cf);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const dl = new THREE.DirectionalLight(0xffffff, 2);
  dl.position.set(3, 6, 4);
  scene.add(dl);
  const grid = new THREE.GridHelper(10, 20, 0x333333, 0x777777);
  scene.add(grid, root);
  const cam = new THREE.PerspectiveCamera(30, 900 / 520, 0.1, 100);
  const shots = {};
  const views = { tq: [6.5, 2.6, 7.5], side: [11, 0.9, 0], front: [0, 1, 11], back: [0, 1.6, -11], top: [0.01, 13, 0] };
  for (const [k, p] of Object.entries(views)) {
    cam.position.set(...p);
    cam.lookAt(0, 0.7, 0);
    r.render(scene, cam);
    shots[k] = r.domElement.toDataURL('image/png');
  }
  scene.remove(root);
  r.dispose();
  return shots;
}

window.inspect = async (url) => {
  const gltf = await load(url);
  const parts = collect(gltf.scene);
  const mats = {};
  for (const p of parts) { const m = p.mat; mats[m.name] = `${m.type} #${m.color?.getHexString()} met${m.metalness} rough${m.roughness} op${m.opacity} tr${m.transparent} map${!!m.map}`; }
  const byMat = {};
  for (const p of parts) byMat[p.mat.name] = (byMat[p.mat.name] || 0) + p.idx.length / 3;
  const nodes = {};
  for (const p of parts) {
    const leaf = p.nodeName.split('/')[1] || p.nodeName.split('/')[0];
    const pre = leaf.replace(/[_\d.]+$/, '').replace(/_?(part|p)\d*$/i, '');
    nodes[pre] = (nodes[pre] || 0) + p.idx.length / 3;
  }
  const b = bboxOf(parts);
  return { tris: triCount(parts), mats, byMat, nodes, bbox: [b.min.toArray(), b.max.toArray()] };
};

window.convert = async (cfg) => {
  await MeshoptSimplifier.ready;
  const gltf = await load(cfg.url);
  let parts = collect(gltf.scene);
  const log = [];
  classify(parts, cfg);
  const drop = re(cfg.drop);
  const dropMat = re(cfg.dropMat);
  parts = parts.filter((p) => !(drop && drop.test(p.nodeName)) && !(dropMat && dropMat.test(p.mat.name || '')));
  if (cfg.preRot) transformParts(parts, new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...cfg.preRot)));

  // Chão do foto-escaneamento.
  if (cfg.groundCut) {
    for (let it = 0; it < 2; it++) {
      const b = bboxOf(parts);
      const lim = b.min.y + cfg.groundCut * (b.max.y - b.min.y);
      parts = parts.map((p) => {
        const keep = [];
        for (let t = 0; t < p.idx.length; t += 3) {
          const y0 = p.pos[p.idx[t] * 3 + 1];
          const y1 = p.pos[p.idx[t + 1] * 3 + 1];
          const y2 = p.pos[p.idx[t + 2] * 3 + 1];
          if (y0 < lim && y1 < lim && y2 < lim) continue;
          if (cfg.groundFlat) {
            const lim2 = b.min.y + cfg.groundFlat * (b.max.y - b.min.y);
            if (y0 < lim2 && y1 < lim2 && y2 < lim2) {
              const a = new THREE.Vector3().fromArray(p.pos, p.idx[t] * 3);
              const e1 = new THREE.Vector3().fromArray(p.pos, p.idx[t + 1] * 3).sub(a);
              const e2 = new THREE.Vector3().fromArray(p.pos, p.idx[t + 2] * 3).sub(a);
              const n = e1.cross(e2).normalize();
              if (Math.abs(n.y) > 0.8) continue;
            }
          }
          keep.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
        }
        return { ...p, idx: Uint32Array.from(keep) };
      });
    }
  }
  if (cfg.footprint) {
    // Remove sobras fora da silhueta (chão em volta): só triângulos baixos e longe do centro.
    const [fx, fz, fy] = cfg.footprint;
    const b = bboxOf(parts);
    const c = b.getCenter(new THREE.Vector3());
    parts = parts.map((p) => {
      const keep = [];
      for (let t = 0; t < p.idx.length; t += 3) {
        let out = true;
        for (let k = 0; k < 3; k++) {
          const s = p.idx[t + k] * 3;
          const x = p.pos[s] - c.x;
          const y = p.pos[s + 1] - b.min.y;
          const z = p.pos[s + 2] - c.z;
          if (!(y < fy && (Math.abs(x) > fx || Math.abs(z) > fz))) out = false;
        }
        if (!out) keep.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
      }
      return { ...p, idx: Uint32Array.from(keep) };
    });
  }

  // Eixo longo em Z.
  let b = bboxOf(parts);
  const size = b.getSize(new THREE.Vector3());
  if (size.x > size.z) transformParts(parts, new THREE.Matrix4().makeRotationY(Math.PI / 2));
  // Frente em +Z.
  let flip = !!cfg.flip;
  if (cfg.frontKey) {
    const hc = centroidOf(parts, cfg.frontKey);
    const tc = cfg.backKey ? centroidOf(parts, cfg.backKey) : bboxOf(parts).getCenter(new THREE.Vector3());
    if (hc && tc) flip = hc.z < tc.z;
    log.push(`front ${cfg.frontKey} z=${hc?.z.toFixed(2)} back z=${tc?.z.toFixed(2)} flip=${flip}`);
  }
  if (flip) transformParts(parts, new THREE.Matrix4().makeRotationY(Math.PI));
  if (cfg.yaw) transformParts(parts, new THREE.Matrix4().makeRotationY(cfg.yaw));
  // Escala para o comprimento real; chão em 0; centrado.
  b = bboxOf(parts);
  const s = cfg.length / (b.max.z - b.min.z);
  const c = b.getCenter(new THREE.Vector3());
  transformParts(parts, new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z)));
  b = bboxOf(parts);
  log.push(`size ${b.getSize(new THREE.Vector3()).toArray().map((x) => x.toFixed(3))} tris ${triCount(parts)}`);

  const split = splitWheels(parts, cfg);
  parts = split.parts;
  if (cfg.skirtCut) {
    const [sy, sz] = cfg.skirtCut;
    parts = parts.map((p) => {
      if (p.group !== 'body') return p;
      const keep = [];
      for (let t = 0; t < p.idx.length; t += 3) {
        let cut = true;
        for (let k = 0; k < 3; k++) {
          const q = p.idx[t + k] * 3;
          if (!(p.pos[q + 1] < sy && Math.abs(p.pos[q + 2]) < sz)) cut = false;
        }
        if (!cut) keep.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
      }
      return { ...p, idx: Uint32Array.from(keep) };
    });
  }
  for (const w of split.wheels) log.push(`${w.name} c=${w.c.toArray().map((x) => x.toFixed(3))} r=${w.r.toFixed(3)}`);

  // Materiais finais.
  const matMap = new Map();
  for (const p of parts) if (!matMap.has(p.key)) matMap.set(p.key, makeMaterial(p.mat, p.key));
  for (const [k, m] of matMap) {
    const ov = cfg.matOverrides?.[k];
    if (ov) for (const [pk, pv] of Object.entries(ov)) {
      if (pk === 'color' || pk === 'emissive') m[pk] = new THREE.Color(pv);
      else m[pk] = pv;
    }
    if (ov) m.needsUpdate = true;
    if (cfg.recolor && m.map) {
      const keepRed = cfg.recolor.keepRed && new Function('v', `return ${cfg.recolor.keepRed}`);
      const plates = (cfg.recolor.plates || []).map((x) => new Function('v', `return ${x}`));
      m.map = recolorTexture(m.map, parts.filter((p) => p.key === k), { ...cfg.recolor, keepRed, plates });
    } else if (m.map) m.map.userData.mimeType = cfg.mime || 'image/png';
  }

  crease = cfg.crease ? (cfg.crease * Math.PI) / 180 : 0;
  const build = (budget, err, mode) => {
    const root = new THREE.Group();
    root.name = 'car';
    const groups = ['body', ...WHEELS.map((w) => w[0])];
    const total = triCount(parts);
    let outTris = 0;
    for (const gname of groups) {
      const node = new THREE.Group();
      node.name = gname;
      const w = split.wheels.find((w) => w.name === gname);
      if (w) node.position.copy(w.c);
      const byKey = new Map();
      for (const p of parts) if (p.group === gname) (byKey.get(p.key) || byKey.set(p.key, []).get(p.key)).push(p);
      for (const [key, list] of byKey) {
        const mat = matMap.get(key);
        const hasMap = !!(mat.map || mat.normalMap || mat.roughnessMap || mat.metalnessMap || mat.aoMap || mat.emissiveMap);
        let g = mergeGroup(list, hasMap);
        if (!hasMap) g.deleteAttribute('uv');
        const tris = g.index.count / 3;
        const target = tris < 200 ? tris : Math.max(120, Math.floor((tris * budget) / total));
        g = simplify(g, target, err, mode);
        if (w) g.translate(-w.c.x, -w.c.y, -w.c.z);
        outTris += g.index.count / 3;
        if (g.index.count / 3 > 1500) log.push(`  ${mode} ${gname}/${key} ${tris} -> ${g.index.count / 3} (alvo ${target})`);
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = `${gname}-${key}`;
        node.add(mesh);
      }
      root.add(node);
    }
    return { root, outTris };
  };

  const results = {};
  for (const [label, o] of Object.entries(cfg.outputs)) {
    const { root, outTris } = build(o.budget, o.err, o.mode);
    if (o.spin) {
      // Prévia extra com as rodas giradas: centro errado aparece como roda deslocada.
      for (const n of root.children) if (n.name.startsWith('wheel')) n.rotation.x = o.spin;
      results[label + '_spin'] = { glb: '', tris: 0, shots: preview(root) };
      for (const n of root.children) n.rotation.x = 0;
    }
    const buf = await new GLTFExporter().parseAsync(root, { binary: true, maxTextureSize: o.tex || 1024 });
    let bin = '';
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    results[label] = { glb: btoa(bin), tris: outTris, shots: o.preview ? preview(root) : null };
  }
  return { log, results };
};
window.ready = true;
window.preview = preview;
