# Arquitetura

Visão geral de como o jogo está organizado e das convenções que o código segue. Para o que já foi feito e o
que falta, veja [ROADMAP.md](ROADMAP.md).

## Princípios

- **three.js puro, sem framework de jogo.** Cada sistema é uma classe pequena que o `Game` atualiza na ordem
  certa.
- **Física em passo fixo** (`config.physics.fixedStep`, 60 Hz), com interpolação no visual. O tempo de frame é
  limitado a 0,1 s e no máximo 5 passos por frame, para evitar a "espiral da morte".
- **Dados separados do código.** Textos ficam em `src/data/i18n/` e dados de jogo (frota, corridas,
  endereços) em `src/data/`. Constantes ajustáveis ficam em `src/config.ts`, que o painel de debug edita
  ao vivo.
- **Nenhuma recompilação de shader depois do carregamento.** Luzes e efeitos que podem aparecer depois
  (farol, chuva, brilhos noturnos) são criados no início e só mudam de intensidade ou visibilidade. Mudar o
  número de luzes ou ligar/desligar sombras de uma luz recompila todos os materiais e causa travada.

## Loop principal (`src/core/Game.ts`)

`Game.create()` carrega em paralelo o Rapier, o personagem, o cenário, os sons e os cinco carros (com
progresso real na tela de carregamento). Em seguida monta a cena e compila os shaders com
`renderer.compileAsync` antes do primeiro frame.

A cada frame (`frame()`):
1. **Pausa:** Esc alterna a pausa.
2. **Simulação** (`simulate`), se não estiver pausado:
   1. input;
   2. física em passo fixo: jogador ou carros, `physics.step` e eventos de props quebrados;
   3. água e piso: lago e grama × asfalto;
   4. efeitos e som do carro;
   5. IK das mãos no volante;
   6. serviço da garagem;
   7. interpolação visual;
   8. corridas;
   9. câmera.
3. **Áudio ambiente e ambiente real** (`updateEnvironment`): hora, clima e feriado aplicados ao visual e à
   física. HUD, corridas e avisos são atualizados uma vez por segundo.
4. `world.update`: sombra e céu seguem o jogador e a câmera; distância de desenho.
5. HUD e render.

## Física e colisão

- **Rapier** (`@dimforge/rapier3d-compat`): o jogador é um `KinematicCharacterController` com cápsula, e os
  carros são um `DynamicRayCastVehicleController` com um cuboide de chassi e outro de cabine.
- **Grupos de colisão** (`src/core/collisionGroups.ts`): CAR, PROP, PROP_SENSOR, DEBRIS e PLAYER. Props
  quebráveis têm um colisor sólido (bloqueia o jogador) e um sensor (detecta o carro); ao serem atingidos
  viram destroços dinâmicos (`src/world/Breakables.ts`).
- **Colisores automáticos:** o `World` percorre as malhas do nível e cria os colisores:
  - `BoxGeometry` vira cuboide (dividido em blocos de até 200 m, porque cuboides de quilômetros afundam por
    imprecisão);
  - o resto vira trimesh, ou casco convexo/cilindro conforme o `userData`.

### Convenções de `userData` nas malhas do cenário

| Chave | Efeito |
|---|---|
| `noCollision: true` | sem colisor (e a câmera atravessa) |
| `cameraIgnore: true` | colide, mas a câmera atravessa (troncos finos) |
| `collider: 'convex' \| 'pole'` | casco convexo / cilindro vertical (`poleRadius`) |
| `surface: 'grass' \| 'asphalt' \| 'wood' \| 'concrete'` | piso: som dos passos, aderência do carro |
| `breakKind` + `breakIds` / `breakId` | prop quebrável (poste, árvore, placa) |
| `cullDistance: m` | some além dessa distância × qualidade |
| `noBatch: true` | não entra no agrupamento de malhas estáticas |
| `noDrape: true` | não acompanha o relevo (água, fundo do lago) |
| `drape: 'deform'` | força deformar pelo relevo mesmo sendo pequeno |

Nos **materiais**, `env/Atmosphere` lê estes marcadores:

| Chave | Efeito |
|---|---|
| `wetRoad: true` | escurece e fica liso com chuva |
| `nightGlow: n` | janelas acendem à noite (intensidade máxima `n`) |
| `lampGlow: n` | luminária dos postes acende (`emissiveMap` com metade acesa) |

## Cenário

### Contrato `Level` (`src/world/Level.ts`)

O resto do jogo só conhece um `Level`, que traz:
- a raiz da cena;
- o spawn do jogador e as vagas da frota;
- os pontos de interesse e os limites do mapa;
- os endereços das corridas;
- as áreas de água;
- `heightAt(x, z)`, a altura do relevo.

Existem três fontes de `Level`:
- o gerador procedural (`createCity`);
- a arena de teste (`config.world.level = 'test'`);
- um `.glb` qualquer (`levelFromGLTF`, seguindo as convenções descritas no arquivo).

### Gerador da cidade (`src/world/city/`)

| Arquivo | Conteúdo |
|---|---|
| `layout.ts` | todas as coordenadas (fonte única). Eixos: −Z leste, +Z oeste, −X norte, +X sul |
| `builder.ts` | `CityBuilder`: materiais, áreas ocupadas, pistas, endereços, placas e utilitários |
| `esplanada.ts`, `praca.ts`, `lago.ts`, `eixao.ts`, `aeroporto.ts`, `marcos.ts`, `ponte.ts` | uma região cada |
| `props.ts` | árvores, postes e placas (instanciados em blocos, quebráveis) |
| `materials.ts` | materiais e texturas desenhadas em canvas |
| `terrain.ts` + `terrainData.ts` | relevo real (ver abaixo) |
| `drape.ts` | "assenta" a cidade, gerada no plano, sobre o relevo |

### Relevo

`scripts/fetch-terrain.mjs` (rodado com `npm run terrain`, só em desenvolvimento) converte cada ponto do mapa
em latitude/longitude reais e baixa a elevação numa grade de 100 m. Como o mapa é condensado, a conversão
usa uma transformação afim ajustada a marcos conhecidos, mais correção local dos resíduos.

Em `terrain.ts`, os dados passam por estes ajustes:
- **Suavização:** o modelo de elevação inclui prédios e árvores; o jogo só quer o relevo.
- **Nível base:** perto da Praça (1032 m) vira y = 0.
- **Escala vertical:** limita a inclinação típica (percentil 90) a 6%; hoje ela fica em 0,91 do relevo real.
- **Margem do lago:** zera na água e sobe suavemente a partir da margem.
- **Áreas planas:** sob a garagem, os palácios e a Praça, com 30 m de folga antes da transição.

`drape.ts` aplica o relevo ao cenário já gerado:
- objetos de até 32 m sobem inteiros, pela altura mais baixa sob eles;
- malhas maiores são subdivididas (arestas de até 24 m) e deformadas;
- instâncias (árvores, postes) sobem cada uma pela altura do seu ponto.

### World (`src/world/World.ts`)

- Céu (esfera com degradê), neblina, sol direcional com sombra que segue o jogador (alinhada aos texels para
  não tremer) e luz hemisférica.
- `setLighting` e `setSunDirection` são usados pelo ambiente.
- Agrupamento de malhas estáticas por material e região (menos draw calls) e culling por distância.
- Consulta do piso sob um ponto (`surfaceAt`) para passos e aderência.

## Veículos (`src/vehicle/`, `src/data/vehicles.ts`)

- **`FLEET`:** cada `VehicleDef` traz:
  - modelo detalhado (`hq`) e leve (`lq`), escolhido pela qualidade gráfica ao carregar;
  - cor da pintura;
  - ajustes de física sobre `config.car`;
  - som do motor;
  - multiplicador de gorjeta e falas próprias.
- **`vehicleParams`:** cria os parâmetros com `Object.create(config.car)`, então os ajustes feitos ao vivo no
  painel de debug continuam valendo para todos os carros.
- **`CarVisual.ts`:** mede o `.glb` (nós `body` e `wheel-front-left`, `wheel-front-right`, `wheel-rear-left`,
  `wheel-rear-right`) e deriva a geometria física: rodas, raio, chassi e cabine.
  - Materiais com nome conhecido recebem tratamento especial: `paint` (pintura, sujeira), `glass` (vidro
    translúcido), `taillight` (luz de freio), `headlight` (acende à noite), `black` e `tire`.
  - Os amassados deformam os vértices perto do ponto de impacto.
- **`carInterior.ts`:** interior procedural (painel, volante, mostradores, bancos), escalado para cada carro,
  com âncoras de banco, olhos e pegadas do volante.
- **`Car.ts`:** controlador de veículo do Rapier mais as ajudas de arcade. `weatherGrip` reduz a aderência
  com a pista molhada.
- **`CarEffects.ts`:** fumaça, poeira, spray de chuva, sujeira e amassados, num único `THREE.Points`.

## Personagens (`src/player/`)

- **`CharacterAsset.ts`:** carrega o `.glb` do personagem uma vez, normaliza a altura para a cápsula e
  centraliza. Os clips são buscados pelo nome definido em `config.character.clips`.
- **`Player.ts` e `PlayerState.ts`:** física e estado do jogador. **`Avatar.ts` e `PlayerAnimator.ts`:**
  visual e transições de animação.
- **`SeatedDriver.ts`:** clone sentado (pose `Sitting`) com IK de dois ossos levando as mãos às pegadas do
  volante. É usado pelo motorista e pelo passageiro do banco de trás.
- **`outfit.ts`:** visuais dos passageiros (cor do terno e tom de pele multiplicando as texturas).

O modelo `executivo.glb` usa esqueleto Mixamo (`mixamorigHips`…). As animações e o processo de montagem estão
em [ASSETS.md](ASSETS.md).

## Corridas (`src/rides/`, `src/data/rides.ts`)

- **Fases do `RideManager`:** `idle → offered → toPickup → toDropoff → result`.
- **`RIDES`:** modelos de corrida com pools de endereço de origem e destino, motivo e peso. Os endereços vêm
  do `Level`.
- **Tabelas de ajuste:** `PAYMENT` (valores do pagamento) e `RIDE_TIMING` (tempos e raios).
- **`RideConditions`:** clima, noite e feriado reais mudam pesos, tempo, pagamento e falas.
- **Falas:** `LINE_COUNTS` diz quantas variações existem de cada gatilho. Os textos ficam em
  `pt-BR.rides.ts` e `pt-BR.environment.ts`.
- **`RideVisuals.ts`:** farol do ponto, seta 3D e o passageiro acenando.

## Facções e perseguidores (`src/factions/`, `src/data/factions.ts`, `src/world/RoadGraph.ts`)

- **`data/factions.ts`:** facções (cores), territórios (retângulos no mapa), regras da polarização
  (`POLARIZATION`), comportamento dos perseguidores (`PURSUIT`), limite por qualidade (`MAX_PURSUERS`) e os
  modelos da frota usados por eles.
- **`RoadGraph`:** grafo das ruas, montado dos eixos das pistas que o `CityBuilder` registra
  (`roadSegments`, mais `navLink` para viadutos e a ponte). Divide nos cruzamentos e nos "T" e em trechos de
  até 100 m. `path()` é um A*.
- **`Polarization`:** calor por facção. Recebe a situação a cada frame e eventos (props derrubados, batidas,
  entregas, fugas).
- **`Pursuers`:** pool de carros criado no carregamento (corpos desligados e invisíveis fora de cena; a
  pintura troca com `CarModel.setPaint`). `think()` roda antes da física: decide quem entra ou sai e
  calcula os controles de cada carro (rota pelo grafo longe; direto no alvo perto). Os tomates são
  projéteis visuais com estouro de partículas.
- O pool é mostrado durante o `compileAsync` do carregamento, para os materiais já estarem compilados no
  primeiro surgimento.

## Banqueiro e suspeição (`src/data/banker.ts`, `src/factions/Suspicion.ts`)

- **Favores:** são `RideTemplate`s com `favor: 'carona' | 'maleta'`. O `RideManager` sorteia se a próxima
  oferta é um favor (`FAVORS.callChance`, bloqueado acima de `FAVORS.maxSuspicion`). O Dr. Caixeta é um
  `Passenger` que só aparece nos favores. As falas dele (`CAIXETA_LINES`) e as da maleta (`MALETA_LINES`)
  substituem as comuns.
- **`Suspicion`:** guarda o medidor e o histórico. O `Game` alimenta pelos ganchos do `RideManager`
  (`favorAccepted`, `favorDeclined`, `finished`), pelas fotos da imprensa e pelas batidas com a maleta.
- **Imprensa:** é um "lado" do pool de `Pursuers` (`PursuerSide = FactionId | 'imprensa'`), com prioridade
  nas vagas. `think()` recebe quantos carros da imprensa a suspeição pede.
- **Ternos claros:** `Look.fabric` recolore o tecido escuro da textura (cache por textura e cor). Trocar
  `map` por outra textura não recompila o shader.

## Arquétipos (`src/rides/Quirk.ts`, `src/data/archetypes.ts`)

- Cada corrida tem um `Quirk`, criado pelo arquétipo do passageiro. O `RideManager` repassa eventos (salto,
  batida, início de derrapagem, buzina, foto) e chama `update` a cada frame. O `Quirk` fala pelo `say`
  recebido (com duração opcional do balão) e devolve um status para o painel e linhas extras para a conta.
- A parada do Palestrante é do `RideManager` (`ActiveRide.stop`): é escolhida no chamado, entre os endereços
  com menor desvio, e vira o alvo até ser cumprida.
- Regras e valores ficam em `ARCHETYPE_RULES`; as áreas movimentadas, em `BUSY_AREAS`.

## Carreira (`src/career/Career.ts`, `src/data/career.ts`, `src/hud/CareerScreens.ts`)

- **`Career`:** dia, advertências, melhorias, carros comprados, totais e o expediente atual (tempo, hora
  extra, dinheiro no início do dia, estatísticas). Salva e carrega no `localStorage` (`supremo.save.v1`); o
  dinheiro e a suspeição entram pelo `SaveExtras`.
  - `update()` devolve os eventos do expediente (`start`, `warn`, `overtime`, `end`).
  - `closeDay()` monta o contracheque e passa para o dia seguinte.
  - O faturamento do dia é o dinheiro atual menos `dayStartMoney`. Compras e dinheiro de debug movem essa
    referência (`adjustBaseline`), para não contar na meta.
- **Melhorias:** viram multiplicadores (`carMods()`) aplicados por `Car.setMods`, mais o seguro
  (`RideManager.penaltyMul`) e a película (fator das fotos na suspeição).
- **Telas no `Game`:** o contracheque e a Oficina são "modais". Com um aberto, a simulação para, o pointer
  lock é solto sem abrir o menu de pausa e o teclado vai para `modalInput()`.

## Campanha, menus e música (`src/data/campaign.ts`, `src/audio/Music.ts`)

- `evaluateEnding()` decide o final no fechamento de cada dia (demissão a qualquer momento; sócio ou
  exemplar no último dia). `headlineKind()` escolhe a manchete pelos números do dia. O `Career` guarda
  `campaignDone` e `ending`.
- Menu principal, capítulos, créditos e finais são "cartões" (`CareerScreens.showCard`): um modal com
  botões que devolvem uma ação (`Game.cardAct`). Enter aciona o primeiro botão.
- **Menu principal:** a câmera orbita a Esplanada (`Game.orbitCamera`). "Novo jogo" apaga o salvamento e
  recarrega a página com uma marca no `sessionStorage`, para abrir direto no capítulo 1.
- **`Music`:** elemento `<audio>` ligado ao bus `music` do `AudioSystem` (`createMediaElementSource`), com
  troca suave e lista em sequência. `Game.updateMusic()` escolhe: tema nos cartões, rádio dirigindo,
  silêncio a pé.

## Ambiente real (`src/env/`)

| Arquivo | Papel |
|---|---|
| `api.ts` | Open-Meteo (clima) e BrasilAPI (feriados), com cache no `localStorage` e tempo limite de 6 s |
| `sun.ts` | posição do sol (aproximação da NOAA) e conversão para os eixos do jogo |
| `Environment.ts` | estado: hora de Brasília (UTC−3), sol, clima, feriado de hoje e de amanhã. `override` permite forçar tudo (painel de debug) |
| `Atmosphere.ts` | aplica o estado: céu, neblina, sol ou lua, luz ambiente, postes, janelas, farol, asfalto molhado, aderência, chuva e som. Transições graduais |
| `Rain.ts` | chuva em `LineSegments`, animada no vertex shader |

Com "Clima, horário e feriados reais" desligado no menu, ou sem internet, o jogo usa 14h, céu limpo e dia
útil. O minimapa é capturado com luz de meio-dia, mesmo à noite.

## Áudio (`src/audio/`)

- **`AudioSystem`:** Web Audio com barramentos `vehicle`, `sfx`, `ambient` e `ui`, sons posicionais, loops e
  `noiseLoop` (ruído filtrado, base da cantada de pneu e da chuva). Abafa o mundo de fora quando se está
  dentro do carro.
- **`sounds.ts`:** catálogo de sons (arquivo, barramento, volume).
- **`CarAudio`, `PlayerAudio`, `AmbientAudio`:** sons do carro, do jogador e do ambiente. O ambiente troca
  pássaros por grilos conforme a noite.

## HUD e configurações (`src/hud/`, `src/core/Settings.ts`)

- HUD em DOM: minimapa em canvas, velocímetro, turbo, rádio de corridas, balão de fala, clima e hora, menu de
  pausa e controles de toque.
- O `Hud` recebe um `HudFrame` por frame e só mexe no DOM quando algo muda.
- As configurações ficam no `localStorage` (`esplanada3d.settings.v1`). Os presets de qualidade definem
  sombras, resolução, alcance da sombra e distância de desenho.

## i18n (`src/core/i18n.ts`, `src/data/i18n/`)

- Todas as strings visíveis passam por `t('chave', { parâmetros })`.
- O tipo `StringKey` é derivado do dicionário pt-BR, então uma chave inexistente é erro de compilação.
- Os dicionários são divididos por assunto (`pt-BR.ts`, `.rides.ts`, `.vehicles.ts`, `.environment.ts`).

## Desktop (`electron/`)

- **`main.cjs`:** serve `dist/` pelo protocolo `app://`. Pede a GPU dedicada e ignora a blocklist da GPU,
  com WebGPU liberado e FPS livre opcional.
- **`desktop.json`:** guarda em `userData` as opções que dependem de flags de linha de comando.
- **`preload.cjs`:** expõe `window.desktop` (tela cheia, reiniciar, sair, informações da GPU) para o menu de
  pausa.
- **`launch.mjs`:** abre o Electron removendo `ELECTRON_RUN_AS_NODE` do ambiente.
- **Empacotamento:** `electron-builder`, configurado no `package.json`.

## Ferramentas de desenvolvimento

- **`npm run dev`:** abre o jogo com `src/core/devTools.ts`, que traz lil-gui e stats.js.
  - O painel ajusta jogador, câmera, animação e carro ao vivo.
  - Teleporta para os pontos de interesse.
  - A pasta "Ambiente" força hora, tempo e feriado.
- **`window.game`:** fica exposto no console em desenvolvimento, ou com `?debug` na URL (no desktop:
  `GAME_DEBUG=1`).
