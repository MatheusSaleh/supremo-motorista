# syntax=docker/dockerfile:1
#
# Servidor do multiplayer num container (ver "Instalar na VPS" em docs/MULTIPLAYER.md).
# O contexto do build é a raiz do repositório, porque o servidor importa src/net/protocol.ts:
#   docker build -f server/Dockerfile -t supremo-mp .
# Server/Dockerfile.dockerignore deixa entrar só os quatro arquivos que o servidor usa.
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8787
WORKDIR /app

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server/index.ts server/
COPY src/net/protocol.ts src/net/
# protocol.ts fica fora de server/: sem isto o Node não sabe que ele é um módulo ES.
RUN echo '{"type":"module"}' > package.json

# Usuário sem privilégios da própria imagem.
USER node
EXPOSE 8787

# Pedido HTTP comum (sem Upgrade): o ws responde 426, sinal de que está de pé.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)).then(r=>process.exit(r.status===426?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.ts"]
