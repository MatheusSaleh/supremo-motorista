// Carregamento de assets com progresso centralizado (LoadingManager).
// GLTFLoader configurado com Draco e meshopt. Os decoders são empacotados pelo Vite (funciona offline)
// e só são baixados quando um modelo comprimido é carregado.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export type ProgressCallback = (loaded: number, total: number, url: string) => void;

export class Assets {
  readonly manager = new THREE.LoadingManager();
  private readonly draco: DRACOLoader;
  private readonly gltf: GLTFLoader;
  private readonly listeners = new Set<ProgressCallback>();

  constructor() {
    this.draco = new DRACOLoader(this.manager);
    this.gltf = new GLTFLoader(this.manager).setDRACOLoader(this.draco).setMeshoptDecoder(MeshoptDecoder);
    this.manager.onProgress = (url, loaded, total) => this.listeners.forEach((cb) => cb(loaded, total, url));
  }

  /** Inscreve-se no progresso de carregamento; retorna função para cancelar. */
  onProgress(cb: ProgressCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Caminhos relativos são resolvidos a partir da pasta public/. onProgress recebe 0..1 (bytes). */
  loadGLTF(path: string, onProgress?: (fraction: number) => void): Promise<GLTF> {
    const url = /^(https?:)?\//.test(path) ? path : `${import.meta.env.BASE_URL}${path}`;
    return this.gltf.loadAsync(url, (e) => {
      if (onProgress && e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    });
  }

  dispose(): void {
    this.draco.dispose();
    this.listeners.clear();
  }
}
