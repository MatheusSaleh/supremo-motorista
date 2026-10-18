# Roteiro do desenvolvimento

O projeto começou como um passeio 3D pela Esplanada dos Ministérios (fases 1–4). Depois da Fase 4 virou o
**Supremo Motorista**, uma sátira arcade no estilo Crazy Taxi, com as fases 5–12. O multiplayer previsto no
plano original foi adiado por tempo indeterminado.

Cada fase termina com uma pausa para teste antes da próxima, e `npm run build` (com checagem de tipos)
precisa passar.

| Fase | Tema | Situação |
|---|---|---|
| 1 | Personagem jogável | ✅ concluída |
| 2 | Personagem animado | ✅ concluída |
| 3 | Esplanada procedural | ✅ concluída |
| 4 | HUD e polimento | ✅ concluída |
| 5 | Veículo | ✅ concluída |
| 6 | Mapa expandido | ✅ concluída |
| 7 | Corridas | ✅ concluída |
| 8 | Perseguidores e polarização | ⏳ próxima |
| 9 | O banqueiro e o Medidor de Suspeição | ⏳ |
| 10 | Arquétipos de passageiros | ⏳ |
| 11 | Expediente, sessão, melhorias e salvamento | ⏳ |
| 12 | Campanha, finais, menus e áudio | ⏳ |

---

## O que já foi feito

### Fase 1 — Personagem jogável
- Josué é uma cápsula com o `KinematicCharacterController` do Rapier: andar, correr, pular (com coyote time e
  buffer de pulo), subir degraus e rampas e grudar no chão nas descidas.
- Física em passo fixo (60 Hz) com interpolação visual.
- Câmera em terceira pessoa com colisão (raycast com BVH), zoom no scroll e pointer lock.

### Fase 2 — Personagem animado
- Modelo com animações (parado, andar, correr, pular, cair) e transições suaves. A velocidade da animação
  acompanha a velocidade real.
- O personagem atual é o executivo de terno (ver "Extras").

### Fase 3 — Esplanada procedural
- Esplanada, Congresso, Catedral, Rodoviária, ministérios e palácios gerados por código: sem dependência de
  arquivos de cenário.
- O World cria os colisores automaticamente a partir das malhas, guiado por convenções em `userData`.

### Fase 4 — HUD e polimento
- **Menu de pausa:** qualidade gráfica (Baixa/Média/Alta/Ultra), resolução, distância de desenho, sombras,
  volumes de áudio e lista de controles.
- **Interface:** minimapa capturado do próprio cenário, tela de carregamento com progresso real e controles
  de toque.

### Virada para o Supremo Motorista
Foram definidas as regras de conteúdo (ver README):
- tudo fictício;
- Azuis × Vermelhos;
- Dr. Rubens Caixeta, do Banco Confiança S.A.;
- violência só no pastelão;
- textos no i18n.

### Fase 5 — Veículo
- **Física:** `DynamicRayCastVehicleController` do Rapier com ajudas de arcade:
  - drift controlado pelo freio de mão;
  - downforce e turbo;
  - controle no ar;
  - desvirar automático;
  - menos aderência e mais arrasto na grama;
  - perda de velocidade nas curvas.
- **Na cidade:** entrar e sair do carro e câmera de perseguição que abre com a velocidade.
- **Danos e sujeira:** postes, árvores e placas quebráveis viram destroços. O carro amassa e suja; a garagem
  do Tribunal lava e desamassa.

### Fase 6 — Mapa expandido ("Brasília condensada", cerca de 4,6 × 5,1 km)
- **Regiões:**
  - Praça dos Três Poderes e Esplanada;
  - Lago Paranoá com orla de restaurantes e o Lago Sul com mansões;
  - Eixão com as tesourinhas (rampas para saltos) e superquadras;
  - Rodoviária e feira;
  - aeroporto.
- **Endereços** no estilo de Brasília, com siglas fictícias (ex.: "SHIP QL 07 Conjunto 1 Casa 15").
- **Lago:** cair na água devolve carro e Josué ao último ponto seguro.

### Fase 7 — Corridas
- O "Rádio do Tribunal" oferece corridas com origem, destino e tempo previsto. O jogador atende, busca o
  passageiro (que acena na calçada) e o leva até o destino. Um farol mostra o ponto e uma seta 3D indica a
  direção.
- **Pagamento:**
  - entram a diária, a gorjeta pelo tempo que sobrou e bônus por saltos e derrapagens;
  - descontam batidas, "danos ao patrimônio" e mergulhos no lago.
- O passageiro tem falas próprias para cada situação (salto, batida, pressa, lentidão, chegada…).

### Extras feitos entre as fases
- **Sons (todos CC0):**
  - motor que varia com a rotação e cantada de pneu sintetizada;
  - impactos, buzina e portas;
  - passos que mudam com o piso;
  - ambiente: pássaros de dia, grilos à noite, água, feira e chuva sintetizada;
  - interface;
  - tudo abafado quando se está dentro do carro.
- **Marcos reais como cenário:** TST, PGR, Superintendência da PF, QG do Exército, INSS, Torre de TV, Ponte
  JK, Estádio, Teatro Nacional, Planalto, Alvorada, Museu e Biblioteca Nacional. O Banco do Brasil foi
  trocado pelo fictício Banco Confiança S.A.
- **Frota oficial:** cinco carros com modelos realistas (CC BY) e nomes paródia, cada um com física, som e
  efeito na gorjeta. Ficam na garagem do Tribunal e se troca de carro entrando em outro.

  | No jogo | Modelo real | Destaque |
  |---|---|---|
  | Toiota SW-Quatro | Toyota SW4 | 4x4 diesel, não liga para o gramado |
  | Toiota Corolinha | Toyota Corolla | leve, turbo recarrega rápido |
  | Fiord Fusão | Ford Fusion 2017–2020 | referência da frota |
  | Chevrolé Equinócio | Chevrolet Equinox RS 2022 | SUV média |
  | Lexo ES 300h | Lexus ES 300h | macio, "turbo elétrico", passageiros pagam mais (sátira da licitação) |
- **Interior e cockpit:** painel, volante que gira, velocímetro e conta-giros funcionando. As mãos do
  motorista seguem o volante por cinemática inversa (IK). A câmera interna fica na tecla C.
- **Personagem realista:** Josué e os passageiros são executivos de terno e gravata. Os passageiros sorteiam
  a cor do terno e o tom de pele a cada corrida.
- **Desktop (Electron):** AppImage para Linux e zip para Windows. Pede a GPU dedicada e tem opção de FPS sem
  limite.
- **Otimizações:**
  - agrupamento de malhas estáticas;
  - distância de desenho por qualidade;
  - instâncias em blocos;
  - sombra que acompanha o jogador;
  - modelos leves nas qualidades Baixa e Média.
- **Mundo real:**
  - **Clima de Brasília** (Open-Meteo): chuva com pista molhada, menos aderência, spray e som; tempestade;
    neblina; seca com névoa de poeira.
  - **Hora real:** posição do sol calculada para Brasília, entardecer e noite com postes, janelas e faróis
    acesos, e adicional noturno nas corridas.
  - **Feriados nacionais** (BrasilAPI): gorjeta em dobro e todo mundo querendo "emendar" no aeroporto.
  - **Relevo real:** elevação do modelo Copernicus, com áreas planas sob a garagem e os palácios.
  - Tudo isso pode ser desligado no menu. Sem internet, o jogo usa um padrão.

---

## O que falta

### Fase 8 — Perseguidores e polarização ⏳
- Carros das facções **Azuis** e **Vermelhos** perseguem o carro oficial, tentando fechar, empurrar e jogar
  coisas (tomates, cartazes). Tudo no pastelão.
- **Medidor de polarização:** sobe conforme as corridas, os passageiros e as escolhas do jogador. Quanto mais
  alto, mais perseguidores e mais agressivos.
- Perseguidores também sofrem com a física (batem, capotam, caem no lago).
- **Ainda a decidir:** IA de direção (seguir pistas ou ir direto ao alvo); quantos carros ao mesmo tempo sem
  pesar no desempenho; como a polarização baixa.

### Fase 9 — O banqueiro e o Medidor de Suspeição ⏳
- Corridas especiais do **Dr. Rubens Caixeta** (Banco Confiança S.A.), que pagam muito acima da diária. O
  "cafezinho no banco", já existente, vira o gancho.
- **Medidor de Suspeição:** sobe com cada favor ao banqueiro e com rotas "estranhas". Cheio, traz
  consequências: auditoria, perseguição, multa, perda de carro.

### Fase 10 — Arquétipos de passageiros ⏳
Os cinco tipos já cadastrados em `src/data/rides.ts` ganham comportamento próprio:

| Tipo | Comportamento previsto |
|---|---|
| Orador | fala sem parar; ouvir rende gorjeta |
| Palestrante | pede paradas e desvios no caminho |
| Novato | se assusta com saltos e drift (ou adora) |
| Presidente | exige pressa; atraso custa caro |
| Discreto | paga mais para não ser visto; evitar áreas movimentadas |

### Fase 11 — Expediente, sessão, melhorias e salvamento ⏳
- **Expedientes (turnos):** metas, horário (a hora real já está pronta) e um resumo no fim.
- **Melhorias da frota** com o dinheiro ganho (motor, suspensão, pneus, turbo) e liberação de carros.
- **Salvamento** do progresso (dinheiro, carros, medidores, campanha).

### Fase 12 — Campanha, finais, menus e áudio ⏳
- Campanha com **três finais**, decididos pela polarização e pela suspeição.
- Menu principal, manchetes fictícias entre os expedientes e trilha sonora.

### Pendências e melhorias conhecidas
- **Instalador do Windows:** o `.exe` precisa ser gerado no Windows ou com o Wine; hoje sai só o zip.
- **Pacote `.deb`:** falha por falta de e-mail do mantenedor e de site do projeto no `package.json`.
- **Equinox 2025:** não há modelo gratuito realista. Se um modelo comprado for fornecido, a conversão é a
  mesma dos outros carros (ver ASSETS.md).
- **Rostos dos passageiros:** todos usam o mesmo modelo de executivo. Mais modelos com esqueleto Mixamo
  dariam rostos diferentes, reaproveitando as animações.
- **Interior da garagem à noite:** fica bem escuro. As luminárias do teto poderiam acender.
