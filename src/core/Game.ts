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
import { loadCarAsset, type CarAsset } from '../vehicle/CarVisual';
import { DEFAULT_VEHICLE, FLEET, type VehicleDef } from '../data/vehicles';
import { Atmosphere } from '../env/Atmosphere';
import { Environment, type EnvSnapshot } from '../env/Environment';
import { FACTIONS, MAX_PURSUERS, POLARIZATION, PURSUER_MODELS, TERRITORIES, other, type Territory } from '../data/factions';
import { Polarization } from '../factions/Polarization';
import { Pursuers, type PursuitEvent } from '../factions/Pursuers';
import { Suspicion } from '../factions/Suspicion';
import { FAVORS, SUSPICION } from '../data/banker';
import { RoadGraph } from '../world/RoadGraph';
import { SeatedDriver } from '../player/SeatedDriver';
import { World } from '../world/World';
import { createCity } from '../world/city';
import { levelFromGLTF, type Level } from '../world/Level';
import { createTestArena } from '../world/testArena';
import { Assets } from './Assets';
import { installBVH } from './bvh';
import { t } from './i18n';
import { Input } from './Input';
import { ProgressTracker, nextFrame, type ProgressCallback } from './progress';
import { loadSettings, saveSettings, type Settings } from './Settings';

export type PlayMode = 'onFoot' | 'driving';

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
    const [, character, level, , carAssets, pursuerAssets] = await Promise.all([
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
      // Frota: um .glb por carro (em paralelo). Falha num modelo → aquele carro usa o sedã procedural.
      (async () => {
        let done = 0;
        const list = await Promise.all(
          FLEET.map((def) =>
            // Qualidade Baixa/Média: modelos leves.
            loadCarAsset(assets, lowQuality ? def.model.lq : def.model.hq)
              .catch((err: unknown) => {
                console.warn(`[game] falha ao carregar o modelo de ${def.id}; usando o sedã procedural.`, err);
                return null;
              })
              .finally(() => progress.set('vehicle', ++done / FLEET.length, t('loading.vehicle'))),
          ),
        );
        return new Map(FLEET.map((def, i) => [def.id, list[i]] as const));
      })(),
      // Perseguidores: sempre os modelos leves da frota (na qualidade Baixa/Média, os mesmos já carregados).
      lowQuality
        ? Promise.resolve(null)
        : Promise.all(
            PURSUER_MODELS.map((id) => {
              const def = FLEET.find((d) => d.id === id);
              return def ? loadCarAsset(assets, def.model.lq).catch(() => null) : Promise.resolve(null);
            }),
          ),
    ]);

    progress.set('build', 0, t('loading.colliders'));
    await nextFrame();
    const game = new Game(
      container,
      hudRoot,
      cfg,
      assets,
      character,
      level,
      audio,
      carAssets,
      pursuerAssets ?? PURSUER_MODELS.map((id) => carAssets.get(id) ?? null),
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
    this.driver = character ? new SeatedDriver(character, cfg) : null;
    if (this.driver) this.car.model.seat.add(this.driver.root);
    for (const c of this.cars) this.world.scene.add(c.model.root);

    const touch = isTouchDevice();
    this.input = new Input(this.renderer.domElement, c.usePointerLock && !touch);
    this.input.onPointerLockChange = (locked) => {
      // O navegador solta o pointer lock ao apertar Esc: tratamos como pausa.
      if (!locked && !this.paused) this.setPaused(true);
    };
    this.cameraRig = new CameraRig(this.camera, cfg, () => this.world.cameraColliders);
    this.cameraRig.yaw = level.spawnYaw + Math.PI; // começa atrás do jogador

    this.hud = new Hud(
      hudRoot,
      level,
      this.settings,
      { onResume: () => this.setPaused(false), onChange: (s) => this.applySettings(s) },
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
    this.rides = new RideManager(level, this.world.scene, this.car.model.rearSeat, character, cfg, {
      sound: (id) => audio.play(id),
      toast: (text) => this.showToast(text, 3, 'info'),
      delivered: (f) => this.polarization.delivered(f),
      favorAccepted: () => this.suspicion.accepted(),
      favorDeclined: () => this.suspicion.declined(),
      finished: ({ favor, toBank }) => {
        if (favor) this.suspicion.deliveredFavor();
        else this.suspicion.cleanRide();
        if (toBank && !favor) this.suspicion.cafezinho();
      },
    });
    this.rides.setVehicle(this.car);

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
    } else {
      this.accumulator = 0;
      // Chamado a partir de um clique/tecla (gesto do usuário); se falhar, arrastar ou clicar ainda funciona.
      this.input.requestPointerLock();
    }
  }

  applySettings(s: Settings): void {
    this.settings = s;
    saveSettings(s);
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
    if (this.input.consumePressed('Escape')) {
      if (!this.paused) this.setPaused(true);
      else if (performance.now() - this.pausedAt > 250) this.setPaused(false);
    }

    if (!this.paused) this.simulate(dt);
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
      others: this.pursuers.actors(),
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

    // Perseguidores decidem (com as posições do frame anterior) antes da física.
    const pursuit = this.pursuers.think(dt, this.car, this.polarization, this.camera, MAX_PURSUERS[this.settings.quality], this.suspicion.wantedPress());

    // 2) Física em passo fixo
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
        this.showToast(t('toast.pursuit.start', { faction: name }), 3, 'error');
        this.rides.pursuitStarted();
      } else if (e.type === 'escape') {
        this.polarization.escaped(e.faction);
        this.showToast(t('toast.pursuit.escape', { faction: name }), 3, 'info');
        this.rides.pursuerEscaped();
      } else if (e.type === 'tomato') {
        this.rides.tomatoHit();
      } else if (e.type === 'ram') {
        // Só conta quando é o jogador que parte para cima (não quando apanha parado).
        if (this.car.speedKmh > POLARIZATION.hitMinKmh) this.polarization.hitFactionCar(e.faction);
      }
    }
  }

  /** Imprensa (Fase 9): avisos e fotos (que alimentam a suspeição). */
  private handlePress(type: PursuitEvent['type']): void {
    if (type === 'spawn') {
      this.showToast(t('toast.press.start'), 3.5, 'error');
    } else if (type === 'escape') {
      this.showToast(t('toast.press.escape'), 3, 'info');
    } else if (type === 'photo') {
      const favor = this.rides.favorAboard !== null;
      this.suspicion.photographed(favor);
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
    const maleta = this.rides.scandal(fine, SUSPICION.scandalQuiet);
    this.pursuers.clear();
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

  /** Parar o carro na garagem do Tribunal por um instante: a frota lava e desamassa. */
  private updateGarageService(dt: number): void {
    const garage = this.world.level?.addresses.find((a) => a.id === 'garagem');
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
      if (car) return { key: 'E', text: car.def ? t('hud.prompt.enterNamed', { name: t(car.def.nameKey) }) : t('hud.prompt.enterCar') };
    }
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
