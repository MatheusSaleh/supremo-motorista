// Ferramentas de desenvolvimento (lil-gui + stats.js). Importado dinamicamente só em modo dev,
// então nada daqui entra no build de produção.
import GUI from 'lil-gui';
import Stats from 'stats.js';
import type { Game } from './Game';

export function setupDevTools(game: Game): () => void {
  const cfg = game.cfg;

  const stats = new Stats();
  stats.showPanel(0);
  stats.dom.style.cssText = 'position:fixed;top:0;left:0;z-index:100;';
  document.body.appendChild(stats.dom);
  game.hooks.begin = () => stats.begin();
  game.hooks.end = () => stats.end();

  const gui = new GUI({ title: 'Debug' });
  if (window.innerWidth < 700) gui.close(); // em tela pequena começa recolhido (não cobre o jogo)

  const p = gui.addFolder('Jogador');
  p.add(cfg.player, 'walkSpeed', 0.5, 10, 0.1).name('velocidade (andar)');
  p.add(cfg.player, 'runSpeed', 1, 20, 0.1).name('velocidade (correr)');
  p.add(cfg.player, 'jumpHeight', 0.2, 5, 0.05).name('altura do pulo');
  p.add(cfg.player, 'turnSpeed', 1, 30, 0.5).name('velocidade de giro');
  p.add(cfg.physics, 'gravity', 1, 50, 0.5).name('gravidade');
  p.add({ respawn: () => game.localPlayer.respawn() }, 'respawn').name('voltar ao spawn');

  // Teleporte para o endereço mais próximo de cada ponto de interesse (olhando para o ponto).
  // Dirigindo, leva o carro junto.
  const tp = gui.addFolder('Teleporte');
  const level = game.world.level;
  for (const lm of level?.landmarks ?? []) {
    const go = () => {
      const near = [...(level?.addresses ?? [])].sort((a, b) => Math.hypot(a.x - lm.x, a.z - lm.z) - Math.hypot(b.x - lm.x, b.z - lm.z))[0];
      const x = near ? near.x : lm.x + 40;
      const z = near ? near.z : lm.z + 40;
      const yaw = Math.atan2(lm.x - x, lm.z - z);
      const y = game.groundAt(x, z);
      if (game.mode === 'driving') game.car.reset({ x, y, z }, yaw);
      else game.localPlayer.teleport(x, y + 0.5, z, yaw);
      game.cameraRig.yaw = yaw + Math.PI;
    };
    tp.add({ go }, 'go').name(lm.name);
  }
  tp.close();

  // Ambiente: força hora/clima/feriado para testar (o resto do tempo vem do mundo real).
  const env = { hora: -1, tempo: 'real', feriado: 'real' };
  const e = gui.addFolder('Ambiente');
  e.add(env, 'hora', -1, 24, 0.25).name('hora (−1 = real)').onChange((v: number) => (game.env.override.hour = v < 0 ? null : v));
  e.add(env, 'tempo', ['real', 'clear', 'partly', 'cloudy', 'fog', 'rain', 'storm', 'dry'])
    .name('tempo')
    .onChange((v: string) => (game.env.override.weather = v === 'real' ? null : (v as typeof game.env.override.weather)));
  e.add(env, 'feriado', ['real', 'sim', 'não']).onChange((v: string) => (game.env.override.holiday = v === 'real' ? null : v === 'sim'));
  e.close();

  // Facções: calor de cada lado (perseguidores aparecem a partir de 30/60/85).
  const fa = gui.addFolder('Facções');
  fa.add(game.polarization.heat, 'vermelhos', 0, 100, 1).name('calor Vermelhos').listen();
  fa.add(game.polarization.heat, 'amarelos', 0, 100, 1).name('calor Amarelos').listen();
  fa.add({ fire: () => Object.assign(game.polarization.heat, { vermelhos: 90, amarelos: 90 }) }, 'fire').name('provocar os dois (90)');
  fa.add({ calm: () => (game.polarization.reset(), game.pursuers.clear()) }, 'calm').name('zerar e tirar de cena');
  fa.close();

  const a = gui.addFolder('Animação');
  a.add(game.localPlayer.avatar, 'showCollider').name('mostrar colisor');
  a.add(cfg.character, 'fadeTime', 0, 1, 0.01).name('crossfade (s)');
  a.add(cfg.character, 'walkClipSpeed', 0.5, 6, 0.1).name('ref. andar (m/s)');
  a.add(cfg.character, 'runClipSpeed', 2, 12, 0.1).name('ref. correr (m/s)');
  a.add(cfg.character, 'jumpClipOffset', 0, 0.5, 0.01).name('início do pulo (s)');

  const car = game.car;
  const cc = cfg.car;
  const v = gui.addFolder('Carro');
  v.add(cc, 'engineForce', 500, 8000, 50).name('força do motor (N/roda)');
  v.add(cc, 'maxSpeed', 10, 80, 1).name('vel. máx. (m/s)');
  v.add(cc, 'brakeForce', 5, 300, 1).name('freio');
  v.add(cc, 'maxSteer', 0.1, 1, 0.01).name('esterço (parado)');
  v.add(cc, 'steerFalloffSpeed', 2, 30, 0.5).name('esterço: queda (m/s)');
  v.add(cc, 'steerAtMaxSpeed', 0.01, 0.4, 0.01).name('esterço (mínimo)');
  v.add(cc, 'frictionSlip', 0.5, 8, 0.1).name('aderência').onChange(() => car.applyWheelParams());
  v.add(cc, 'sideFriction', 0.2, 3, 0.05).name('aderência lateral').onChange(() => car.applyWheelParams());
  v.add(cc, 'driftRearSideFriction', 0, 1, 0.01).name('drift: aderência traseira');
  v.add(cc, 'driftMaxAngle', 0, 1.4, 0.05).name('drift: ângulo máx. (rad)');
  v.add(cc, 'driftYawAssist', 0, 15, 0.1).name('drift: ajuda de giro');
  v.add(cc, 'downforce', 0, 6, 0.1).name('downforce');
  v.add(cc.offroad, 'grip', 0.2, 1, 0.05).name('grama: aderência');
  v.add(cc.offroad, 'maxSpeedMul', 0.2, 1, 0.05).name('grama: vel. máx. ×');
  v.add(cc.offroad, 'drag', 0, 5, 0.1).name('grama: arrasto');
  v.add(cc, 'cornerDrag', 0, 0.3, 0.01).name('perda em curva');
  v.add(cc, 'airControl', 0, 8, 0.1).name('controle no ar');
  v.add(cc, 'suspensionStiffness', 5, 80, 1).name('suspensão: rigidez').onChange(() => car.applyWheelParams());
  v.add(cc, 'suspensionRest', 0.1, 0.6, 0.01).name('suspensão: curso').onChange(() => car.applyWheelParams());
  v.add(cc.turbo, 'forceMul', 1, 4, 0.1).name('turbo: força ×');
  v.add(cc.turbo, 'rechargePerSec', 0.01, 1, 0.01).name('turbo: recarga/s');
  v.add({ reset: () => car.resetInPlace() }, 'reset').name('reposicionar carro');
  v.add({ fix: () => game.carEffects.repair(game.car) }, 'fix').name('lavar e desamassar (carro atual)');
  v.close();

  const c = gui.addFolder('Câmera');
  c.add(game.cameraRig, 'distance', cfg.camera.minDistance, cfg.camera.maxDistance, 0.1).name('distância').listen();
  c.add(cfg.camera, 'maxDistance', 5, 60, 1).name('distância máx.');
  c.add(cfg.camera, 'targetHeight', 0.5, 3, 0.05).name('altura do alvo');
  c.add(cfg.camera, 'mouseSensitivity', 0.0005, 0.01, 0.0001).name('sensibilidade');
  c.add(cfg.camera, 'followDamping', 1, 40, 0.5).name('suavização');

  // Qualidade gráfica: menu de pausa (Esc).

  return () => {
    gui.destroy();
    stats.dom.remove();
    game.hooks.begin = game.hooks.end = undefined;
  };
}
