import { defineConfig } from 'vite';

export default defineConfig({
  server: { open: false },
  build: {
    target: 'es2022',
    // O Rapier embute o wasm em base64 num único módulo (~4,3 MB, 1,7 MB gzip); não há como dividi-lo.
    chunkSizeWarningLimit: 4500,
    rolldownOptions: {
      output: {
        // Separa bibliotecas grandes em arquivos próprios: download paralelo e cache entre versões do jogo.
        codeSplitting: {
          groups: [
            { name: (id: string) => (id.includes('@dimforge/rapier3d') ? 'rapier' : null) },
            { name: (id: string) => (/node_modules[\\/]three[\\/]/.test(id) ? 'three' : null) },
          ],
        },
      },
    },
  },
});
