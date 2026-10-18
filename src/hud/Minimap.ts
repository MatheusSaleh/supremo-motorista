// Minimapa circular em canvas 2D. A imagem de fundo é gerada uma única vez renderizando o nível
// de cima (câmera ortográfica), então funciona para qualquer Level: procedural ou .glb.
import * as THREE from 'three';
import type { Landmark, Level, LevelBounds } from '../world/Level';

export interface MinimapActor {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Renderiza o nível visto de cima para um canvas (norte do mapa = −Z no topo).
 * A leitura dos pixels é assíncrona (não trava o navegador esperando a GPU).
 */
export async function bakeMinimapImage(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  bounds: LevelBounds,
  hidden: THREE.Object3D[],
  maxPx = 2048,
): Promise<HTMLCanvasElement> {
  const wM = bounds.maxX - bounds.minX;
  const hM = bounds.maxZ - bounds.minZ;
  const ppm = Math.min(1, maxPx / Math.max(wM, hM)); // pixels por metro
  const W = Math.max(1, Math.round(wM * ppm));
  const H = Math.max(1, Math.round(hM * ppm));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;

  const cam = new THREE.OrthographicCamera(-wM / 2, wM / 2, hM / 2, -hM / 2, 1, 3000);
  cam.position.set(cx, 1500, cz);
  cam.up.set(0, 0, -1); // topo da imagem = −Z
  cam.lookAt(cx, 0, cz);

  const rt = new THREE.WebGLRenderTarget(W, H);
  rt.texture.colorSpace = THREE.SRGBColorSpace;

  // Sem neblina, céu, jogador etc. durante a captura.
  // (alterar near/far em vez de remover a neblina evita recompilar os shaders)
  const fog = scene.fog instanceof THREE.Fog ? scene.fog : null;
  const fogRange = fog ? [fog.near, fog.far] : null;
  const background = scene.background;
  const visibility = hidden.map((o) => o.visible);
  if (fog) {
    fog.near = 1e6;
    fog.far = 1e7;
  }
  scene.background = new THREE.Color(0x5d8a3e);
  hidden.forEach((o) => (o.visible = false));

  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(null);
  if (fog && fogRange) [fog.near, fog.far] = fogRange;
  scene.background = background;
  hidden.forEach((o, i) => (o.visible = visibility[i]));

  const pixels = new Uint8Array(W * H * 4);
  await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H, pixels);
  rt.dispose();

  // readPixels vem de baixo para cima: inverte as linhas.
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const row = W * 4;
  for (let y = 0; y < H; y++) img.data.set(pixels.subarray((H - 1 - y) * row, (H - y) * row), y * row);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export interface MinimapMarker {
  x: number;
  z: number;
  color: string;
}

export class Minimap {
  readonly element: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bounds: LevelBounds;
  private readonly landmarks: Landmark[];
  private dpr = 1;

  /** Imagem de fundo; null até a captura terminar (mostra só o fundo verde). */
  image: HTMLCanvasElement | null = null;

  constructor(
    level: Level,
    private readonly sizePx = 190,
    /** Raio visível em metros. */
    public viewRadius = 160,
  ) {
    this.bounds = level.bounds;
    this.landmarks = level.landmarks;
    this.element = document.createElement('canvas');
    this.element.className = 'hud-minimap';
    this.ctx = this.element.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.element.width = this.element.height = Math.round(this.sizePx * this.dpr);
    this.element.style.width = this.element.style.height = `${this.sizePx}px`;
  }

  /**
   * @param cameraYaw  yaw do CameraRig; com rotate=true a direção da câmera aponta para cima.
   * @param others     outros atores a marcar no mapa (ex.: perseguidores).
   */
  draw(
    player: MinimapActor,
    cameraYaw: number,
    rotate: boolean,
    others: readonly MinimapActor[] = [],
    markers: readonly MinimapMarker[] = [],
  ): void {
    const ctx = this.ctx;
    const r = this.sizePx / 2;
    const rot = rotate ? cameraYaw : Math.PI / 2; // sem girar: norte (−X) para cima
    const scale = r / this.viewRadius;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    // Mundo (x, z) → tela, relativo ao centro do minimapa.
    const toScreen = (x: number, z: number) => {
      const dx = (x - player.x) * scale;
      const dz = (z - player.z) * scale;
      return { x: dx * cos - dz * sin, y: dx * sin + dz * cos };
    };

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.sizePx, this.sizePx);

    // Mapa (recortado em círculo).
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#4f7a34';
    ctx.fillRect(0, 0, this.sizePx, this.sizePx);
    ctx.translate(r, r);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.translate(-player.x, -player.z);
    const b = this.bounds;
    ctx.imageSmoothingEnabled = true;
    if (this.image) ctx.drawImage(this.image, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    ctx.restore();

    ctx.save();
    ctx.translate(r, r);

    // Pontos de interesse: dentro do círculo com nome; fora, um ponto na borda.
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const labels: { x: number; y: number; w: number }[] = [];
    for (const lm of this.landmarks) {
      const p = toScreen(lm.x, lm.z);
      const d = Math.hypot(p.x, p.y);
      const inside = d < r - 14;
      const k = inside ? 1 : (r - 8) / d;
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.arc(p.x * k, p.y * k, inside ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
      // Pula o nome se encostar em outro já desenhado (o ponto continua).
      const w = ctx.measureText(lm.name).width;
      const overlaps = labels.some((l) => Math.abs(l.y - p.y) < 12 && Math.abs(l.x - p.x) < (l.w + w) / 2 + 4);
      if (inside && !overlaps) {
        labels.push({ x: p.x, y: p.y, w });
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText(lm.name, p.x, p.y - 7);
        ctx.fillStyle = '#fff';
        ctx.fillText(lm.name, p.x, p.y - 7);
      }
    }

    for (const o of others) {
      const p = toScreen(o.x, o.z);
      if (Math.hypot(p.x, p.y) > r - 6) continue;
      this.drawArrow(p.x, p.y, Math.PI - o.yaw + rot, '#4fc3ff', 5);
    }

    // Alvos (corridas): dentro do círculo, um alvo; fora, uma seta presa na borda apontando para ele.
    for (const mk of markers) {
      const p = toScreen(mk.x, mk.z);
      const d = Math.hypot(p.x, p.y);
      const edge = r - 12;
      ctx.fillStyle = mk.color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      if (d <= edge) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#000';
        ctx.fill();
      } else {
        const k = edge / d;
        this.drawArrow(p.x * k, p.y * k, Math.atan2(p.x, -p.y), mk.color, 7);
      }
    }

    // Jogador local (sempre no centro). Seta "para cima" na tela = olhando para −Z sem rotação.
    this.drawArrow(0, 0, Math.PI - player.yaw + rot, '#ff5a36', 7);

    // Indicador do norte (−X no mundo).
    const n = { x: -cos, y: -sin };
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(n.x * (r - 11), n.y * (r - 11), 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', n.x * (r - 11), n.y * (r - 11) + 0.5);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();

    // Borda.
    ctx.beginPath();
    ctx.arc(r, r, r - 1.5, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
  }

  private drawArrow(x: number, y: number, angle: number, color: string, size: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.4);
    ctx.lineTo(size, size);
    ctx.lineTo(0, size * 0.45);
    ctx.lineTo(-size, size);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }
}
