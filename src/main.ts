// Bootstrap: mostra o carregamento e importa o jogo sob demanda, para a tela de
// carregamento funcionar enquanto o código pesado (three + Rapier) é baixado.
import { config } from './config';
import { t } from './core/i18n';
import { LoadingScreen } from './hud/LoadingScreen';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('app')!;
  const hudRoot = document.getElementById('hud')!;
  const loading = new LoadingScreen(document.getElementById('loading')!);
  document.title = t('game.title');
  loading.setTitle(t('game.title'), t('game.subtitle'));

  try {
    loading.set(null, t('loading.download'));
    const { Game } = await import('./core/Game');
    const game = await Game.create(container, hudRoot, config, (f, label) => loading.set(f, label));
    game.start();
    loading.hide();

    if (import.meta.env.DEV) {
      const { setupDevTools } = await import('./core/devTools');
      setupDevTools(game);
    }
    // Acesso pelo console: em dev, ou com ?debug na URL (ex.: app desktop com GAME_DEBUG=1).
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
      (window as unknown as { game: typeof game }).game = game;
    }
  } catch (err) {
    console.error(err);
    const webgl = !!document.createElement('canvas').getContext('webgl2');
    loading.error(webgl ? t('loading.error', { error: String(err) }) : t('loading.noWebgl'));
  }
}

void bootstrap();
