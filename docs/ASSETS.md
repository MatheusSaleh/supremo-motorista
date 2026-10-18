# Modelos, sons e dados externos

Tudo que vem de terceiros está listado em [CREDITS.md](../CREDITS.md), com autor, origem, licença e
alterações. Ao adicionar qualquer coisa de fora, registre lá: modelos CC BY exigem crédito e a descrição das
alterações.

## Modelos 3D (`public/models/`)

| Arquivo | O quê | Origem |
|---|---|---|
| `fleet/*.glb` | os cinco carros da frota (`*-lod.glb` = versão leve) | Sketchfab, CC BY 4.0 |
| `fleet/ATTRIBUTION.txt` | créditos que acompanham os arquivos | — |
| `characters/executivo.glb` | Josué e os passageiros, com as animações | Sketchfab (CC BY 4.0) + animações Mixamo |

### Formato que o jogo espera de um carro

- **Orientação:** metros, frente em +Z, esquerda em +X, chão em y = 0 e carro centrado.
- **Nós:** `body` (lataria) e `wheel-front-left`, `wheel-front-right`, `wheel-rear-left`,
  `wheel-rear-right`. A origem de cada roda fica no cubo, e a roda gira em torno do eixo X.
- **Nomes de material com efeito no jogo:**
  - `paint`: cor da frota e sujeira;
  - `glass`: vidro translúcido;
  - `taillight`: acende ao frear;
  - `headlight`: acende à noite;
  - `black` e `paint`: visíveis por dentro;
  - `tire`.
- **Interior:** o jogo coloca um interior procedural (painel, volante, bancos) escalado para cada carro, então
  o interior do modelo original é removido na conversão.

Como o jogo deriva rodas, chassi e cabine a partir do modelo: `measure()` em `src/vehicle/CarVisual.ts`.

### Conversor (`tools/conversor-modelos/`)

Ferramenta usada para preparar os carros e o personagem. Roda no navegador e não entra no jogo.

```bash
npx vite --config tools/conversor-modelos/vite.config.mjs   # abre http://localhost:5190
```

1. Baixe o `.glb` de origem (ex.: do Sketchfab) para `tools/conversor-modelos/entrada/` (pasta fora do git).
2. Cole a configuração na página: os exemplos em `exemplos/` são os usados na frota atual.
3. **Converter carro** gera `hq.glb` (Alta/Ultra) e `lq.glb` (Baixa/Média), mais imagens de prévia.
4. Copie os arquivos para `public/models/fleet/` e cadastre o carro em `src/data/vehicles.ts`, com os nomes
   no i18n.

O que a conversão faz:
- aplica as transformações de toda a hierarquia;
- remove o interior;
- orienta pela posição dos faróis e das lanternas;
- escala para o comprimento real;
- separa as rodas pelo cilindro de cada pneu;
- renomeia os materiais;
- simplifica com o meshoptimizer (já incluído no `three`) e recalcula as normais com vincos;
- reduz as texturas.

Configuração do carro:

| Campo | Para quê |
|---|---|
| `url` | arquivo em `/entrada/…` |
| `drop`, `dropMat` | regex de nós e materiais removidos (interior, suspensão, placas) |
| `mats` | `[{ mat, node, to }]`: renomeia materiais (para `paint`, `glass`, `taillight`, `headlight`, `tire`…) |
| `matOverrides` | cor, rugosidade e metal por material (para modelos sem cores, como o Fusion) |
| `frontKey`, `backKey` ou `flip`, `yaw` | orientação |
| `length` | comprimento real em metros |
| `wheelMode: 'material'` + `wheelKey` | acha as rodas pelo material do pneu |
| `wheelMode: 'contact'` + `radius`, `tireWidth`, `wheelZ`, `wheelX` | rodas de modelos fotoescaneados |
| `groundCut`, `groundFlat`, `skirtCut` | limpeza do chão de modelos fotoescaneados |
| `recolor` | recolore a textura de modelos fotoescaneados (com áreas preservadas e placas apagadas) |
| `crease` | ângulo (graus) para recalcular as normais |
| `outputs` | `{ hq: { budget, err, mode, tex }, lq: … }`: triângulos alvo, erro do simplificador, `normal` ou `posmerge`, tamanho máximo da textura |

### Personagem

**Montar personagem** recebe um modelo com esqueleto Mixamo (os sufixos que o Sketchfab acrescenta aos
ossos são aceitos) e um `.glb` com animações Mixamo. Usamos o `Xbot.glb` dos exemplos do three.js. Exemplo
de configuração: `exemplos/personagem.json`.

O que a montagem faz:
- **Ossos:** renomeia para `mixamorigNome`.
- **Malhas soltas:** remove as que não têm skinning (dentes e língua, que ficariam flutuando).
- **Animações do Xbot:** retarga `idle`, `walk` e `run` em espaço de mundo, gerando `Idle`, `Walking` e
  `Running`.
- **Poses procedurais:** cria `Sitting` (motorista e passageiro), `Wave` (passageiro na calçada) e `Jump`.
- **Exportação:** gera um `.glb` com tudo e texturas em JPEG.

Depois de copiar para `public/models/characters/`, ajuste `config.character` em `src/config.ts`: arquivo,
nomes dos clips, ossos do braço para a IK do volante, osso da cabeça e velocidades das animações.

## Sons (`public/audio/`)

- **Licença:** todos CC0 (OpenGameArt). Alguns foram cortados ou convertidos (mono, 22 kHz).
- **Cadastro:** cada som entra em `src/audio/sounds.ts` com arquivo, barramento e volume. Variações
  (`impact_light_0..2`) são sorteadas.
- **Sintetizados:** a cantada de pneu e a chuva não usam arquivo; são ruído filtrado gerado em tempo real.

## Dados do mundo real

| Dado | Quando é buscado | Onde |
|---|---|---|
| Relevo (Open-Meteo Elevation, Copernicus DEM) | só em desenvolvimento: `npm run terrain` | `scripts/fetch-terrain.mjs` → `src/world/city/terrainData.ts` |
| Clima atual (Open-Meteo Forecast) | no jogo, a cada 20 min (cache no navegador) | `src/env/api.ts` |
| Feriados nacionais (BrasilAPI) | no jogo, uma vez por ano (cache de 30 dias) | `src/env/api.ts` |

Nenhuma das APIs usa chave de acesso. Sem internet, o jogo segue com o padrão (14h, céu limpo, dia útil).
