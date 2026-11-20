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
| Servidor | `MAX_CLIENTS` | `200` |

**Limites do servidor:**
- até 80 mensagens por segundo por jogador; quem insiste além disso é desconectado;
- pacotes de no máximo 1 KB;
- `hello` obrigatório em 5 s;
- ping a cada 10 s, e quem não responde cai;
- apelidos limpos: até 16 caracteres, só letras, números, espaço, `.`, `-` e `_`;
- poses de perseguidores, eventos e tomates só são aceitos do anfitrião da sala.

## Instalar na VPS (Ubuntu)

Os comandos abaixo supõem Ubuntu 22.04/24.04, acesso com `sudo` e o domínio `matheussaleh.com.br`.

### 1. DNS

Crie um registro **A** `mp` → IP da VPS, onde o DNS do domínio é gerenciado (Vercel ou Registro.br).
Confira com `dig +short mp.matheussaleh.com.br` antes de seguir.

### 2. Node.js 24 e o código

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx
sudo useradd --system --create-home --home-dir /opt/supremo-motorista --shell /usr/sbin/nologin supremo
sudo -u supremo git clone https://github.com/MatheusSaleh/supremo-motorista.git /opt/supremo-motorista/app
cd /opt/supremo-motorista/app/server && sudo -u supremo npm ci --omit=dev
```

O servidor importa `src/net/protocol.ts`, por isso o repositório é clonado inteiro.

### 3. Serviço (systemd)

`/etc/systemd/system/supremo-mp.service`:

```ini
[Unit]
Description=Supremo Motorista - multiplayer
After=network.target

[Service]
User=supremo
WorkingDirectory=/opt/supremo-motorista/app/server
ExecStart=/usr/bin/node index.ts
Environment=PORT=8787
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now supremo-mp
sudo systemctl status supremo-mp        # deve mostrar "multiplayer ouvindo na porta 8787"
```

### 4. Nginx + certificado (wss://)

`/etc/nginx/sites-available/mp.matheussaleh.com.br`:

```nginx
server {
    listen 80;
    server_name mp.matheussaleh.com.br;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/mp.matheussaleh.com.br /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mp.matheussaleh.com.br     # cria o HTTPS (porta 443) e renova sozinho
```

O certificado é obrigatório: o site é HTTPS, e o navegador bloqueia `ws://` sem criptografia.

### 5. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

A porta 8787 não fica aberta para fora: só o Nginx fala com ela.

### 6. Ligar a opção no site

Na Vercel, no projeto do jogo: **Settings → Environment Variables**, crie `VITE_MP_ENABLED` = `true`
(Production) e faça um **Redeploy**. Até isso, a aba Online não aparece no site.

### 7. Testar

Abra o jogo no site em dois navegadores, ligue **Pausa → Online** nos dois e confira se um vê o carro
do outro. Logs: `journalctl -u supremo-mp -f`.

### Atualizar

```bash
cd /opt/supremo-motorista/app && sudo -u supremo git pull
cd server && sudo -u supremo npm ci --omit=dev
sudo systemctl restart supremo-mp
```

Se `PROTOCOL_VERSION` mudar, quem estiver com a página antiga recebe o aviso para recarregar.
