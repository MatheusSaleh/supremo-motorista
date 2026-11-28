// Constantes ajustáveis do jogo. Unidades: metros, segundos, radianos.
// O objeto é mutável de propósito: o painel de debug (lil-gui) edita os valores em tempo real.

export const config = {
  physics: {
    fixedStep: 1 / 60,
    maxSubSteps: 5, // evita "espiral da morte" quando o frame demora demais
    gravity: 22, // maior que 9.81 para o pulo não parecer flutuante
  },

  player: {
    radius: 0.35,
    halfHeight: 0.55, // metade do segmento cilíndrico da cápsula (altura total = 2*(halfHeight+radius) = 1.8 m)
    walkSpeed: 3.5,
    runSpeed: 7.5,
    jumpHeight: 1.3,
    groundAccel: 14, // taxa de convergência para a velocidade alvo (1/s)
    airAccel: 3,
    turnSpeed: 12, // taxa de rotação do corpo para a direção do movimento (1/s)
    coyoteTime: 0.12, // ainda pode pular logo após sair de uma borda
    jumpBuffer: 0.15, // aceita o Espaço um pouco antes de tocar o chão
    controllerOffset: 0.02,
    maxSlopeDeg: 50,
    autostepHeight: 0.4,
    snapToGround: 0.3,
  },

  character: {
    // Caminho relativo a public/. Executivo de terno (esqueleto Mixamo; clips montados na conversão).
    url: 'models/characters/executivo.glb',
    /** Fase 12+: modelos extras de passageiro (mesmo esqueleto Mixamo e clips), para variar os rostos. */
    passengerUrls: ['models/characters/passageiro-eric.glb'] as string[],
    // Nome (ou parte do nome, sem diferenciar maiúsculas) de cada animação no .glb. '' = não existe.
    clips: { idle: 'Idle', walk: 'Walking', run: 'Running', jump: 'Jump', fall: '' },
    /** Rotação extra caso o modelo não olhe para +Z (ex.: Math.PI). */
    yawOffset: 0,
    /** Altura do modelo em metros; null = mesma altura da cápsula de colisão. */
    height: null as number | null,
    fadeTime: 0.2,
    // Velocidade (m/s) em que os clips de andar/correr ficam naturais com timeScale = 1.
    walkClipSpeed: 2.0,
    runClipSpeed: 4.6,
    jumpClipOffset: 0.1, // pula o início do clip (agachamento) para o salto parecer imediato
    airDelay: 0.15, // tempo no ar antes de tocar a animação de queda
    sitClip: 'Sitting', // pose do motorista ao volante
    // Ossos dos braços para a IK das mãos no volante.
    armBones: {
      left: { upper: 'mixamorigLeftArm', lower: 'mixamorigLeftForeArm', end: 'mixamorigLeftHand' },
      right: { upper: 'mixamorigRightArm', lower: 'mixamorigRightForeArm', end: 'mixamorigRightHand' },
    },
    waveClip: 'Wave',
    footBones: { left: 'mixamorigLeftFoot', right: 'mixamorigRightFoot' },
    fingertips: {
      left: { index: 'mixamorigLeftHandIndex4', middle: 'mixamorigLeftHandMiddle4', pinky: 'mixamorigLeftHandPinky4' },
      right: { index: 'mixamorigRightHandIndex4', middle: 'mixamorigRightHandMiddle4', pinky: 'mixamorigRightHandPinky4' },
    },
    spineBone: 'mixamorigSpine',
    hipsBone: 'mixamorigHips',
    chestBone: 'mixamorigSpine2',
    headBone: 'mixamorigHead',
    driverScale: 1,
  },

  // Carro oficial (Rapier DynamicRayCastVehicleController). Forças em newtons, velocidades em m/s.
  car: {
    mass: 1300,
    centerOfMassY: -0.3, // abaixo do centro do chassi: muito mais difícil de capotar
    wheelRadius: 0.36,
    suspensionRest: 0.32,
    suspensionStiffness: 32,
    suspensionCompression: 2.6,
    suspensionRelaxation: 3.2,
    maxSuspensionTravel: 0.3,
    engineForce: 2600, // por roda (tração nas 4)
    reverseForceFactor: 0.6,
    maxSpeed: 36, // ~130 km/h
    reverseMaxSpeed: 9,
    brakeForce: 55,
    rollingBrake: 4, // freio-motor ao soltar o acelerador
    maxSteer: 0.6, // rad, parado/manobrando
    steerFalloffSpeed: 9, // m/s em que o esterço máximo cai pela metade
    steerAtMaxSpeed: 0.06, // rad, piso do esterço em alta velocidade
    steerSpeed: 8, // suavização do volante (1/s)
    frictionSlip: 3.2,
    sideFriction: 1.0,
    // Drift: freio de mão trava as rodas traseiras e reduz a aderência lateral delas.
    handbrakeForce: 10,
    driftRearSideFriction: 0.08,
    driftMaxAngle: 0.7, // rad (~40°) de deriva com esterço total
    driftSlipGain: 4, // quão rápido busca o ângulo de deriva (1/s)
    driftYawAssist: 6, // rad/s² máximos do torque de ajuda
    driftSpeedAssist: 9, // m/s² de empurrão ao acelerar durante o drift
    gripRecovery: 3, // velocidade de volta da aderência após o drift (1/s)
    downforce: 1.6, // N por (m/s)², mantém o carro colado em alta velocidade
    airControl: 3.0, // rad/s² de rotação no ar (A/D gira, W/S inclina)
    turbo: { forceMul: 1.9, maxSpeedMul: 1.35, drainPerSec: 0.4, rechargePerSec: 0.12, minToStart: 0.15 },
    flipResetDelay: 2, // segundos de cabeça para baixo (ou de lado) até desvirar sozinho
    // Fora do asfalto (grama/terra): menos aderência, mais arrasto e velocidade máxima menor.
    offroad: { grip: 0.7, maxSpeedMul: 0.65, drag: 1.2 },
    cornerDrag: 0.07, // perda de velocidade (1/s) com esterço total, proporcional à velocidade
  },

  camera: {
    fov: 60,
    near: 0.1,
    far: 3200, // a neblina esconde tudo além de ~2,6 km
    distance: 6,
    minDistance: 2,
    maxDistance: 18,
    pitch: 0.35,
    minPitch: -0.3,
    maxPitch: 1.35,
    targetHeight: 1.5, // altura (acima dos pés) para onde a câmera olha
    mouseSensitivity: 0.0025,
    zoomSensitivity: 0.004,
    followDamping: 14, // suavização da posição seguida (1/s)
    zoomDamping: 10,
    collisionPadding: 0.25,
    usePointerLock: true,
    cockpitFov: 72,
    cockpitPitch: -0.2, // rad (negativo = olhar para baixo)
    // Modo perseguição (dirigindo).
    chase: {
      distance: 7,
      distancePerSpeed: 0.09, // afasta com a velocidade (m por m/s)
      maxDistance: 11,
      pitch: 0.22,
      targetHeight: 1.3,
      yawDamping: 4, // velocidade com que volta para trás do carro
      freeLookTime: 1.2, // s sem mexer o mouse até a câmera voltar para trás do carro
      fovBoost: 12, // graus extras em velocidade máxima
    },
  },

  // Sombras on/off, resolução e tamanho do shadow map ficam em Settings (menu de pausa).
  render: {
    shadowRange: 70, // meia-largura (m) da área de sombra que acompanha o jogador
  },

  world: {
    skyTop: 0x3d7fd6,
    skyBottom: 0xcfe3f2,
    /** 'cidade' (procedural, world/city), 'test' (arena da Fase 1) ou caminho de um .glb em public/. */
    level: 'cidade' as string,
    fogNear: 250,
    fogFar: 2600, // o Congresso continua visível da Rodoviária (~1,9 km)
    sunDirection: { x: -0.5, y: 0.8, z: 0.35 },
  },

  // Multiplayer (modo livre): ver docs/MULTIPLAYER.md. VITE_MP_URL troca o servidor no build.
  multiplayer: {
    /**
     * Opção "Online" disponível: sempre em dev; no build de produção só com VITE_MP_ENABLED=true (ligar
     * na Vercel depois que o servidor estiver no ar, senão o jogador só veria "servidor indisponível").
     */
    enabled: import.meta.env.DEV || import.meta.env.VITE_MP_ENABLED === 'true',
    // Em dev, o servidor local no mesmo endereço da página (funciona também de outro PC da rede).
    url: (import.meta.env.VITE_MP_URL as string | undefined) ?? (import.meta.env.DEV ? `ws://${location.hostname}:8787` : 'wss://mp.matheussaleh.com.br'),
    /** Atraso (s) com que os outros jogadores são desenhados: dá margem para interpolar entre pacotes. */
    interpDelay: 0.1,
    /** Por quanto tempo (s) um carro remoto é projetado para frente quando os pacotes atrasam. */
    maxExtrapolation: 0.25,
    /** Espera (s) entre tentativas de reconexão: começa curta e dobra até o máximo. */
    reconnectMin: 2,
    reconnectMax: 30,
  },
};

export type Config = typeof config;
