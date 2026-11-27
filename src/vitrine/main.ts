// Entrada da vitrine (vitrine.html): a cena do escritório com a Esplanada ao vivo, para o topo do portfólio.
// Sem WebGL ou com erro, só avisa a página (o portfólio continua com a imagem estática).
import { Showcase } from './Showcase';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('vitrine')!;
  try {
    const showcase = new Showcase(container);
    await showcase.init();
    showcase.start();
  } catch (err) {
    console.error('[vitrine]', err);
    window.parent?.postMessage('supremo-vitrine:error', '*');
  }
}

void bootstrap();
