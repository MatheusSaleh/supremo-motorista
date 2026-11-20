// Loop principal: input → física (passo fixo) → animação → câmera → render.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Config } from '../config';
import { AmbientAudio } from '../audio/AmbientAudio';
import { AudioSystem } from '../audio/AudioSystem';
import { CarAudio } from '../audio/CarAudio';
import { PlayerAudio } from '../audio/PlayerAudio';
import { CameraRig } from '../camera/CameraRig';
import { Hud } from '../hud/Hud';
import { TouchControls, isTouchDevice } from '../hud/TouchControls';
import { bakeMinimapImage, paintZones } from '../hud/Minimap';
import { Avatar } from '../player/Avatar';
import { loadCharacterAsset, type CharacterAsset } from '../player/CharacterAsset';
import { Player, type MoveIntent } from '../player/Player';
import { RideManager } from '../rides/RideManager';
import { Car, type CarControls, type CarEvent } from '../vehicle/Car';
import { CarEffects } from '../vehicle/CarEffects';
import type { CarAsset } from '../vehicle/CarVisual';
import { buildCarAsset } from '../vehicle/carDesign';
import { DEFAULT_VEHICLE, FLEET, type VehicleDef } from '../data/vehicles';
import { Atmosphere } from '../env/Atmosphere';
import { Environment, type EnvSnapshot } from '../env/Environment';
import { FACTIONS, MAX_PURSUERS, POLARIZATION, PURSUER_MODELS, TERRITORIES, other, type Territory } from '../data/factions';
import { Polarization } from '../factions/Polarization';
import { LOCAL_TARGET, Pursuers, allocateWants, type PursuitEvent, type PursuitTarget } from '../factions/Pursuers';
import { Suspicion } from '../factions/Suspicion';
import { FAVORS, SUSPICION } from '../data/banker';
import { Career, type ShiftEvent } from '../career/Career';
import { CAR_PRICES, SHIFT, type UpgradeId } from '../data/career';
import { CareerScreens } from '../hud/CareerScreens';
import { CAMPAIGN, HEADLINE_VARIANTS, evaluateEnding, headlineKind, type EndingId } from '../data/campaign';
import { Music, RADIO_PLAYLIST } from '../audio/Music';
import { desktop } from './desktop';
import { RoadGraph } from '../world/RoadGraph';
import { SeatedDriver } from '../player/SeatedDriver';
import { World } from '../world/World';
import { createCity } from '../world/city';
import { levelFromGLTF, type GarageSlot, type Level } from '../world/Level';
import { createTestArena } from '../world/testArena';
import { Assets } from './Assets';
import { installBVH } from './bvh';
import { t } from './i18n';
import { Input } from './Input';
import { Multiplayer } from '../net/Multiplayer';
import { FLAG, type PlayerState, type PursuitWants } from '../net/protocol';
import { ProgressTracker, nextFrame, type ProgressCallback } from './progress';
import { loadSettings, saveSettings, type Settings } from './Settings';

export type PlayMode = 'onFoot' | 'driving';

/** Marca (sessionStorage) que o jogo recarregou por "Novo jogo": pula o menu e abre o capítulo 1. */
const NEW_GAME_FLAG = 'supremo.newGame';

/** Distância máxima (m) do centro do carro para conseguir entrar. */
const ENTER_DISTANCE = 3.4;
/** Velocidade máxima (m/s) para conseguir sair do carro. */
const EXIT_MAX_SPEED = 4;

export interface FrameHooks {
  begin?: () => void;
  end?: () => void;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly physics: RAPIER.World;
  readonly world: World;
  readonly input: Input;
  readonly cameraRig: CameraRig;
  readonly localPlayer: Player;
  readonly hud: Hud;
  readonly carAudio: CarAudio;
  /** Frota (todos os carros no mapa) e o carro atual (o último em que Josué entrou). */
  readonly cars: Car[];
  car: Car;
  readonly carEffects: CarEffects;
  private readonly driver: SeatedDriver | null;
  private serviceTimer = 0;
  readonly rides: RideManager;
  /** Hora, clima e feriados reais de Brasília (e o efeito deles no visual/física). */
  readonly env: Environment;
  private readonly atmosphere: Atmosphere;
  /** Fase 8: ruas para a IA, polarização das facções e os carros que perseguem o oficial. */
  readonly roadGraph: RoadGraph | null;
  readonly polarization = new Polarization();
  readonly pursuers: Pursuers;
  private territory: Territory | null = null;
  /** Fase 9: Medidor de Suspeição (favores do Dr. Caixeta, imprensa, Corregedoria). */
  readonly suspicion = new Suspicion();
  private suspicionWarned = false;
  /** Multiplayer (modo livre): outros jogadores dirigindo pela mesma cidade. */
  readonly net: Multiplayer;
  private readonly netState: PlayerState = { flags: 0, vehicle: 0, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, steer: 0 };
  /** O jogador deste computador como alvo dos perseguidores, e quantos ele atrai agora. */
  private readonly localTarget: PursuitTarget = { id: LOCAL_TARGET, position: new THREE.Vector3(), velocity: { x: 0, y: 0, z: 0 }, collider: null };
  private myWants: PursuitWants = { vermelhos: 0, amarelos: 0, imprensa: 0 };
  /** Garagem deste jogador (Level.garages): a 0 no solo; no multiplayer, a que o servidor der. */
  private garageIndex = 0;
  /** Fase 11: carreira (dias, Oficina, salvamento) e as telas dela. */
  readonly career: Career;
  private readonly careerScreens: CareerScreens;
  /** Tela da carreira aberta (contracheque ou Oficina): a simulação para, sem abrir o menu de pausa. */
  private modal: 'summary' | 'workshop' | 'card' | null = null;
  /** Fase 12: trilha, menu principal (câmera passeando), final pendente e perseguições do dia. */
  private readonly music: Music;
  private menuOrbit: number | null = null;
  private pendingEnding: EndingId | null = null;
  private dayChases = 0;
  private saveTimer = 30;
  private readonly onUnload = () => this.saveCareer();
  private immunityTimer = 0;
  private envTimer = 0;
  private envKey = '';
  private envHud: { text: string; badge: string | null } = { text: '', badge: null };
  // Eventos do frame repassados às corridas.
  private framePropsBroken = 0;
  private frameSplashed = false;
  private readonly arrowAnchor = new THREE.Vector3();
  private readonly tmpProj = new THREE.Vector3();
  private readonly playerAudio: PlayerAudio;
  private readonly ambientAudio: AmbientAudio;
  mode: PlayMode = 'onFoot';
  /** Dirigindo com a câmera dentro do carro (tecla C). */
  cockpit = false;
  /** Ganchos opcionais por frame (usados pelo stats.js em dev). */
  readonly hooks: FrameHooks = {};
  settings: Settings;

  private readonly timer = new THREE.Timer();
  private accumulator = 0;
  private paused = false;
  private pausedAt = 0;
  private readonly intent: MoveIntent = { x: 0, z: 0, run: false };
  private readonly carControls: CarControls = { throttle: 0, steer: 0, handbrake: false, turbo: false };
  // Carro estacionado e sem motorista fica com o freio de mão puxado.
  private readonly parkedControls: CarControls = { throttle: 0, steer: 0, handbrake: true, turbo: false };
  /** Mensagem temporária no HUD (ex.: "Pare o carro para sair"). */
  private toast: { text: string; until: number } | null = null;
  private readonly tmpVec = new THREE.Vector3();
  // Último lugar seguro (fora d'água, no chão) do carro e do Josué, para voltar após cair no lago.
  private readonly safeCar = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly safePlayer = { x: 0, y: 0, z: 0, yaw: 0 };
  private safeTimer = 0;
  private surfaceTimer = 0;
  private readonly events = new RAPIER.EventQueue(true);
  private sinkTimer = 0;
  private readonly tmpForward = new THREE.Vector3();
  private readonly onResize = () => this.resize();
  private readonly onVisibility = () => {
    if (document.hidden) this.setPaused(true);
  };

  /** Inicializa o Rapier, carrega os assets e prepara a cena, informando o progresso. */
  static async create(
    container: HTMLElement,
    hudRoot: HTMLElement,
    cfg: Config,
    onProgress: ProgressCallback = () => {},
  ): Promise<Game> {
    installBVH();
    const assets = new Assets();
    const progress = new ProgressTracker({ physics: 1, character: 3, vehicle: 1, level: 2, audio: 2, build: 1, shaders: 1 }, onProgress);
    const audio = new AudioSystem();

    progress.set('physics', 0, t('loading.physics'));
    const lowQuality = ['baixa', 'media'].includes(loadSettings().quality);
    const [, character, level, , carAssets, pursuerAssets, passengerAssets] = await Promise.all([
      RAPIER.init().then(() => progress.set('physics', 1)),
      loadCharacterAsset(assets, cfg, (f) => progress.set('character', f, t('loading.character')))
        .catch((err: unknown) => {
          console.warn('[game] falha ao carregar o personagem; usando cápsula placeholder.', err);
          return null;
        })
        .finally(() => progress.set('character', 1)),
      loadLevel(assets, cfg.world.level, (f) => progress.set('level', f, t('loading.level'))).then((l) => {
        progress.set('level', 1);
        return l;
      }),
      audio.load((f) => progress.set('audio', f, t('loading.audio'))),
      // Frota: carros fictícios gerados em código (rápido; Baixa/Média usam a versão com menos polígonos).
      Promise.resolve().then(() => {
        const map = new Map(FLEET.map((def) => [def.id, buildCarAsset(def.design, lowQuality)] as const));
        progress.set('vehicle', 1, t('loading.vehicle'));
        return map;
      }),
      // Perseguidores: sempre a versão leve dos carros da frota.
      Promise.resolve().then(() =>
        PURSUER_MODELS.map((id) => {
          const def = FLEET.find((d) => d.id === id);
          return def ? buildCarAsset(def.design, true) : null;
        }),
      ),
      // Passageiros com outros rostos (falha num modelo: só não entra na variedade).
      Promise.all(cfg.character.passengerUrls.map((url) => loadCharacterAsset(assets, cfg, undefined, url).catch(() => null))),
    ]);

    progress.set('build', 0, t('loading.colliders'));
    await nextFrame();
    const game = new Game(
      container,
      hudRoot,
      cfg,
      assets,
      character,
      passengerAssets.filter((a): a is CharacterAsset => a !== null),
      level,
      audio,
      carAssets,
      pursuerAssets,
    );
    progress.set('build', 1, t('loading.graphics'));
    await nextFrame();
    // Compila os shaders antes do primeiro frame (evita travadas ao começar a andar), em paralelo
    // quando o navegador suporta. O minimapa é capturado depois, já com o jogo rodando (start()).
    game.pursuers.setCompileVisible(true); // compila os materiais dos perseguidores agora, não no 1º surgimento
    await game.renderer.compileAsync(game.world.scene, game.camera);
    game.pursuers.setCompileVisible(false);
    progress.set('shaders', 1, t('loading.ready'));
    return game;
  }

  private constructor(
    private readonly container: HTMLElement,
    hudRoot: HTMLElement,
    readonly cfg: Config,
    readonly assets: Assets,
    character: CharacterAsset | null,
    extraPassengers: CharacterAsset[],
    level: Level,
    readonly audio: AudioSystem,
    carAssets: Map<string, CarAsset | null>,
    pursuerAssets: (CarAsset | null)[],
  ) {
    this.settings = loadSettings();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    const c = cfg.camera;
    this.camera = new THREE.PerspectiveCamera(c.fov, 1, c.near, c.far);

    this.physics = new RAPIER.World({ x: 0, y: -cfg.physics.gravity, z: 0 });
    this.physics.timestep = cfg.physics.fixedStep;

    this.world = new World(this.physics, cfg);
    this.world.setLevel(level);

    const spawn = { position: level.spawn, yaw: level.spawnYaw };
    this.localPlayer = new Player(this.physics, cfg, new Avatar(character, cfg), spawn, 'josue', t('character.josue'));
    this.world.scene.add(this.localPlayer.avatar.root);

    // Frota nas vagas do nível; sem vagas (arena de teste, .glb sem "CarSpawn" múltiplo), só o carro padrão.
    const spots = level.fleetSpawns ?? [level.vehicleSpawn];
    const defs: VehicleDef[] = spots.length >= FLEET.length ? FLEET : [FLEET.find((d) => d.id === DEFAULT_VEHICLE)!];
    this.cars = defs.map((def, i) => new Car(this.physics, cfg, spots[i].position, spots[i].yaw, carAssets.get(def.id) ?? null, def));
    this.car = this.cars.find((c) => c.def?.id === DEFAULT_VEHICLE) ?? this.cars[0];
    const home = spots[this.cars.indexOf(this.car)];
    Object.assign(this.safeCar, { x: home.position.x, y: home.position.y, z: home.position.z, yaw: home.yaw });
    Object.assign(this.safePlayer, { x: level.spawn.x, y: level.spawn.y, z: level.spawn.z, yaw: level.spawnYaw });
    this.carEffects = new CarEffects(this.world.scene);
    this.roadGraph = level.roads?.length ? new RoadGraph(level.roads) : null;
    this.pursuers = new Pursuers(this.physics, cfg, this.world.scene, pursuerAssets, this.roadGraph, this.world, audio, this.carEffects);
    this.env = new Environment(this.settings.realWorld);
    this.atmosphere = new Atmosphere(this.world, audio);
    this.atmosphere.attachCar(this.car, this.allCars);
    // Reflexos só nos carros (ambiente pré-filtrado gerado uma vez; o resto da cena não paga nada).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    for (const c of [...this.cars, ...this.pursuers.all]) c.model.setEnvironment(env);
    pmrem.dispose();
    // Carros dos outros jogadores: versão leve do modelo, gerada na primeira vez que alguém usa cada um.
    const remoteCars = new Map<string, CarAsset | null>();
    this.net = new Multiplayer(
      cfg,
      this.world.scene,
      this.physics,
      {
        carAsset: (def) => {
          if (!remoteCars.has(def.id)) remoteCars.set(def.id, buildCarAsset(def.design, true));
          return remoteCars.get(def.id) ?? null;
        },
        environment: env,
        addLights: (root) => this.atmosphere.addLightRoot(root),
        removeLights: (root) => this.atmosphere.removeLightRoot(root),
      },
      (info) => this.hud?.pauseMenu.setOnline(info),
      (kind, name) => this.showToast(t(kind === 'join' ? 'online.joined' : 'online.left', { name }), 3, 'info'),
      (index) => this.setGarage(index),
    );
    this.net.attachPursuers(this.pursuers);
    this.driver = character ? new SeatedDriver(character, cfg) : null;
    if (this.driver) this.car.model.seat.add(this.driver.root);
    for (const c of this.cars) this.world.scene.add(c.model.root);

    const touch = isTouchDevice();
    this.input = new Input(this.renderer.domElement, c.usePointerLock && !touch);
    this.input.onPointerLockChange = (locked) => {
      // O navegador solta o pointer lock ao apertar Esc: tratamos como pausa.
      if (!locked && !this.paused && !this.modal) this.setPaused(true);
    };
    this.cameraRig = new CameraRig(this.camera, cfg, (o, d, far) => this.world.cameraCandidates(o, d, far));
    this.cameraRig.yaw = level.spawnYaw + Math.PI; // começa atrás do jogador

    this.hud = new Hud(
      hudRoot,
      level,
      this.settings,
      {
        onResume: () => this.setPaused(false),
        onChange: (s) => this.applySettings(s),
        onNewGame: () => this.newGame(),
        onToMenu: () => this.toMainMenu(),
      },
      touch ? new TouchControls(this.input, () => this.setPaused(!this.paused)) : null,
      () => this.rides.accept(),
    );
    // Sons de interface: botões e controles do HUD/menu (delegação de eventos).
    hudRoot.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) audio.play('uiClick');
    });
    hudRoot.addEventListener('change', () => audio.play('uiToggle'));

    this.camera.add(audio.listener);
    this.world.scene.add(this.camera); // a câmera precisa estar na cena para o listener acompanhar
    this.carAudio = new CarAudio(audio, this.car, cfg);
    this.playerAudio = new PlayerAudio(audio, this.localPlayer, this.world);
    this.ambientAudio = new AmbientAudio(audio, level);
    const passengerModels = character ? [character, ...extraPassengers] : [];
    this.rides = new RideManager(level, this.world.scene, this.car.model.rearSeat, passengerModels, cfg, {
      sound: (id) => audio.play(id),
      toast: (text) => this.showToast(text, 3, 'info'),
      delivered: (f) => this.polarization.delivered(f),
      favorAccepted: () => this.suspicion.accepted(),
      favorDeclined: () => this.suspicion.declined(),
      finished: ({ favor, toBank, late }) => {
        this.career.rideFinished(late, !!favor);
        this.saveCareer();
        if (favor) this.suspicion.deliveredFavor();
        else this.suspicion.cleanRide();
        if (toBank && !favor) this.suspicion.cafezinho();
      },
    });
    this.rides.setVehicle(this.car);

    // Carreira salva: dinheiro, suspeição, melhorias, carros e o expediente em andamento.
    const loaded = Career.load();
    this.career = loaded.career;
    if (loaded.extras) {
      this.rides.money = loaded.extras.money;
      Object.assign(this.suspicion, loaded.extras.suspicion);
    }
    this.careerScreens = new CareerScreens(
      hudRoot,
      {
        onContinue: () => this.startNextDay(),
        onBuyUpgrade: (id) => this.buyUpgrade(id),
        onBuyCar: (id) => this.buyCar(id),
        onCloseWorkshop: () => this.closeModal(),
        onCardAct: (act) => this.cardAct(act),
      },
      FLEET.map((d) => ({ id: d.id, nameKey: d.nameKey })),
    );
    this.applyCareer();
    this.music = new Music(audio);
    window.addEventListener('beforeunload', this.onUnload);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.applySettings(this.settings);

    // Posiciona câmera/sombra para o compileAsync e o primeiro frame.
    this.localPlayer.update(0, 1);
    for (const c of this.cars) c.update(1);
    this.cameraRig.update(0, this.localPlayer.position);
    this.world.update(this.localPlayer.position, this.camera.position);
    this.updateEnvironment(0);
  }

  /** Captura o mapa visto de cima para o minimapa (uma vez, no carregamento). */
  async bakeMinimap(): Promise<void> {
    const level = this.world.level!;
    // Sem recompilar shaders: afasta a área de sombra para fora do mapa durante a captura.
    this.world.update({ x: 1e5, y: 0, z: 1e5 }, this.camera.position);
    this.world.cullDetail(this.camera.position, true); // o mapa mostra tudo, perto ou longe
    this.atmosphere.applyDaylight(); // mapa claro mesmo de noite ou com chuva
    const image = await bakeMinimapImage(this.renderer, this.world.scene, level.bounds, [
      ...this.world.minimapHidden,
      this.localPlayer.avatar.root,
      ...this.cars.map((c) => c.model.root),
    ]);
    this.world.update(this.localPlayer.position, this.camera.position);
    paintZones(image, level.bounds, TERRITORIES.map((tr) => ({ ...tr, color: FACTIONS[tr.faction].css })));
    this.hud.setMinimapImage(image);
  }

  start(): void {
    this.timer.connect(document); // pausa o relógio quando a aba fica oculta
    this.renderer.setAnimationLoop((t) => this.frame(t));
    // Fase 12: menu principal; logo depois de "Novo jogo" (que recarrega a página), direto no capítulo 1.
    let fresh = false;
    try {
      fresh = sessionStorage.getItem(NEW_GAME_FLAG) === '1';
      sessionStorage.removeItem(NEW_GAME_FLAG);
    } catch {
      /* sem storage */
    }
    if (fresh) this.showChapter();
    else this.showMainMenu();
    // A captura renderiza e restaura a cena no mesmo instante; só a leitura dos pixels é assíncrona,
    // então pode acontecer com o jogo já rodando (o minimapa aparece uma fração de segundo depois).
    requestAnimationFrame(() => void this.bakeMinimap());
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.audio.setDucked(paused);
    this.audio.play(paused ? 'uiOpen' : 'uiClose');
    this.input.reset();
    this.input.enabled = !paused;
    if (paused) {
      this.pausedAt = performance.now();
      this.input.exitPointerLock();
      this.refreshCareerTab();
    } else {
      this.accumulator = 0;
      // Chamado a partir de um clique/tecla (gesto do usuário); se falhar, arrastar ou clicar ainda funciona.
      this.input.requestPointerLock();
    }
  }

  applySettings(s: Settings): void {
    this.settings = s;
    saveSettings(s);
    this.net.setEnabled(s.online && this.cfg.multiplayer.enabled, s.nickname);
    this.world.setShadowMapSize(s.shadowMapSize);
    this.world.setShadowsEnabled(s.shadows);
    this.world.setShadowRange(s.shadowRange);
    this.world.setDrawDistance(s.drawDistance);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, s.resolution));
    this.resize();
    this.hud.applySettings(s);
    this.audio.setVolumes(s.audio);
    this.env.realWorld = s.realWorld;
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('beforeunload', this.onUnload);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.hud.dispose();
    this.carAudio.dispose();
    this.ambientAudio.dispose();
    this.audio.dispose();
    this.localPlayer.dispose();
    for (const c of this.cars) c.dispose();
    this.carEffects.dispose();
    this.pursuers.dispose();
    this.atmosphere.dispose();
    this.rides.dispose();
    this.net.dispose();
    this.driver?.dispose();
    this.physics.free();
    this.assets.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private frame(time: number): void {
    this.hooks.begin?.();
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);

    // Esc alterna a pausa. Ignora um Esc logo após pausar: ao sair do pointer lock o navegador
    // às vezes também entrega o keydown, o que despausaria imediatamente.
    if (this.modal) this.modalInput();
    else if (this.input.consumePressed('Escape')) {
      if (!this.paused) this.setPaused(true);
      else if (performance.now() - this.pausedAt > 250) this.setPaused(false);
    }

    if (!this.paused && !this.modal) this.simulate(dt);
    this.net.update(dt, this.camera);
    this.net.syncPursuit(dt, this.myWants);
    this.net.sendLocal(dt, this.localNetState(), !this.paused && !this.modal && this.menuOrbit === null);
    this.careerScreens.updateBadge(this.career, this.rides.money);
    if (this.menuOrbit !== null) this.orbitCamera(dt);
    this.updateMusic();
    this.ambientAudio.update(this.camera.position, this.atmosphere.night, this.atmosphere.rainLevel);
    this.updateEnvironment(dt);

    this.world.update(this.localPlayer.position, this.camera.position);
    const driving = this.mode === 'driving';
    const focus = driving ? this.car.position : this.localPlayer.position;
    this.hud.update({
      ride: this.rides.view(focus),
      bubbleAt: this.bubbleScreenPosition(),
      dt,
      player: this.localPlayer.state,
      cameraYaw: this.cameraRig.yaw,
      pointerLocked: this.input.pointerLocked,
      paused: this.paused,
      mode: this.mode,
      car: driving ? { speedKmh: this.car.speedKmh, turbo: this.car.turbo, turboActive: this.car.turboActive } : null,
      prompt: this.currentPrompt(),
      env: this.envHud,
      polar: {
        heat: this.polarization.heat,
        territory: this.territory ? { text: t('hud.territory', { faction: t(FACTIONS[this.territory.faction].nameKey), name: t(this.territory.nameKey) }), color: FACTIONS[this.territory.faction].css } : null,
        pursuers: this.pursuers.count - this.pursuers.pressCount,
        suspicion: this.suspicion.value,
        press: this.pursuers.pressCount,
      },
      others: [...this.pursuers.actors(), ...this.net.actors()],
    });
    this.renderer.render(this.world.scene, this.camera);

    this.input.endFrame();
    this.hooks.end?.();
  }

  private simulate(dt: number): void {
    const step = this.cfg.physics.fixedStep;

    // 1) Input
    const mouse = this.input.consumeMouseDelta();
    // Na câmera interna o mouse só move o olhar (não gira a câmera externa).
    if (!(this.mode === 'driving' && this.cockpit)) this.cameraRig.handleInput(mouse.x, mouse.y, this.input.consumeWheel());
    else this.input.consumeWheel();
    if (this.input.consumePressed('KeyE')) {
      if (this.mode === 'onFoot') this.tryEnterCar();
      else this.tryExitCar();
    }
    if (this.input.consumePressed('Enter') || this.input.consumePressed('NumpadEnter')) this.rides.accept();
    const driving = this.mode === 'driving';
    if (driving) {
      this.readCarControls();
      if (this.input.consumePressed('KeyR')) this.car.resetInPlace();
      if (this.input.consumePressed('KeyC')) this.setCockpit(!this.cockpit);
      this.carAudio.horn(dt, this.input.isDown('KeyH'));
    } else {
      this.readMoveIntent();
      if (this.input.consumePressed('Space')) this.localPlayer.requestJump();
    }

    // Perseguidores decidem (com as posições do frame anterior) antes da física. No multiplayer, quem
    // roda a IA (o anfitrião) caça também os outros jogadores; os eventos que me atingem podem vir da rede.
    this.myWants = allocateWants(this.polarization, this.suspicion.wantedPress(), MAX_PURSUERS[this.settings.quality]);
    const lt = this.localTarget;
    const lv = this.car.body.linvel();
    lt.position.copy(this.car.position);
    Object.assign(lt.velocity, { x: lv.x, y: lv.y, z: lv.z });
    lt.collider = this.car.body.collider(0);
    const pursuit = [
      ...this.pursuers.think(dt, [{ target: lt, wants: this.myWants }, ...this.net.remoteTargets()], this.camera),
      ...this.net.drainPursuitEvents(),
    ];

    // 2) Física em passo fixo
    this.net.beforePhysics();
    this.pursuers.beforePhysics();
    this.physics.gravity = { x: 0, y: -this.cfg.physics.gravity, z: 0 };
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= step && steps < this.cfg.physics.maxSubSteps) {
      if (!driving) this.localPlayer.fixedUpdate(step, this.intent);
      for (const c of this.cars) c.fixedUpdate(step, driving && c === this.car ? this.carControls : this.parkedControls);
      this.pursuers.fixedUpdate(step);
      this.physics.step(this.events);
      for (const e of this.world.breakables.handleEvents(this.events)) {
        this.audio.play(e.kind === 'tree' ? 'impactWood' : 'impactMedium', { position: e.position });
        const car = this.cars.find((c) => c.body === e.body) ?? this.pursuers.carOf(e.body);
        car?.knockedProp(e.kind === 'tree' ? 0.82 : 0.9);
        if (e.body !== this.car.body) continue; // perseguidor: só o tranco
        this.framePropsBroken++;
        this.polarization.propBroken(e.position.x, e.position.z);
      }
      for (const c of this.cars) c.postStep();
      this.pursuers.postStep();
      this.accumulator -= step;
      steps++;
    }
    if (steps === this.cfg.physics.maxSubSteps) this.accumulator = 0; // descarta atraso acumulado
    const alpha = this.accumulator / step;

    this.checkWater(dt);
    // Piso sob o carro (asfalto x grama), consultado ~6x por segundo.
    this.surfaceTimer -= dt;
    if (this.surfaceTimer <= 0) {
      this.surfaceTimer = 0.15;
      this.car.offroad = this.world.surfaceAt(this.car.position) === 'grass';
    }
    this.world.breakables.update(dt);
    const carEvents = this.car.drainEvents();
    this.carAudio.update(dt, driving ? this.carControls.throttle : 0, carEvents);
    this.carEffects.handleEvents(carEvents, this.car.model);
    if (carEvents.some((e) => e.type === 'impact' && e.strength > 3)) this.car.damaged = true;
    // Carros parados: só o visual dos amassados (sem som/corrida), se alguém os empurrar.
    for (const c of this.cars) if (c !== this.car) this.carEffects.handleEvents(c.drainEvents(), c.model);
    for (const c of this.pursuers.active) this.carEffects.handleEvents(c.drainEvents(), c.model);
    this.updateFactions(dt, driving, pursuit);
    this.updateSuspicion(dt, carEvents);
    this.updateCareer(dt, driving);
    this.carEffects.update(dt, this.car, this.car.model);
    this.car.model.updateInterior(this.car.steerAngle, this.car.speedKmh, this.carAudio.engineRpm);
    // Mãos no volante (IK): precisa das matrizes do carro já na posição deste frame.
    if (this.driver?.visible && this.car.model.grips) {
      this.car.model.root.updateMatrixWorld(true);
      this.driver.update(this.car.model.grips);
    }
    this.updateGarageService(dt);
    if (!driving) this.playerAudio.update();

    // 3) Animação / interpolação visual
    for (const c of this.cars) c.update(alpha);
    this.pursuers.update(alpha);
    if (driving) {
      const p = this.car.position;
      this.localPlayer.followExternal(p.x, p.y, p.z, this.car.heading);
    } else {
      this.localPlayer.update(dt, alpha);
    }

    this.updateRides(dt, driving, carEvents);

    // 4) Câmera
    if (driving) {
      // Olha para onde o carro vai (bonito no drift); em ré ou devagar, para a frente do carro.
      const vel = this.car.velocityHeading();
      const heading = this.car.forwardSpeed > 3 ? vel.yaw : this.car.heading;
      if (this.cockpit) this.cameraRig.updateCockpit(dt, this.car.model.eyes, mouse.x, mouse.y);
      else this.cameraRig.update(dt, this.car.position, { heading, speed: vel.speed });
    } else {
      this.cameraRig.update(dt, this.localPlayer.position);
    }
  }

  /** Estado do jogador local para o multiplayer: o carro (dirigindo) ou a posição do Josué (a pé). */
  private localNetState(): PlayerState {
    const s = this.netState;
    const car = this.car;
    s.vehicle = Math.max(0, FLEET.findIndex((d) => d === car.def));
    if (this.mode === 'driving') {
      const root = car.model.root;
      s.x = root.position.x;
      s.y = root.position.y;
      s.z = root.position.z;
      s.qx = root.quaternion.x;
      s.qy = root.quaternion.y;
      s.qz = root.quaternion.z;
      s.qw = root.quaternion.w;
      s.speed = car.forwardSpeed;
      s.steer = car.steerAngle;
      s.flags =
        (car.braking ? FLAG.BRAKE : 0) |
        (car.reversing ? FLAG.REVERSE : 0) |
        (car.turboActive ? FLAG.TURBO : 0) |
        (this.input.isDown('KeyH') ? FLAG.HORN : 0);
    } else {
      const p = this.localPlayer.position;
      const q = this.localPlayer.avatar.root.quaternion;
      s.x = p.x;
      s.y = p.y;
      s.z = p.z;
      s.qx = q.x;
      s.qy = q.y;
      s.qz = q.z;
      s.qw = q.w;
      s.speed = 0;
      s.steer = 0;
      s.flags = FLAG.ON_FOOT;
    }
    return s;
  }

  /** Carro da frota mais próximo de Josué, ao alcance para entrar. */
  private nearbyCar(): Car | null {
    const p = this.localPlayer.position;
    let best: Car | null = null;
    let bestD = ENTER_DISTANCE;
    for (const car of this.cars) {
      const c = car.position;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d <= bestD && Math.abs(p.y - c.y) < 2) {
        best = car;
        bestD = d;
      }
    }
    return best;
  }

  /** Troca o carro atual: motorista, som do motor e passageiro passam para ele. */
  private switchCar(car: Car): void {
    if (car === this.car) return;
    this.car = car;
    if (this.driver) car.model.seat.add(this.driver.root);
    this.carAudio.setCar(car);
    this.rides.setVehicle(car);
    this.atmosphere.attachCar(car, this.allCars);
    const p = car.position;
    Object.assign(this.safeCar, { x: p.x, y: this.groundAt(p.x, p.z), z: p.z, yaw: car.heading });
  }

  private tryEnterCar(): void {
    const car = this.nearbyCar();
    if (!car) return;
    if (car.def && !this.career.owns(car.def.id)) {
      this.showToast(this.lockedText(car.def.id, car.def.nameKey), 2.5, 'error');
      return;
    }
    this.switchCar(car);
    this.localPlayer.setEnabled(false);
    this.mode = 'driving';
    this.carAudio.enter();
    if (this.driver) this.driver.visible = true;
    this.audio.setMuffled(true);
    this.input.reset(); // evita que Shift/Espaço ainda pressionados virem turbo/freio de mão
    if (car.def) this.showToast(`${t(car.def.nameKey)} — ${t(car.def.taglineKey)}`, 4.5, 'info');
  }

  private tryExitCar(): void {
    if (Math.abs(this.car.forwardSpeed) > EXIT_MAX_SPEED) {
      this.showToast(t('hud.prompt.stopToExit'), 1.6, 'error');
      return;
    }
    // Porta do motorista, porta do passageiro e, em último caso, em cima do carro.
    const left = this.car.doorPoint(1, new THREE.Vector3());
    const right = this.car.doorPoint(-1, new THREE.Vector3());
    const roof = this.tmpVec.copy(this.car.position).setY(this.car.position.y + 1.2);
    const spot = [left, right, roof].find((s) => this.localPlayer.canFitAt(s, this.car.body));
    if (!spot) {
      this.showToast(t('hud.prompt.noRoomToExit'), 1.6, 'error');
      return;
    }
    this.localPlayer.setEnabled(true);
    this.localPlayer.teleport(spot.x, spot.y, spot.z, this.car.heading);
    this.mode = 'onFoot';
    this.carAudio.exit();
    this.setCockpit(false);
    if (this.driver) this.driver.visible = false;
    this.audio.setMuffled(false);
    this.localPlayer.drainEvents(); // descarta o "pouso" do teleporte
    this.playerAudio.reset();
    this.input.reset();
  }

  /** Carros do jogador e perseguidores (luzes, clima, reflexos). */
  private get allCars(): Car[] {
    return [...this.cars, ...this.pursuers.all];
  }

  /** Polarização, território atual e o que os perseguidores fizeram neste frame. */
  private updateFactions(dt: number, driving: boolean, pursuit: readonly PursuitEvent[]): void {
    const p = this.car.position;
    this.polarization.update({
      dt,
      x: p.x,
      z: p.z,
      driving,
      kmh: this.car.speedKmh,
      horn: driving && this.input.isDown('KeyH'),
      passenger: this.rides.aboardFaction,
      chasing: (f) => this.pursuers.chasing(f),
    });
    // Entrou num território (só avisa na entrada).
    const here = this.polarization.territory;
    if (here && here !== this.territory) {
      const aboard = this.rides.aboardFaction;
      const name = t(FACTIONS[here.faction].nameKey);
      const hostile = aboard && aboard !== here.faction;
      this.showToast(hostile ? t('toast.territory.hostile', { faction: name, rival: t(FACTIONS[other(here.faction)].nameKey) }) : t('toast.territory.enter', { faction: name }), 3.5, 'info');
      this.rides.enteredTerritory(here.faction);
    }
    this.territory = here;

    for (const e of pursuit) {
      if (e.faction === 'imprensa') {
        this.handlePress(e.type);
        continue;
      }
      const name = t(FACTIONS[e.faction].nameKey);
      if (e.type === 'spawn') {
        this.dayChases++;
        this.showToast(t('toast.pursuit.start', { faction: name }), 3, 'error');
        this.rides.pursuitStarted();
      } else if (e.type === 'escape') {
        this.polarization.escaped(e.faction);
        this.showToast(t('toast.pursuit.escape', { faction: name }), 3, 'info');
        this.rides.pursuerEscaped();
      } else if (e.type === 'tomato') {
        this.car.dirt = Math.min(1, this.car.dirt + 0.04);
        this.rides.tomatoHit();
      } else if (e.type === 'ram') {
        // Só conta quando é o jogador que parte para cima (não quando apanha parado).
        if (this.car.speedKmh > POLARIZATION.hitMinKmh) this.polarization.hitFactionCar(e.faction);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Carreira (Fase 11)

  private lockedText(id: string, nameKey: Parameters<typeof t>[0]): string {
    return t('hud.prompt.locked', { name: t(nameKey), price: (CAR_PRICES[id] ?? 0).toLocaleString('pt-BR') });
  }

  /** Garagem deste jogador (null em níveis sem garagens). */
  private get myGarage(): GarageSlot | null {
    return this.world.level?.garages?.[this.garageIndex] ?? null;
  }

  /** Centro da garagem deste jogador (oficina, lavagem, imunidade). */
  private garageCenter(): { x: number; z: number } | null {
    return this.myGarage?.center ?? this.world.level?.addresses.find((a) => a.id === 'garagem') ?? null;
  }

  /**
   * Muda a garagem deste jogador (multiplayer: a que o servidor deu na sala). Os carros que estavam
   * estacionados na garagem antiga, e o Josué se estiver nela a pé, vão para a nova; a luz noturna vai junto.
   */
  private setGarage(index: number): void {
    const garages = this.world.level?.garages;
    if (!garages?.length) return;
    const next = Math.max(0, Math.min(index, garages.length - 1));
    if (next === this.garageIndex) return;
    const from = garages[this.garageIndex];
    const to = garages[next];
    this.garageIndex = next;
    const inside = (p: { x: number; z: number }) => Math.hypot(p.x - from.center.x, p.z - from.center.z) < 30;
    const driving = this.mode === 'driving';
    this.cars.forEach((c, i) => {
      if ((driving && c === this.car) || !inside(c.position)) return;
      const spot = to.fleet[i] ?? to.fleet[0];
      c.reset(spot.position, spot.yaw);
      c.update(1);
    });
    if (!driving && inside(this.localPlayer.position)) {
      this.localPlayer.teleport(to.spawn.x, to.spawn.y, to.spawn.z, to.spawnYaw);
      this.cameraRig.yaw = to.spawnYaw + Math.PI;
    }
    const light = from.lamp.getObjectByName('luz-garagem');
    if (light) to.lamp.add(light);
    Object.assign(this.safePlayer, { x: to.spawn.x, y: to.spawn.y, z: to.spawn.z, yaw: to.spawnYaw });
  }

  /** Perto da garagem deste jogador: a pé, ou parado dentro do carro. */
  private atWorkshop(): boolean {
    const garage = this.garageCenter();
    if (!garage) return false;
    const driving = this.mode === 'driving';
    const p = driving ? this.car.position : this.localPlayer.position;
    return Math.hypot(p.x - garage.x, p.z - garage.z) < 28 && (!driving || Math.abs(this.car.forwardSpeed) < 1);
  }

  /** Melhorias da Oficina em todos os carros da frota e no pagamento das multas. */
  private applyCareer(): void {
    const mods = this.career.carMods();
    for (const c of this.cars) c.setMods(mods);
    this.rides.penaltyMul = this.career.penaltyMul;
  }

  saveCareer(): void {
    const s = this.suspicion;
    this.career.save({
      money: this.rides.money,
      suspicion: { value: s.value, favorsAccepted: s.favorsAccepted, favorsDeclined: s.favorsDeclined, scandals: s.scandals },
    });
  }

  /** Expediente: começo, aviso de fim, hora extra e fechamento do dia; Oficina na tecla O. */
  private updateCareer(dt: number, driving: boolean): void {
    const c = this.career;
    this.rides.callsAllowed = c.started && !c.overtime;
    const ev: ShiftEvent | null = c.update(dt, driving, this.rides.rideInProgress, this.rides.money);
    if (ev === 'start') {
      this.showToast(t('shift.start', { day: c.day, goal: c.goal.toLocaleString('pt-BR') }), 4, 'info');
      this.saveCareer();
    } else if (ev === 'warn') this.showToast(t('shift.warning'), 3, 'error');
    else if (ev === 'overtime') this.showToast(t('shift.overtimeToast'), 4, 'info');
    else if (ev === 'end') this.endShift();
    if ((this.saveTimer -= dt) <= 0) {
      this.saveTimer = 30;
      this.saveCareer();
    }
    if (this.input.consumePressed('KeyO') && this.atWorkshop()) this.openModal('workshop');
  }

  private endShift(): void {
    const summary = this.career.closeDay(this.rides.money);
    this.rides.money = summary.balance;
    // Manchete do dia (Gazeta da Tesourinha) e, na campanha, o final (se chegou a hora).
    const kind = headlineKind({ ...summary.stats, chases: this.dayChases });
    const n = 1 + Math.floor(Math.random() * HEADLINE_VARIANTS);
    const news = { paper: t('news.paper'), title: t(`news.${kind}.${n}` as Parameters<typeof t>[0]) };
    if (!this.career.campaignDone) {
      const s = this.suspicion;
      this.pendingEnding = evaluateEnding(
        { warnings: this.career.warnings, scandals: s.scandals, favorsAccepted: s.favorsAccepted, favorsDeclined: s.favorsDeclined },
        SHIFT.maxWarnings,
        summary.day >= CAMPAIGN.days,
      );
      if (this.pendingEnding) {
        this.career.campaignDone = true;
        this.career.ending = this.pendingEnding;
      }
    }
    this.saveCareer();
    this.audio.play('uiConfirm');
    this.careerScreens.showSummary(summary, news);
    this.openModal('summary');
  }

  /** Começa o dia seguinte na garagem: frota no lugar e lavada, Josué ao lado, sem perseguições. */
  private startNextDay(): void {
    this.closeModal();
    const level = this.world.level!;
    if (this.mode === 'driving') {
      this.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.tryExitCar();
    }
    const home = this.myGarage;
    const spots = home?.fleet ?? level.fleetSpawns ?? [level.vehicleSpawn];
    this.cars.forEach((c, i) => {
      const spot = spots[i] ?? spots[0];
      c.reset(spot.position, spot.yaw);
      this.carEffects.repair(c);
    });
    const spawn = home?.spawn ?? level.spawn;
    const spawnYaw = home?.spawnYaw ?? level.spawnYaw;
    this.localPlayer.teleport(spawn.x, spawn.y, spawn.z, spawnYaw);
    this.cameraRig.yaw = spawnYaw + Math.PI;
    this.net.clearMyPursuers();
    this.polarization.reset();
    this.rides.resetForNewDay();
    this.dayChases = 0;
    this.saveCareer();
    if (this.pendingEnding) {
      const ending = this.pendingEnding;
      this.pendingEnding = null;
      this.showEnding(ending);
    } else if (!this.career.campaignDone) this.showChapter();
  }

  // ---------------------------------------------------------------------------
  // Campanha, menu principal e música (Fase 12)

  private showMainMenu(): void {
    const c = this.career;
    const saved = Career.exists();
    const buttons = [
      ...(saved ? [{ label: t('menu.continue', { day: c.day }), act: 'continue', primary: true }] : []),
      { label: t('menu.new'), act: 'new', primary: !saved },
      { label: t('menu.credits'), act: 'credits' },
      ...(desktop ? [{ label: t('menu.quit'), act: 'quit' }] : []),
    ];
    this.careerScreens.showCard({ title: t('game.title'), kicker: t('game.subtitle'), body: t('menu.subtitle'), buttons, cover: true });
    this.openModal('card');
    this.menuOrbit = this.menuOrbit ?? 0;
  }

  /** Capítulo do dia (antes do expediente começar). */
  private showChapter(): void {
    const day = this.career.day;
    const free = this.career.campaignDone || day > CAMPAIGN.days;
    this.careerScreens.showCard({
      kicker: free ? undefined : t('chapter.label', { day, total: CAMPAIGN.days }),
      title: t(free ? 'chapter.free.title' : (`chapter.${day}.title` as Parameters<typeof t>[0])),
      body: t(free ? 'chapter.free.body' : (`chapter.${day}.body` as Parameters<typeof t>[0])),
      footer: t('shift.goal', { done: '0', goal: this.career.goal.toLocaleString('pt-BR') }),
      buttons: [{ label: t('chapter.start'), act: 'start-day', primary: true }],
    });
    this.openModal('card');
  }

  private showEnding(id: EndingId): void {
    const s = this.suspicion;
    this.careerScreens.showCard({
      kicker: t('ending.label'),
      title: t(`ending.${id}.title`),
      body: `<div class="career-news"><div class="career-news-paper">${t('news.paper')}</div><div class="career-news-title">${t(`ending.${id}.headline`)}</div></div>${t(`ending.${id}.body`)}`,
      footer: t('ending.stats', {
        days: this.career.day - 1,
        rides: this.career.totals.rides,
        favors: s.favorsAccepted,
        declined: s.favorsDeclined,
        scandals: s.scandals,
        money: Math.round(this.rides.money).toLocaleString('pt-BR'),
      }),
      buttons: [
        { label: t('ending.free'), act: 'free', primary: true },
        { label: t('ending.new'), act: 'new-confirmed' },
      ],
    });
    this.openModal('card');
  }

  private cardAct(act: string): void {
    switch (act) {
      case 'continue':
        this.closeModal();
        if (!this.career.started && !this.career.campaignDone) this.showChapter();
        break;
      case 'new':
        if (!Career.exists() || window.confirm(t('menu.newConfirm'))) this.newGame();
        break;
      case 'new-confirmed':
        this.newGame();
        break;
      case 'credits':
        this.careerScreens.showCard({ title: t('credits.title'), body: t('credits.body'), buttons: [{ label: t('menu.back'), act: 'back', primary: true }] });
        break;
      case 'back':
        this.showMainMenu();
        break;
      case 'quit':
        this.saveCareer();
        desktop?.quit();
        break;
      default: // start-day, free
        this.closeModal();
    }
  }

  private toMainMenu(): void {
    this.saveCareer();
    this.setPaused(false);
    this.showMainMenu();
  }

  /** Menu principal: a câmera passeia devagar sobre a Esplanada. */
  private orbitCamera(dt: number): void {
    this.menuOrbit! += dt * 0.04;
    const a = this.menuOrbit!;
    const cx = 0;
    const cz = -420;
    const ground = this.groundAt(cx, cz);
    this.camera.position.set(cx + Math.cos(a) * 520, ground + 85, cz + Math.sin(a) * 520);
    this.camera.lookAt(cx, ground + 25, cz - 180);
    this.camera.fov = this.cfg.camera.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Trilha: tema no menu e nos cartões; rádio no carro; nada a pé. */
  private updateMusic(): void {
    if (this.modal === 'card') this.music.play('menu', 0.85);
    else if (this.mode === 'driving') this.music.playList(RADIO_PLAYLIST, 0.5);
    else if (this.music.track && this.modal !== 'summary' && this.modal !== 'workshop') this.music.stop();
  }

  private buyUpgrade(id: UpgradeId): void {
    const price = this.career.buyUpgrade(id, this.rides.money);
    if (price === null) return this.showToast(t('workshop.noMoney'), 1.6, 'error');
    this.rides.money -= price;
    this.applyCareer();
    this.afterPurchase(t(`upgrade.${id}`));
  }

  private buyCar(id: string): void {
    const price = this.career.buyCar(id, this.rides.money);
    if (price === null) return this.showToast(t('workshop.noMoney'), 1.6, 'error');
    this.rides.money -= price;
    const def = FLEET.find((d) => d.id === id);
    this.afterPurchase(def ? t(def.nameKey) : id);
  }

  private afterPurchase(name: string): void {
    this.audio.play('uiConfirm');
    this.showToast(t('workshop.bought', { name }), 2, 'info');
    this.saveCareer();
    this.careerScreens.showWorkshop(this.career, this.rides.money);
  }

  private openModal(kind: 'summary' | 'workshop' | 'card'): void {
    this.modal = kind;
    this.input.reset();
    this.input.exitPointerLock();
    this.audio.setDucked(true);
    if (kind === 'workshop') this.careerScreens.showWorkshop(this.career, this.rides.money);
  }

  private closeModal(): void {
    this.careerScreens.hideSummary();
    this.careerScreens.hideWorkshop();
    this.careerScreens.hideCard();
    this.menuOrbit = null;
    this.modal = null;
    this.accumulator = 0;
    this.input.reset();
    this.audio.setDucked(false);
    this.input.requestPointerLock();
  }

  /** Teclado nas telas da carreira: Enter continua o dia; Esc/O fecham a Oficina. */
  private modalInput(): void {
    const i = this.input;
    const enter = i.consumePressed('Enter') || i.consumePressed('NumpadEnter');
    if (this.modal === 'card' && enter) {
      const act = this.careerScreens.cardDefaultAct;
      if (act) this.cardAct(act);
    } else if (this.modal === 'summary' && enter) this.startNextDay();
    else if (this.modal === 'workshop' && (i.consumePressed('Escape') || i.consumePressed('KeyO'))) this.closeModal();
  }

  private refreshCareerTab(): void {
    const c = this.career;
    const s = this.suspicion;
    this.hud.pauseMenu.setCareer([
      t('career.day', { day: c.day }),
      t('career.balance', { value: Math.round(this.rides.money).toLocaleString('pt-BR') }),
      t('career.warnings', { n: c.warnings, max: SHIFT.maxWarnings }),
      t('career.stats', { rides: c.totals.rides, favors: s.favorsAccepted, declined: s.favorsDeclined, scandals: s.scandals }),
    ]);
  }

  private newGame(): void {
    window.removeEventListener('beforeunload', this.onUnload);
    Career.wipe();
    try {
      sessionStorage.setItem(NEW_GAME_FLAG, '1');
    } catch {
      /* sem storage: abre no menu principal */
    }
    location.reload();
  }

  /** Imprensa (Fase 9): avisos e fotos (que alimentam a suspeição). */
  private handlePress(type: PursuitEvent['type']): void {
    if (type === 'spawn') {
      this.showToast(t('toast.press.start'), 3.5, 'error');
    } else if (type === 'escape') {
      this.showToast(t('toast.press.escape'), 3, 'info');
    } else if (type === 'photo') {
      const favor = this.rides.favorAboard !== null;
      this.suspicion.photographed(favor, this.career.photoMul);
      this.rides.photographed();
      if (favor) this.showToast(t('toast.press.photo'), 1.5, 'error');
    }
  }

  /**
   * Suspeição (Fase 9): sobe com o favor em andamento, a maleta sacudida e as fotos; avisa perto do limite e,
   * cheia, vira escândalo (multa, maleta apreendida, manchete da Gazeta da Tesourinha).
   */
  private updateSuspicion(dt: number, carEvents: readonly CarEvent[]): void {
    const sus = this.suspicion;
    sus.update(dt, this.rides.activeFavor !== null);
    this.rides.favorsAllowed = sus.value < FAVORS.maxSuspicion;
    // Maleta a bordo + batida forte: abre e voa dinheiro (pastelão).
    if (this.rides.favorAboard === 'maleta' && carEvents.some((e) => e.type === 'impact' && e.strength > 5)) {
      sus.maletaShaken();
      const p = this.car.position;
      this.carEffects.burst({ x: p.x, y: p.y + 1.3, z: p.z }, 0x4caf50, 22);
      this.showToast(t('favor.maletaShaken'), 2, 'error');
    }
    const warned = sus.value >= 70;
    if (warned && !this.suspicionWarned) this.showToast(t('toast.suspicion.warning'), 4, 'error');
    this.suspicionWarned = warned;
    if (!sus.full) return;
    const fine = sus.scandal(this.rides.money);
    this.career.scandal();
    const maleta = this.rides.scandal(fine, SUSPICION.scandalQuiet);
    this.net.clearMyPursuers();
    this.audio.play('uiError');
    this.hud.showHeadline(t('scandal.paper'), t('scandal.headline'), t('scandal.sub', { fine: fine.toLocaleString('pt-BR'), maleta: maleta ? t('scandal.maleta') : '' }));
  }

  /** Hora/clima/feriado: visual e física a cada frame; HUD, corridas e avisos uma vez por segundo. */
  private updateEnvironment(dt: number): void {
    this.env.update(dt);
    const s = this.env.snapshot();
    this.atmosphere.update(dt, s, this.camera.position, this.allCars, this.carEffects, this.mode === 'driving');
    this.envTimer -= dt;
    if (this.envTimer > 0) return;
    this.envTimer = 1;
    const night = this.atmosphere.night > 0.5;
    this.rides.setConditions({ holiday: !!s.holiday, holidayEve: !!s.holidayEve, rain: s.weather.rain > 0, dry: s.dry, night });
    const w = s.weather;
    // Símbolos de texto (presentes nas fontes comuns; emoji colorido nem sempre existe no sistema).
    const icon = s.dry ? '☀' : { clear: night ? '☾' : '☀', partly: '☁', cloudy: '☁', fog: '≋', rain: '☂', storm: '⚡' }[w.kind];
    const label = t(s.dry ? 'env.weather.dry' : `env.weather.${w.kind}`);
    const text = s.live
      ? t('env.hud', { temp: Math.round(w.temperature), humidity: Math.round(w.humidity), clock: s.clock })
      : t('env.hud.offline', { clock: s.clock });
    const badge = s.holiday ? t('env.holidayBadge', { name: s.holiday.name }) : s.holidayEve ? t('env.holidayEveBadge', { name: s.holidayEve.name }) : null;
    this.envHud = { text: s.live ? `${icon} ${label} · ${text}` : `${icon} ${text}`, badge };
    this.announceEnvironment(s, night);
  }

  /** Avisa (uma vez por mudança) o que o mundo real trouxe: feriado, chuva, seca, noite. */
  private announceEnvironment(s: EnvSnapshot, night: boolean): void {
    const w = s.weather;
    const msg = s.holiday
      ? t('env.toast.holiday', { name: s.holiday.name })
      : s.holidayEve
        ? t('env.toast.holidayEve', { name: s.holidayEve.name })
        : w.kind === 'storm'
          ? t('env.toast.storm')
          : w.kind === 'rain'
            ? t('env.toast.rain')
            : w.kind === 'fog'
              ? t('env.toast.fog')
              : s.dry
                ? t('env.toast.dry', { humidity: Math.round(w.humidity) })
                : night
                  ? t('env.toast.night')
                  : '';
    if (msg === this.envKey) return;
    this.envKey = msg;
    if (msg) this.showToast(msg, 6, 'info');
  }

  /** Altura do chão (relevo) em (x, z). */
  groundAt(x: number, z: number): number {
    return this.world.level?.heightAt?.(x, z) ?? 0;
  }

  /** Afundou no lago (abaixo do nível da água dentro de uma área de água)? */
  private inWater(p: THREE.Vector3Like, margin = 0): boolean {
    return (this.world.level?.water ?? []).some(
      (w) => p.y < w.level + margin && p.x > w.minX && p.x < w.maxX && p.z > w.minZ && p.z < w.maxZ,
    );
  }

  /** Guarda posições seguras periodicamente e, ao afundar, devolve carro/Josué para a última. */
  private checkWater(dt: number): void {
    const driving = this.mode === 'driving';
    const car = this.car.position;
    const player = this.localPlayer.position;
    this.safeTimer += dt;
    if (this.safeTimer > 0.5) {
      this.safeTimer = 0;
      if (this.car.wheelsOnGround >= 3 && car.y > -0.2) Object.assign(this.safeCar, { x: car.x, y: this.groundAt(car.x, car.z), z: car.z, yaw: this.car.heading });
      const ms = this.localPlayer.state.moveState;
      if (!driving && ms !== 'jump' && ms !== 'fall' && player.y > -0.2) {
        Object.assign(this.safePlayer, { x: player.x, y: player.y, z: player.z, yaw: this.localPlayer.state.yaw });
      }
    }

    const sinking = driving ? this.inWater(car, 0.3) : this.inWater(player, 0.5);
    if (sinking && this.sinkTimer === 0) {
      this.audio.play('splash', { position: driving ? car : player });
      if (driving) this.frameSplashed = true;
    }
    this.sinkTimer = sinking ? this.sinkTimer + dt : 0;
    if (this.sinkTimer > 0.8) {
      this.sinkTimer = 0;
      if (driving) {
        this.car.reset(this.safeCar, this.safeCar.yaw);
        this.carEffects.splash(this.car);
      }
      else this.localPlayer.teleport(this.safePlayer.x, this.safePlayer.y, this.safePlayer.z, this.safePlayer.yaw);
      this.showToast(t(driving ? 'hud.splashCar' : 'hud.splashPlayer'), 2.4, 'info');
    }
    // Carro estacionado que caiu no lago sozinho (ex.: empurrado) também volta.
    if (!driving && this.inWater(car, 0.3)) this.car.reset(this.safeCar, this.safeCar.yaw);
  }

  /** Repassa o que aconteceu no frame para o sistema de corridas e posiciona a seta de direção. */
  private updateRides(dt: number, driving: boolean, carEvents: readonly CarEvent[]): void {
    const a = this.arrowAnchor;
    let scale = 1;
    if (driving && this.cockpit) {
      // À frente do para-brisa, na linha do olhar.
      this.car.model.eyes.getWorldPosition(a);
      const fwd = this.tmpProj.set(0, 0, 1).applyQuaternion(this.car.model.root.quaternion);
      a.addScaledVector(fwd, 3).y += 0.35;
      scale = 0.32;
    } else if (driving) {
      a.copy(this.car.position).y += 2.3;
    } else {
      a.set(this.localPlayer.position.x, this.localPlayer.position.y + 2.6, this.localPlayer.position.z);
      scale = 0.55;
    }
    this.rides.update({
      dt,
      driving,
      carPos: this.car.position,
      kmh: this.car.speedKmh,
      slip: this.car.slip,
      carEvents,
      propsBroken: this.framePropsBroken,
      splashed: this.frameSplashed,
      horn: driving && this.input.isDown('KeyH'),
      arrowAnchor: a,
      arrowScale: scale,
    });
    this.framePropsBroken = 0;
    this.frameSplashed = false;
  }

  /** Onde desenhar o balão do passageiro: acima do carro; no cockpit, no alto da tela. */
  private bubbleScreenPosition(): { x: number; y: number } | null {
    if (!this.rides.passengerAboard) return null;
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    if (this.mode === 'driving' && this.cockpit) return { x: w / 2, y: h * 0.2 };
    const p = this.tmpProj.copy(this.car.position);
    p.y += 2.0;
    p.project(this.camera);
    if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) return null;
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
  }

  /** Liga/desliga a câmera interna. O motorista some nela (a câmera fica onde está a cabeça dele). */
  private setCockpit(on: boolean): void {
    this.cockpit = on && this.mode === 'driving';
    if (this.driver) {
      // Na câmera interna o corpo continua (para ver as mãos no volante), só sem a cabeça.
      this.driver.visible = this.mode === 'driving';
      this.driver.headHidden = this.cockpit;
    }
    this.audio.setMuffled(this.mode === 'driving'); // continua abafado nas duas câmeras
    if (!this.cockpit) this.camera.fov = this.cfg.camera.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Parar o carro na garagem do jogador por um instante: a frota lava e desamassa. */
  private updateGarageService(dt: number): void {
    const garage = this.garageCenter();
    const p = this.car.position;
    const parked = garage && Math.hypot(p.x - garage.x, p.z - garage.z) < 26 && Math.abs(this.car.forwardSpeed) < 1;
    const needsService = this.car.dirt > 0.05 || this.car.damaged;
    this.serviceTimer = parked && needsService ? this.serviceTimer + dt : 0;
    // Imunidade do Tribunal: parado na garagem, a polarização zera e os perseguidores vão embora.
    this.immunityTimer = parked && this.mode === 'driving' ? this.immunityTimer + dt : 0;
    if (this.immunityTimer > 1.5) {
      this.immunityTimer = -Infinity; // uma vez por parada
      if (this.polarization.reset()) this.showToast(t('toast.garage.immunity'), 3, 'info');
    }
    if (this.serviceTimer > 1.5) {
      this.serviceTimer = 0;
      this.carEffects.repair(this.car);
      this.audio.play('uiConfirm');
      this.showToast(t('hud.garageService'), 2.6, 'info');
    }
  }

  private showToast(text: string, seconds = 1.6, kind: 'info' | 'error' = 'info'): void {
    // Não repete o som se a mesma mensagem ainda está na tela (ex.: E segurado).
    if (this.toast?.text !== text || performance.now() > this.toast.until) this.audio.play(kind === 'error' ? 'uiError' : 'uiNotify');
    this.toast = { text, until: performance.now() + seconds * 1000 };
  }

  /** Dica contextual do HUD: mensagem temporária ou "E — Entrar no carro" quando perto. */
  private currentPrompt(): { key?: string; text: string } | null {
    if (this.toast && performance.now() < this.toast.until) return { text: this.toast.text };
    this.toast = null;
    if (this.mode === 'onFoot' && !this.paused) {
      const car = this.nearbyCar();
      if (car?.def && !this.career.owns(car.def.id)) return { text: this.lockedText(car.def.id, car.def.nameKey) };
      if (car) return { key: 'E', text: car.def ? t('hud.prompt.enterNamed', { name: t(car.def.nameKey) }) : t('hud.prompt.enterCar') };
    }
    if (!this.paused && this.atWorkshop()) return { key: 'O', text: t('hud.prompt.workshop') };
    return null;
  }

  private readCarControls(): void {
    const i = this.input;
    const c = this.carControls;
    c.throttle = (i.isDown('KeyW') || i.isDown('ArrowUp') ? 1 : 0) - (i.isDown('KeyS') || i.isDown('ArrowDown') ? 1 : 0);
    c.steer = (i.isDown('KeyA') || i.isDown('ArrowLeft') ? 1 : 0) - (i.isDown('KeyD') || i.isDown('ArrowRight') ? 1 : 0);
    c.handbrake = i.isDown('Space');
    c.turbo = i.isDown('ShiftLeft') || i.isDown('ShiftRight');
  }

  /** WASD relativo à câmera → direção no mundo. */
  private readMoveIntent(): void {
    const i = this.input;
    const fwd = (i.isDown('KeyW') || i.isDown('ArrowUp') ? 1 : 0) - (i.isDown('KeyS') || i.isDown('ArrowDown') ? 1 : 0);
    const right = (i.isDown('KeyD') || i.isDown('ArrowRight') ? 1 : 0) - (i.isDown('KeyA') || i.isDown('ArrowLeft') ? 1 : 0);

    const f = this.cameraRig.forward(this.tmpForward);
    // right = (-f.z, 0, f.x) para f no plano XZ
    let x = f.x * fwd - f.z * right;
    let z = f.z * fwd + f.x * right;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    this.intent.x = x;
    this.intent.z = z;
    this.intent.run = i.isDown('ShiftLeft') || i.isDown('ShiftRight');
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
}

/** Escolhe a fonte do cenário. Só este ponto conhece os geradores procedurais. */
async function loadLevel(assets: Assets, source: string, onProgress: (f: number) => void): Promise<Level> {
  if (source === 'cidade' || source === 'test') {
    onProgress(0);
    await nextFrame(); // deixa a tela de carregamento atualizar antes da geração (síncrona)
    return source === 'cidade' ? createCity() : createTestArena();
  }
  return levelFromGLTF(await assets.loadGLTF(source, onProgress));
}
