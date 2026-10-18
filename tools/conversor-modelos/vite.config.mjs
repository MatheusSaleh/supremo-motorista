// Servidor do conversor de modelos (ferramenta de desenvolvimento; não entra no jogo).
// Uso, na raiz do projeto: npx vite --config tools/conversor-modelos/vite.config.mjs
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const nodeModules = fileURLToPath(new URL('../../node_modules/', import.meta.url));

export default {
  root: here,
  resolve: {
    alias: [
      { find: /^three$/, replacement: nodeModules + 'three/build/three.module.js' },
      { find: /^three\/(.*)/, replacement: nodeModules + 'three/$1' },
      { find: /^meshoptimizer$/, replacement: nodeModules + 'meshoptimizer/meshopt_simplifier.js' },
    ],
  },
  server: { port: 5190, open: true, fs: { allow: [here, nodeModules] } },
  optimizeDeps: { noDiscovery: true, include: [] },
};
