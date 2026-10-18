// Versão desktop (Electron): abre o mesmo build web (dist/) numa janela própria, com flags de GPU
// que o navegador não permite: GPU de alto desempenho, sem lista de bloqueio, sem economia de energia
// em segundo plano, WebGPU disponível e, opcionalmente, FPS sem limite (vsync desligado).
//
// As opções que dependem de flags de linha de comando (FPS livre) ficam em <userData>/desktop.json e
// só valem após reiniciar — o jogo pede o reinício pela ponte (preload.cjs).
const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.ELECTRON_DEV_URL; // ex.: http://localhost:5173 (npm run desktop:dev)
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'desktop.json');
const DEFAULTS = { uncappedFps: false, fullscreen: false };

function readConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
    fs.writeFileSync(CONFIG_FILE(), JSON.stringify(cfg, null, 2));
  } catch (err) {
    console.error('[desktop] não foi possível salvar a configuração', err);
  }
}

// ---- Flags de GPU (precisam ser aplicadas antes de app.ready) ----
const config = readConfig();
app.commandLine.appendSwitch('force_high_performance_gpu'); // notebooks com duas GPUs: usa a dedicada
app.commandLine.appendSwitch('ignore-gpu-blocklist'); // não desliga a aceleração em placas "suspeitas"
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-unsafe-webgpu'); // WebGPU também onde ainda é experimental (Linux)
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'Vulkan,WebGPU');
if (config.uncappedFps) {
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}

// Protocolo app:// serve dist/ com a mesma estrutura de URLs do site (fetch, wasm e módulos funcionam).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    title: 'Supremo Motorista',
    backgroundColor: '#cfe3f2',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    fullscreen: config.fullscreen,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // não desacelera o jogo com a janela sem foco
    },
  });
  win.once('ready-to-show', () => win.show());

  // F11 alterna tela cheia (e lembra a escolha).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      setFullscreen(win, !win.isFullScreen());
    }
  });
  // Links externos (créditos etc.) abrem no navegador do sistema, não dentro do jogo.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // GAME_DEBUG=1 expõe window.game no console (depuração do build de produção).
  void win.loadURL(DEV_URL ?? `app://game/index.html${process.env.GAME_DEBUG ? '?debug' : ''}`);
  return win;
}

function setFullscreen(win, on) {
  win.setFullScreen(on);
  config.fullscreen = on;
  writeConfig(config);
}

// ---- Ponte com o jogo (ver preload.cjs) ----
ipcMain.handle('desktop:get-config', () => ({ ...config, platform: process.platform, versions: { electron: process.versions.electron, chrome: process.versions.chrome } }));
ipcMain.handle('desktop:set-config', (event, patch) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (typeof patch.fullscreen === 'boolean' && win) setFullscreen(win, patch.fullscreen);
  if (typeof patch.uncappedFps === 'boolean') config.uncappedFps = patch.uncappedFps;
  writeConfig(config);
  return { ...config };
});
ipcMain.handle('desktop:gpu-info', async () => {
  const info = await app.getGPUInfo('basic');
  const status = app.getGPUFeatureStatus();
  return { devices: info.gpuDevice ?? [], webgl2: status.webgl2, webgpu: status.webgpu };
});
ipcMain.on('desktop:relaunch', () => {
  app.relaunch();
  app.exit(0);
});
ipcMain.on('desktop:quit', () => app.quit());

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    // Não deixa sair de dist/ (ex.: app://game/../../etc).
    if (!file.startsWith(DIST)) return new Response('Proibido', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
