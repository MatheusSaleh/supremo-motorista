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
| 8 | Perseguidores e polarização | ✅ concluída |
| 9 | O banqueiro e o Medidor de Suspeição | ✅ concluída |
| 10 | Arquétipos de passageiros | ✅ concluída |
| 11 | Expediente, sessão, melhorias e salvamento | ⏳ próxima |
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
- Vermelhos × Amarelos (antes Azuis × Vermelhos);
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

### Fase 8 — Perseguidores e polarização
- **Facções fictícias Vermelhos e Amarelos**, cada uma com **territórios** no mapa (quadras ao norte e a
  feira para os Vermelhos; quadras ao sul e o Lago Sul para os Amarelos). Bandeiras ao longo das ruas e
  áreas coloridas no minimapa mostram onde cada um manda.
- **Polarização:** um "calor" de 0 a 100 por facção, visível no HUD.
  - **Sobe:** dentro do território, com passageiro rival, em alta velocidade, buzinando, derrubando postes
    e partindo para cima dos carros da facção.
  - **Esfria:** com o tempo, com passageiro da própria facção e ao despistar perseguidores. Parar na
    garagem do Tribunal ("imunidade") zera tudo.
  - Cada passageiro tem uma simpatia (ou nenhuma), mostrada no rádio. Entregá-lo esfria a facção dele e
    esquenta a rival.
- **Perseguidores:** carros da frota pintados de vermelho ou amarelo, com bandeira no teto. De 2 a 4 ao
  mesmo tempo, conforme a qualidade gráfica.
  - Surgem fora da vista quando o calor passa de 30, 60 e 85.
  - **IA:** segue as ruas da cidade com um grafo de navegação (A*), reduzindo nas curvas. Perto do
    carro oficial, vai direto, com drift e turbo, buzinando, fechando, empurrando e jogando tomates (que
    sujam o carro).
  - Presos, dão ré. Desistem quando despistados (4 s a mais de 420 m), quando caem no lago ou quando a
    facção esfria.
- **Nas corridas:** o passageiro reage (perseguição, tomate, território amigo ou hostil) e cada
  perseguidor despistado com ele a bordo rende bônus.
- **Debug:** a pasta "Facções" do painel ajusta o calor de cada lado.

### Fase 9 — O banqueiro e o Medidor de Suspeição
- **Ligações do Dr. Rubens Caixeta** (Banco Confiança S.A., fictício) no "celular particular", com um painel
  verde diferente do rádio. Em cerca de 30% das ofertas, ele pede um favor:
  - **Carona:** ele mesmo, de terno creme, com falas próprias de banqueiro. Paga 3 diárias.
  - **Maleta:** ela espera na calçada e vai sozinha no banco de trás, enquanto ele manda SMS ("é só
    papelada"). Paga 5 diárias. Batida forte com a maleta faz dinheiro voar pela janela.
  - Ignorar a ligação recusa o favor.
- **Medidor de Suspeição** no HUD:
  - **Sobe:** ao aceitar e ao entregar favores, durante o favor, quando a maleta sacode, nas fotos da
    imprensa e nos "cafezinhos" no banco.
  - **Desce:** com o tempo, com corridas limpas e recusando favores.
  - Com a suspeição alta, o Dr. Caixeta para de ligar.
- **Imprensa** (Gazeta da Tesourinha, fictícia): carros brancos com a bandeira "IMPRENSA" aparecem a partir
  de 35 e 70 de suspeição. Eles reaproveitam o pool dos perseguidores, mas seguem a uns 18 m sem bater e
  fotografam, com flash. Foto com favor a bordo é flagrante e pesa muito no medidor.
- **Escândalo (100):** a Corregedoria do Tribunal (fictícia) multa em 40% do dinheiro (mínimo de R$ 400),
  apreende a maleta, o Dr. Caixeta "não conhece esse rapaz", a imprensa vai embora e uma manchete ocupa a
  tela. O medidor volta para 30.
- O histórico de favores aceitos e recusados e de escândalos fica guardado para a campanha e os finais.
- **Debug:** a pasta "Banqueiro" do painel traz a ligação na hora, a suspeição e um escândalo forçado.

### Fase 10 — Arquétipos de passageiros
Cada ministro fictício tem um jeito, que o rádio anuncia no chamado e que muda as regras da corrida, as
falas e a conta:

| Tipo | Ministro | Comportamento |
|---|---|---|
| Orador | Tibúrcio Pompeu | faz discursos de tempos em tempos; cada um ouvido inteiro rende gorjeta, e interromper (batida, salto, buzina) custa |
| Palestrante | Clotilde Vistas | exige uma parada no caminho para uma "palestra rápida" (farol roxo, 2,5 s parado lá); mais tempo de corrida e bônus |
| Novato | Anselmo Recurso | sorteado a cada corrida: medroso (saltos, derrapagens e mais de 100 km/h tiram gorjeta) ou empolgado (bônus de salto e drift em dobro) |
| Presidente | Dulce Liminar | 20% menos tempo, gorjeta em dobro e multa se atrasar; reclama se o carro anda devagar |
| Discreto | Euclides Embargo | bônus de discrição que cai com o tempo em áreas movimentadas (Esplanada, Praça, Rodoviária) e com fotos da imprensa |

- O painel da corrida mostra a situação: discurso em andamento, parada exigida, exposição…
- **Debug:** a pasta "Passageiros" do painel força o próximo passageiro e chama o rádio na hora.

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
