# Créditos e licenças

Registro de origem e licença de todo asset de terceiros usado no jogo.

## Modelos 3D

| Arquivo | Autor | Licença | Origem |
| --- | --- | --- | --- |
| `public/models/characters/executivo.glb` (malha e texturas) | Jungle Jim — https://sketchfab.com/jungle_jim | CC BY 4.0 | "Businessman (Rigged)": https://sketchfab.com/3d-models/businessman-rigged-8933d61fcb1e46f3aead661227bb4fed |
| `public/models/characters/executivo.glb` (animações parado/andar/correr) | Mixamo (Adobe), via `Xbot.glb` do repositório do three.js | Termos do Mixamo (uso livre em projetos) | https://github.com/mrdoob/three.js/tree/r170/examples/models/gltf |
| `public/models/characters/passageiro-eric.glb` (malha e texturas) | Renderpeople — https://sketchfab.com/renderpeople | CC BY 4.0 | "Eric Rigged 001 - Rigged 3D Business Man": https://sketchfab.com/3d-models/eric-rigged-001-rigged-3d-business-man-a46bc9f67aaa415bb4f3241eef900e7f |
| `public/models/characters/passageiro-eric.glb` (animações) | Mixamo (Adobe), via `Xbot.glb` do repositório do three.js | Termos do Mixamo (uso livre em projetos) | https://github.com/mrdoob/three.js/tree/r170/examples/models/gltf |

Os carros da frota não usam modelos de terceiros: são fictícios e gerados em código
(`src/vehicle/carDesign.ts`).

**Alterações no executivo (exigência da CC BY):** ossos renomeados para o padrão Mixamo; dentes/língua
(sem skinning) removidos; animações do Xbot redirecionadas para o esqueleto dele; poses de sentar, acenar e
pular criadas para o jogo; texturas reduzidas. Os passageiros sorteiam a cor do terno e o tom de pele.

**Alterações no passageiro "Eric" (exigência da CC BY):** ossos renomeados do padrão Renderpeople para o
Mixamo; animações do Xbot redirecionadas para o esqueleto dele (com ajuste da pose A para a pose T); poses de
sentar, acenar e pular criadas para o jogo; texturas reduzidas.

## Sons (`public/audio/`)

Todos em domínio público (**CC0 1.0**, https://creativecommons.org/publicdomain/zero/1.0/).
Arquivos marcados com ✂ foram cortados/convertidos (mono, 22 kHz, normalizados) para reduzir o tamanho.

| Arquivo(s) | Autor | Origem |
| --- | --- | --- |
| `car/engine_loop.ogg`, `engine_start.ogg`, `engine_stop.ogg`, `horn.ogg`, `handbrake.ogg`, `door_open.ogg`, `door_close.ogg` | GGBotNet | OpenGameArt — "Car Sound Effects Pack (Low Quality)": https://opengameart.org/content/car-sound-effects-pack-low-quality |
| `car/crash_heavy.ogg` | qubodup | OpenGameArt — "Crash Collision": https://opengameart.org/content/crash-collision |
| `car/turbo.wav` ✂ | pyranostudios | OpenGameArt — "Air Whoosh": https://opengameart.org/content/air-whoosh |
| `car/impact_medium_*.ogg`, `car/impact_light_*.ogg`, `car/impact_wood_*.ogg`, `car/land.ogg`, `player/step_*.ogg`, `player/land.ogg` | Kenney | "Impact Sounds": https://kenney.nl/assets/impact-sounds |
| `player/jump.ogg` | Kenney | "RPG Audio": https://kenney.nl/assets/rpg-audio |
| `ui/*.ogg` | Kenney | "Interface Sounds": https://kenney.nl/assets/interface-sounds |
| `ambient/splash_*.ogg`, `ambient/water_loop.ogg` | rubberduck | OpenGameArt — "40 CC0 water / splash / slime SFX": https://opengameart.org/content/40-cc0-water-splash-slime-sfx |
| `ambient/wind_loop.ogg` | SketchMan3 | OpenGameArt — "Wind Woosh Loop": https://opengameart.org/content/wind-whoosh-loop |
| `ambient/crowd_loop.ogg` | StarNinjas | OpenGameArt — "Crowd Shouting/Speaking Ambience": https://opengameart.org/content/crowd-shoutingspeaking-ambience |
| `ambient/birds_loop.wav` ✂ | Thimras | OpenGameArt — "Park Ambiences": https://opengameart.org/content/park-ambiences |
| `ambient/crickets_loop.mp3` | Wolfgang_ (gravação: Ted Kerr) | OpenGameArt — "Crickets Ambient Noise - loopable" (CC0): https://opengameart.org/content/crickets-ambient-noise-loopable |

### Música (`public/audio/music/`)

Todas em domínio público (**CC0 1.0**), tocadas sem alteração.

| Arquivo | Uso | Autor | Origem |
| --- | --- | --- | --- |
| `bossa_town.mp3` | tema do menu e dos cartões | KarateStudios | OpenGameArt — "Bossa Town": https://opengameart.org/content/bossa-town |
| `drive.mp3` | rádio do carro | Zane Little Music | OpenGameArt — "Drive": https://opengameart.org/content/drive-0 |
| `chill_jazz.mp3` | rádio do carro | Pro Sensory | OpenGameArt — "Chill Jazz": https://opengameart.org/content/chill-jazz |
| `mad_bossa.ogg` | rádio do carro | Spring Spring | OpenGameArt — "Mad Bossa" (CC0 / OGA-BY 3.0; usada como CC0): https://opengameart.org/content/mad-bossa |

A cantada de pneu não usa arquivo: é ruído filtrado gerado em tempo real (`src/audio/AudioSystem.ts`, `noiseLoop`).

## Bibliotecas

Dependências npm (three.js, Rapier, three-mesh-bvh, lil-gui, stats.js) seguem as licenças de cada pacote em `node_modules/`.
A versão desktop usa Electron (MIT) e electron-builder (MIT); o app empacotado inclui o Chromium, cujas licenças
acompanham o instalador (`LICENSE.electron.txt`, `LICENSES.chromium.html`).
O servidor do multiplayer (`server/`, fora do jogo distribuído) usa a biblioteca `ws` (MIT).

## Ícone

`build/icon.png` — desenhado por código para o projeto (sem assets de terceiros).
Os decodificadores Draco/meshopt vêm do pacote `three` (licença Apache 2.0 / MIT).

## Cenário

O cenário é gerado proceduralmente (`src/world/city/`). O relevo vem de dados reais (abaixo).

A chuva também não usa arquivo de som: é ruído filtrado gerado em tempo real (`src/env/Atmosphere.ts`).

## Dados do mundo real

| Uso | Fonte | Licença / termos |
|---|---|---|
| Relevo (`src/world/city/terrainData.ts`, gerado por `npm run terrain` só em desenvolvimento) | Open-Meteo Elevation API — https://open-meteo.com — modelo Copernicus DEM GLO-90 | Dados Open-Meteo: CC BY 4.0. Copernicus DEM: "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved" |
| Clima atual de Brasília (no jogo, a cada 20 min) | Open-Meteo Forecast API — https://open-meteo.com | CC BY 4.0 ("Weather data by Open-Meteo.com") |
| Feriados nacionais (no jogo, uma vez por ano) | BrasilAPI — https://brasilapi.com.br | Projeto aberto (MIT); dados públicos |

Posição do sol: calculada localmente (aproximação da NOAA), sem API. Clima e feriados podem ser desligados
no menu de pausa ("Clima, horário e feriados reais"); sem internet o jogo usa um padrão (14h, céu limpo).
