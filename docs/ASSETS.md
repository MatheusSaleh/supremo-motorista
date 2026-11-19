# Modelos, sons e dados externos

Tudo que vem de terceiros está listado em [CREDITS.md](../CREDITS.md), com autor, origem, licença e
alterações. Ao adicionar qualquer coisa de fora, registre lá: modelos CC BY exigem crédito e a descrição das
alterações.

## Modelos 3D (`public/models/`)

| Arquivo | O quê | Origem |
|---|---|---|
| `characters/executivo.glb` | Josué e os passageiros, com as animações | Sketchfab (CC BY 4.0) + animações Mixamo |
| `characters/passageiro-eric.glb` | outro rosto de passageiro (mesmo esqueleto e animações) | Sketchfab (CC BY 4.0) + animações Mixamo |

Os modelos extras de passageiro ficam em `config.character.passengerUrls` (`src/config.ts`). Cada corrida
sorteia um deles; o Dr. Caixeta usa sempre o executivo.

## Carros (gerados em código)

Os carros da frota são **fictícios** e não usam arquivos: `src/vehicle/carDesign.ts` monta cada um a partir de
um desenho (`CarDesign`) cadastrado em `src/data/vehicles.ts`.

- **Medidas:** comprimento, largura, altura, eixos, bitola, rodas, soleira, cintura, capô e tampa traseira.
- **Estufa:** pé do para-brisa, começo e fim do teto, pé do vidro traseiro e largura do teto.
- **Colunas:** B, C/D e uma coluna extra opcional (SUVs de três janelas).
- **Estilo:** grade (`slot`, `wide`, `tall`, `bars`), lanterna (`corners` ou `bar`), faróis, barras de teto,
  teto preto, frisos cromados e aro (raios, cor, raios duplos).

O gerador entrega a mesma estrutura de um modelo `.glb` (nó `body`, rodas `wheel-front-left` etc. com origem
no cubo, materiais `paint`, `glass`, `black`, `trim`, `rim`, `tire`, `headlight`, `taillight`). Por isso o
interior, a sujeira, os amassados e as luzes (`src/vehicle/CarVisual.ts`) funcionam sem mudança, e a física
continua derivada das medidas (`measure()`). Nas qualidades Baixa e Média sai uma versão com menos polígonos.

Ao mudar um desenho, confira se o interior procedural ainda cabe: o para-brisa começa logo à frente do painel
(z ≈ 1,0 × comprimento/4,71) e a cintura fica perto de 1,1 × altura/1,8.

### Vitrine dos carros

```bash
npx vite --config tools/vitrine-carros/vite.config.mjs   # abre http://localhost:5191
```

Mostra a frota lado a lado, com a câmera livre. Parâmetros: `?car=fusao` (um carro só),
`?view=front|rear|side|top|three|rear3`, `?low=1` (versão leve) e `?paint=c03030` (outra cor).

### Conversor (`tools/conversor-modelos/`)

Ferramenta usada para preparar o personagem (e, se um dia for preciso, um carro em `.glb` no formato acima,
carregado com `loadCarAsset`). Roda no navegador e não entra no jogo.

```bash
npx vite --config tools/conversor-modelos/vite.config.mjs   # abre http://localhost:5190
```

1. Baixe o `.glb` de origem (ex.: do Sketchfab) para `tools/conversor-modelos/entrada/` (pasta fora do git).
2. Cole a configuração na página (exemplo do personagem em `exemplos/personagem.json`).
3. **Montar personagem** gera o `.glb` pronto; **Converter carro** gera `hq.glb` e `lq.glb`, mais imagens de
   prévia.

Configuração de um carro em `.glb` (botão **Converter carro**):

| Campo | Para quê |
|---|---|
| `url` | arquivo em `/entrada/…` |
| `drop`, `dropMat` | regex de nós e materiais removidos (interior, suspensão, placas) |
| `mats` | `[{ mat, node, to }]`: renomeia materiais (para `paint`, `glass`, `taillight`, `headlight`, `tire`…) |
| `matOverrides` | cor, rugosidade e metal por material (para modelos sem cores) |
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
ossos são aceitos) ou no padrão Renderpeople/Unreal (`hip`, `spine_01`, `upperarm_l`…, convertidos para Mixamo) e um `.glb` com animações Mixamo. Usamos o `Xbot.glb` dos exemplos do three.js. Exemplo
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
