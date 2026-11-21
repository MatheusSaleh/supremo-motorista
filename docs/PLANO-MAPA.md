# Plano: Brasília mais densa e mais fiel

Objetivo: menos gramado vazio e mais lugares reconhecíveis da Brasília real, sem perder o desempenho nem
quebrar as corridas, a IA dos perseguidores e o multiplayer. Aprovado em 20/11/2026.

## Métrica

O diagnóstico de ocupação (`src/world/city/occupancy.ts`, só em modo dev) divide o mapa numa grade de
10 m e conta como **vazia** a terra firme a mais de 60 m de qualquer prédio, pista, praça, estacionamento
ou mobiliário. Árvores e o próprio chão não contam. O gramado da Esplanada e as áreas de
`OPEN_ON_PURPOSE` (layout.ts) ficam fora da conta.

- Console do navegador: `[cidade] gramado vazio: …`
- Painel de debug → **Mapa → vazios**: mapa com o vazio em vermelho.

| Momento | Vazio | Maior mancha |
|---|---|---|
| Antes do plano | 65,2% | 4,54 km² |
| Depois da M2 | 45,3% | 2,18 km² |
| Depois da M3 | 39,9% | 2,12 km² |
| Depois da M4 | 24,1% | 1,44 km² |
| Depois da M5 | 11,6% | 0,64 km² |
| Meta | < 25% | — |

## Fases

| Fase | Tema | Situação |
|---|---|---|
| M1 | Infraestrutura: diagnóstico, kit de quadras e lotes, chão variado | ✅ |
| M2 | Asas leste: quadras 200/400, vias L1–L4, faixas 600/800 | ✅ |
| M3 | Centro: setores Comercial, Bancário, Hoteleiro e de Diversões; Autarquias Norte | ✅ |
| M4 | Oeste: quadras 300/500/700, Eixo Monumental oeste, Setor Militar Urbano, Parque da Cidade, Sudoeste | ✅ |
| M5 | Orla: clubes, embaixadas (países fictícios), UnB, "Pontão" fictício | ✅ |
| M6 | Vida: paradas, bancas, ipês por estação, caminhos de terra, pedestres e tráfego ambiente | ✅ |
| M7 | Gameplay: endereços nas corridas, territórios das facções, minimapa, balanceamento | ✅ |

### M1 — infraestrutura
- `occupancy.ts`: grade de ocupação e o painel "Mapa" do debug.
- `quadras.ts` (`CityKit`): superquadra (blocos sobre pilotis com pilares e portaria, estacionamentos,
  escola-classe, parquinho, cinturão de árvores), estacionamento com carros parados, comércio local e
  lotes institucionais (igreja, escola, posto, hospital, sede, clube). Peças repetidas são instanciadas
  em `flush()`.
- `ground.ts`: o chão recebe manchas de capim seco, verde escuro e terra vermelha (cor por vértice).
- `CityBuilder.treeSpots` (árvores em posições escolhidas) e `isRectFree`.

### M2 — asas leste
- Vias: Via Norte (espelho da Via Sul), L1 e L3 (locais), L2 Norte e L4 (principais) e as transversais
  das tesourinhas descendo até a L4 (as de ±1500 até a orla). Tudo entra no grafo da IA.
- Superquadras 200 (6 andares) e 400 (3 andares) nas duas asas, mais uma 200 além do aeroporto.
  Os blocos usam ids `sqb-…`, então já entram no pool "quadras" das corridas.
- Comércio local (CLQ) entre quadras vizinhas, com lojas fictícias (`pt-BR.cidade.ts`).
- Faixas 600 e 800 (SGA): duas fileiras de lotes por faixa, cada uma de frente para uma via.
- A Superintendência da PF foi para a faixa 600 Sul, de frente para a L2 (antes ficava no meio das
  quadras 400).

### M3 — centro
- `centro.ts` + `CENTRO` (layout.ts), com o espelho Norte/Sul.
- `CityKit.building` (fachada em módulos de 4 m × 1 andar, então as janelas não esticam) e
  `CityKit.fillSector` (grade de prédios com estacionamento, endereço e letreiro opcional; pula o que
  encostar em marcos existentes).
- Setor Bancário (torres de vidro de 12–25 andares, bancos fictícios), Setor Comercial (prédios médios),
  Setor Hoteleiro (entre o Eixão e as superquadras, com rua de serviço), Setor de Diversões (galeria com
  torres ao Sul, shopping ao Norte), Autarquias (atrás da Catedral, faixa L3–L4, até a orla; inclui o Setor
  de Autarquias Norte) e os anexos atrás dos ministérios.
- Siglas novas: SCC, SHT, SDV. Endereços com prefixos `sbc-`, `scc-`, `sht-`, `saa-`, `sdv-` (entram nas
  corridas na M7).

### M4 — oeste
- `oeste.ts` + `OESTE` (layout.ts). W3 Sul e Norte (a Norte só a oeste do Estádio), transversais das
  tesourinhas até a W3 (as do Sul seguem até a via do fundo do parque).
- Superquadras 100 refeitas com o kit (pilotis etc.; mesmos números e ids `sqb-…`) e comércio local nos
  vãos; quadras 300; comércio da W3 (500) com `CityKit.shopRow`; casas geminadas da 700
  (`CityKit.houseRow`, sigla SHG) em blocos de 12.
- Eixo Monumental oeste: Feira da Torre (anel de barracas), Centro de Convenções, Planetário (sem nome),
  Memorial JK, Palácio do Buriti (com o buriti e o mastro), Cruzeiro (sem nome), Setor de Rádio e TV
  (emissoras fictícias, antenas) e secretarias fictícias ao lado do Buriti.
- Setor Militar Urbano em volta do QG (quartéis, pátio de formatura, quadras), Parque da Cidade (lago com
  mureta, pista de cooper, pavilhão, parque de diversões fictício com roda-gigante e carrossel,
  kartódromo, quiosques, bosques) e Sudoeste (quatro superquadras e comércio).
- O gramado central do Eixo oeste e o Parque da Cidade contam como verde de propósito no diagnóstico.
- Blocos residenciais: uma geometria por altura (72 m, escalada por instância).

### M5 — orla
- `orla.ts` + `ORLA` (layout.ts). Via das embaixadas (z −760) e a via do fundo da UnB; a avenida da orla
  agora vai até o limite oeste; terceira rua de mansões no Lago Sul (x 1940).
- Setor de Embaixadas Sul e Norte (sigla SED): três fileiras de lotes murados com portão, guarita, mastro
  com bandeira de país FICTÍCIO (Valdória, Borealândia…), placa e um de cinco tipos de prédio.
- Setor de Clubes Sul e Norte (SCL): sede, piscinas, quadras e, nos lotes fundos, campo de futebol.
- UnB (SUB): o "Minhocão" (duas alas longas e levemente curvas), biblioteca em degraus, reitoria com
  rampa, pavilhão redondo, restaurante universitário, centro esportivo, institutos genéricos e os
  estacionamentos enormes.
- Píeres de madeira com barcos na margem norte (a mureta ganhou aberturas) e o "Pontão" fictício, o
  Cais Candango: deque sobre a água com restaurantes, palmeiras e guarda-corpo.
- Carros da frota: além de 250 m só a pintura é desenhada, e as rodas não projetam sombra.

### M6 — vida
- `vida.ts`: paradas de ônibus nas vias principais (a cada ~360 m, alternando as mãos; uma em cada três
  com banca de jornal) e caminhos de terra da parada até o endereço mais perto (não atravessam prédios).
  As paradas vão para `Level.busStops`.
- Ipês (12% das árvores): roxo (jun–jul), rosa (jul–ago), amarelo (ago–set) e branco (set–out) florescem
  no mês real; fora da época ficam verdes. `?mes=0..11` na URL força o mês para testar.
- `src/ambient/`: `graphWalk.ts` (andarilho pelo grafo de ruas com deslocamento lateral, transição suave
  nas curvas e sonda de altura pela física, para a Ponte JK e as lombadas), `AmbientTraffic.ts` (carros na
  mão direita, corpo cinemático, freiam atrás do jogador, dos perseguidores e uns dos outros, reduzem nas
  curvas, nascem e somem fora da vista) e `Pedestrians.ts` (calçadas e paradas; sem colisão: diante de um
  carro rápido, pulam para o lado e voltam, porque violência só no pastelão).
- Densidade por qualidade (`AMBIENT_DENSITY`): Baixa 12 carros/40 pedestres, Média 28/90, Alta 45/140,
  Ultra 70/220. Tráfego e pedestres são locais (não sincronizam no multiplayer).

### M7 — gameplay
- Corridas (`data/rides.ts`): pools novos `casas`, `comercio`, `bancario`, `hoteis`, `autarquias`,
  `embaixadas`, `clubes`, `tv` e `pontao`, e nove motivos novos (comitiva no hotel, recepção na embaixada,
  tênis "de trabalho", entrevista ao vivo, carimbo, comprinha, happy hour, Setor Bancário…). Endereços em
  marcos reais (UnB, SMU, Parque da Cidade, Feira da Torre, PF etc.) continuam fora dos pools.
- A parada da Palestrante também pode cair no comércio local ou no Cais Candango.
- Territórios (`data/factions.ts`): 8 áreas, 4 por facção, cobrindo os bairros residenciais novos (asas
  leste e oeste, casas da 700, Sudoeste) e sem nenhum marco real dentro.
- Balanceamento: folga de tempo 1,6 → 1,7 (tráfego e cidade mais densa), farol do destino visível a 180 m
  (era 140) e calor do "carro oficial" no território 0,6 → 0,45/s (os territórios cresceram).
- Minimapa: nomes de bairros/setores (`Landmark.minor`) viram rótulos discretos, sem ponto na borda; os
  marcos continuam com destaque e têm prioridade no espaço.

### Otimização (depois da M3)
Medido no Chrome sem GPU (draw calls com sombra, qualidade Média):

| Vista | Antes do plano | Depois da M3 | Depois da otimização |
|---|---|---|---|
| Esplanada | 695 | 750 | 383 |
| Garagem | 769 | 829 | 401 |
| Rua das asas | 89 | 216 | 187 |

- Carros da frota: a lataria e cada roda viram uma malha por material (`vehicle/mergeParts.ts`); o interior
  só é desenhado com a câmera a menos de 14 m. De ~105 para ~30 draw calls por carro.
- Raycasts da câmera e do piso passam por uma grade espacial (`world/MeshGrid.ts`): de 5,3 ms para
  0,3 ms por quadro nas asas (o raycast do three-mesh-bvh não testa a esfera envolvente antes).
- Carros parados: uma geometria só com cor por vértice, sem sombra, colisor `'box'`.
- Blocos com 4 grupos de material; pilares e portarias sem sombra; cinturões de árvores mais leves.
- Distância de desenho para prédios, blocos e estacionamentos novos; o agrupamento de malhas do World
  agora preserva `cullDistance`.

## Regras de conteúdo

Valem as do projeto (README). Marcos reais extras aprovados só como cenário: Memorial JK, Palácio do
Buriti, Centro de Convenções, UnB, Parque da Cidade, Igrejinha da 307/308 Sul e Setor Militar Urbano.
Comércio sempre com nome fictício.

## Cuidados

- Desempenho: tudo o que repete é instanciado em blocos espaciais. Peças pequenas têm `cullDistance`.
- Colisão: caixas instanciadas levam a altura na matriz, nunca na geometria (o World monta o cuboide a
  partir dos parâmetros da `BoxGeometry`).
- Relevo: pisos usam `userData.drape = 'deform'` para acompanhar o terreno mesmo quando são pequenos.
- Multiplayer: o gerador continua determinístico (semente fixa).
