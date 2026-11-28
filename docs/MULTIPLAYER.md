# Multiplayer (modo livre)

Vários jogadores dirigindo pela mesma Brasília, vendo os carros uns dos outros e os mesmos perseguidores.
Corridas, polarização, Suspeição, carreira e campanha continuam individuais.

```
navegador ── https ──> matheussaleh.com.br/jogo   (Vercel: o jogo, estático — nada muda)
    └────── wss ─────> mp.matheussaleh.com.br     (VPS: server/, Node.js + WebSocket)
```

## Como funciona

- **A cidade não precisa ser sincronizada:** é gerada com semente fixa (`src/core/random.ts`), igual em
  todos os clientes. Clima, hora e feriados vêm das mesmas APIs reais.
- **Cada cliente manda no próprio carro** (*client-authoritative*) e envia o estado 20× por segundo:
  posição, rotação, velocidade, esterço e flags (freio, ré, turbo, buzina, a pé). São 26 bytes em binário.
- **O servidor não simula nada:** carimba o id de quem mandou e repassa para a sala (até 8 jogadores).
- **Os carros remotos** (`src/net/RemotePlayer.ts`) são desenhados 100 ms no passado e interpolados
  entre os estados recebidos, o que deixa o movimento liso mesmo com a internet oscilando. Se os pacotes
  atrasam, o carro é projetado para frente por até 250 ms. Saltos grandes (tecla R, troca de carro)
  teleportam em vez de arrastar.
- **Uma garagem para cada um:** as Garagens do Tribunal são 8, numa rua de serviço saindo da pista do
  Eixo (`GARAGES` em `src/world/city/layout.ts`). No solo vale a garagem 1; no multiplayer o servidor dá
  a cada jogador a menor garagem livre da sala, e a frota e o Josué vão para lá. Oficina, lavagem,
  imunidade e o começo de cada dia usam a garagem do jogador. Desligando o online, volta para a garagem 1.
- **Colisão:** cada carro remoto tem um corpo cinemático no Rapier. O seu carro bate nele e sente o
  tranco do seu lado; o outro jogador sente do lado dele.
- **A pé:** o outro jogador aparece como um marcador simples, com o apelido em cima (o avatar animado
  fica para a próxima etapa).
- **Servidor fora do ar:** o jogo segue no modo solo e tenta reconectar sozinho (2 s, 4 s, 8 s… até 30 s).

## Perseguidores compartilhados

Todos veem os mesmos carros das facções e da imprensa. Polarização e suspeição continuam de cada um:

- **Cada perseguidor tem um alvo:** o jogador que o atraiu (pelo próprio calor ou pela própria
  suspeição). Tomates, fotos, batidas e despistes só afetam esse jogador. Os outros veem a perseguição
  passar e podem bater nos carros.
- **Anfitrião:** o servidor escolhe um jogador por sala (o mais antigo). O computador dele roda a IA e a
  física de todos os perseguidores (`factions/Pursuers.ts`, modo autoridade) e transmite as poses
  20× por segundo. Os outros ficam em modo réplica: desenham as poses interpoladas, com corpo cinemático.
- **Pedidos:** cada jogador manda ao anfitrião quantos perseguidores quer (`want`), calculado do mesmo
  jeito que no solo (`allocateWants`). O anfitrião divide o pool (6 carros, `PURSUER_MODELS`) entre a sala.
- **Eventos:** o anfitrião manda a cada alvo só o que o atinge (`pev`: spawn, escape, photo, tomato,
  ram) e a todos os tomates em voo (`tomato`, só visual). Buzinas e flashes viajam como bits que trocam de
  valor nas poses.
- **Imunidade da garagem e novo dia:** o jogador manda `clear` e o anfitrião tira os perseguidores dele.
- **Troca de anfitrião:** se ele sair, o servidor avisa a sala (`host`) e o próximo assume. As
  perseguições em andamento recomeçam do zero (quem ainda estiver "quente" volta a ser perseguido).
- **Offline:** o próprio jogo é o anfitrião de um alvo só; nada muda em relação ao solo.

Limitações conhecidas:
- Com o anfitrião pausado, os perseguidores param para todos.
- Se o anfitrião tiver internet ruim ou poucos quadros por segundo, os perseguidores ficam travados
  para todos.

| Arquivo | Papel |
| --- | --- |
| `src/net/protocol.ts` | Mensagens e formato binário (compartilhado com o servidor) |
| `src/net/NetClient.ts` | WebSocket do navegador, reconexão |
| `src/net/SnapshotBuffer.ts` | Fila de estados recebidos e interpolação (jogadores e perseguidores) |
| `src/net/RemotePlayer.ts` | Carro/marcador remoto, corpo cinemático, apelido |
| `src/net/Multiplayer.ts` | Liga tudo ao `Game`; papel na sala (offline, anfitrião, réplica) e perseguição |
| `src/factions/Pursuers.ts` | Perseguidores: IA com vários alvos (anfitrião) ou réplica |
| `server/index.ts` | Servidor: salas, repasse, limites |

O jogador liga em **Pausa → Online** (desligado por padrão) e escolhe o apelido.

## Rodar localmente

Requisito: Node.js 24 ou mais novo (roda o TypeScript do servidor direto, sem build).

```bash
cd server && npm install && cd ..   # só na primeira vez
npm run server                      # servidor em ws://localhost:8787 (reinicia ao salvar)
npm run dev                         # jogo em http://localhost:5173 (usa ws://localhost:8787 em dev)
```

Abra o jogo em duas abas (ou dois navegadores), ligue **Pausa → Online** em cada uma e entre num carro.

Para testar internet ruim, simule atraso e perda no repasse:

```bash
SIM_LATENCY_MS=150 SIM_LOSS=0.05 node server/index.ts
```

Checagem de tipos do servidor: `npm run typecheck:server`.

## Configuração

| Onde | Variável | Padrão |
| --- | --- | --- |
| Jogo (build) | `VITE_MP_URL` | `wss://mp.matheussaleh.com.br` (em dev: `ws://localhost:8787`) |
| Jogo (build) | `VITE_MP_ENABLED` | ausente: a aba **Online** some no build de produção (em dev aparece sempre) |
| Servidor | `PORT` | `8787` |
| Servidor | `ALLOWED_ORIGINS` | site, `supremo-motorista.vercel.app`, `app://game` (desktop); localhost sempre liberado |
| Servidor | `MAX_CLIENTS` | `200` (o `server/docker-compose.yml` de produção usa `40`) |

**Limites do servidor:**
- até 80 mensagens por segundo por jogador; quem insiste além disso é desconectado;
- pacotes de no máximo 1 KB;
- `hello` obrigatório em 5 s;
- ping a cada 10 s, e quem não responde cai;
- apelidos limpos: até 16 caracteres, só letras, números, espaço, `.`, `-` e `_`;
- poses de perseguidores, eventos e tomates só são aceitos do anfitrião da sala.

## Instalar na VPS

O servidor roda num container (`server/Dockerfile` e `server/docker-compose.yml`), atrás do Nginx da
VPS e do Cloudflare. Assim o Node não precisa ser instalado na máquina, e o multiplayer fica isolado dos
outros serviços dela: rede própria, porta só em `127.0.0.1`, usuário sem privilégios, sistema de
arquivos só leitura e limites de memória (128 MB), CPU (30% de um núcleo) e conexões (40).

```
navegador ── wss ──> Cloudflare (proxy) ── https ──> Nginx da VPS ── ws ──> 127.0.0.1:8787 (container)
```

Os comandos supõem Ubuntu com Docker e Nginx já instalados, o domínio `matheussaleh.com.br` no
Cloudflare e um usuário no grupo `docker`.

> **Firewall:** não é preciso abrir nada. Se a VPS só aceita as portas 80/443 vindas do Cloudflare,
> **não rode** `ufw allow 'Nginx Full'`: isso abre essas portas para a internet inteira e expõe todos os
> sites da máquina sem passar pelo Cloudflare. A porta 8787 nunca é aberta: só o Nginx fala com ela.

### 1. DNS e certificado (Cloudflare)

1. **DNS → Registros:** registro **A** `mp` → IP da VPS, com o proxy **ligado** (nuvem laranja). O
   Cloudflare repassa WebSocket em todos os planos, e o ping de 10 s do servidor mantém a conexão aberta
   (o Cloudflare fecha conexões paradas por mais de 100 s).
2. **SSL/TLS → Visão geral:** modo **Completo (estrito)**.
3. **SSL/TLS → Servidor de origem → Criar certificado:** RSA, nomes `*.matheussaleh.com.br` e
   `matheussaleh.com.br`, 15 anos. Salve na VPS:

```bash
sudo mkdir -p /etc/ssl/cloudflare && sudo chmod 700 /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/matheussaleh-origin.pem   # "Certificado de origem"
sudo nano /etc/ssl/cloudflare/matheussaleh-origin.key   # "Chave privada" (só aparece uma vez)
sudo chmod 600 /etc/ssl/cloudflare/matheussaleh-origin.*
```

O certificado de origem só é aceito pelo Cloudflare, por isso o proxy precisa ficar ligado. Se já houver
um certificado para `*.matheussaleh.com.br` na máquina, use o mesmo.

### 2. Código e container

```bash
sudo mkdir -p /opt/supremo-mp && sudo chown "$USER" /opt/supremo-mp
git clone --depth 1 https://github.com/MatheusSaleh/supremo-motorista.git /opt/supremo-mp/app
cd /opt/supremo-mp/app/server
ss -ltnp | grep ':8787' || echo "8787 livre"            # se estiver ocupada: MP_PORT=8788 no comando abaixo
COMPOSE_PARALLEL_LIMIT=1 nice -n 19 docker compose up -d --build
docker compose ps                                       # "healthy" depois de uns 10 s
docker compose logs mp                                  # "multiplayer ouvindo na porta 8787"
```

Conferências de isolamento:

```bash
ss -ltnp | grep 8787                                    # só 127.0.0.1:8787
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/   # 426: o servidor só fala WebSocket
docker stats --no-stream supremo-mp                     # limite de 128 MiB
```

### 3. Nginx (wss://)

Use [`server/nginx.conf.example`](../server/nginx.conf.example). Ele só deixa passar o WebSocket na raiz
(o resto é fechado sem resposta) e limita conexões por IP: até 4 abertas e 20 novas por minuto. Sem
isso, um único cliente poderia ocupar as 40 vagas do servidor.

```bash
sudo cp /opt/supremo-mp/app/server/nginx.conf.example /etc/nginx/sites-available/mp.matheussaleh.com.br
sudo ln -s /etc/nginx/sites-available/mp.matheussaleh.com.br /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Os limites por IP dependem de o Nginx enxergar o IP real do jogador, e não o do Cloudflare
(`real_ip_header CF-Connecting-IP` com as faixas do Cloudflare em `set_real_ip_from`).

### 4. Ligar a opção no site

Na Vercel, no projeto do jogo: **Settings → Environment Variables**, crie `VITE_MP_ENABLED` = `true`
(Production) e faça um **Redeploy**. Até isso, a aba Online não aparece no site.

### 5. Testar

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://mp.matheussaleh.com.br/   # 520 ou 444: sem WebSocket, fechado
```

Abra o jogo no site em dois navegadores, ligue **Pausa → Online** nos dois e confira se um vê o carro
do outro. Logs: `cd /opt/supremo-mp/app/server && docker compose logs -f mp`.

### Atualizar

```bash
cd /opt/supremo-mp/app && git pull
cd server && COMPOSE_PARALLEL_LIMIT=1 nice -n 19 docker compose up -d --build
docker image prune -f
```

Se `PROTOCOL_VERSION` mudar, quem estiver com a página antiga recebe o aviso para recarregar.
