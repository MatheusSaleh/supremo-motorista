# Como contribuir

Obrigado pelo interesse no Supremo Motorista! Este guia explica como rodar o projeto, o que se espera de
uma contribuição e as regras de conteúdo, que não são negociáveis.

## Antes de começar

- Leia o [README](README.md), o [roteiro](docs/ROADMAP.md) e a [arquitetura](docs/ARQUITETURA.md).
- Para algo grande (uma fase nova, um sistema, uma dependência nova), **abra uma issue antes** para combinar
  a abordagem. Correções e melhorias pequenas podem ir direto num pull request.

```bash
npm install
npm run dev     # jogo + painel de debug em http://localhost:5173
npm run build   # precisa passar antes do PR (checagem de tipos + build)
```

## Repositórios

O projeto existe em dois repositórios privados, mantidos iguais:

- `MatheusSaleh/supremo-motorista` (pessoal)
- `nexolabs-dev/supremo-motorista` (organização)

Na máquina do mantenedor, `git push` envia para os dois de uma vez (o `origin` tem duas URLs de envio).
De qualquer máquina, `npm run sync` traz o que houver de novo em um dos lados e atualiza o outro. Ele só
avança o histórico (nunca força); se os dois divergiram, avisa e não mexe.

Para configurar o envio duplo num clone novo:

```bash
git remote set-url --add --push origin git@github.com:MatheusSaleh/supremo-motorista.git
git remote set-url --add --push origin git@github.com:nexolabs-dev/supremo-motorista.git
```

## Regras de conteúdo

O jogo é uma sátira política **totalmente fictícia**. Pull requests que quebrem estas regras não são
aceitos:

1. **Nada de nomes reais** de pessoas, partidos, bancos ou processos judiciais. O tribunal é "o Tribunal"; os
   grupos políticos são só **Azuis** e **Vermelhos**; o banqueiro é o **Dr. Rubens Caixeta**, do **Banco
   Confiança S.A.**
2. **Marcos e instituições reais** (Congresso, TST, PGR, Torre de TV…) aparecem com o nome real **só como
   cenário**: nunca em corridas, falas, manchetes ou piadas.
3. **Violência só no pastelão:** tomate, empurrão, carro rodando. Nada de armas, sangue ou violência real.
4. **Sem preconceito.** A sátira mira o poder e a burocracia, não grupos de pessoas.
5. **Todo texto visível vai no i18n** (`src/data/i18n/`), nunca escrito direto no código.

## Código

- **Linguagem:** TypeScript em modo strict, three.js puro, Rapier e Vite. **Nenhuma dependência nova** sem
  justificativa aprovada numa issue.
- **Estilo:** siga o código ao redor. Comentários em português, explicando o *porquê*, na mesma densidade
  dos arquivos existentes.
- **Dados e ajustes:** constantes ajustáveis em `src/config.ts`; dados de jogo em `src/data/`.
- **Desempenho:** nada que crie luzes ou ligue sombras depois do carregamento, porque isso recompila os
  shaders (ver "Princípios" em [ARQUITETURA.md](docs/ARQUITETURA.md)). Teste também na qualidade Baixa.
- **PRs:** pequenos e focados, com descrição do que muda e de como testar. Imagens ou GIFs ajudam muito em
  mudanças visuais.

## Recursos de terceiros (modelos, sons, texturas)

- **Licenças aceitas:** só CC0 ou CC BY (ou equivalente que permita uso comercial e modificação). Nada com
  "NC" (não comercial) ou "ND" (sem derivados), nada de conteúdo extraído de outros jogos.
- **Créditos:** registre cada arquivo no [CREDITS.md](CREDITS.md) com autor, link, licença e as alterações
  feitas.
- **Modelos:** carros e personagens passam pelo conversor (`tools/conversor-modelos/`, ver
  [ASSETS.md](docs/ASSETS.md)).

## Licença das contribuições

Ao enviar uma contribuição (código, texto, arte ou som de autoria própria), você declara que tem o direito
de enviá-la e concorda que:

- **código:** é licenciado sob a licença **MIT** do projeto;
- **textos e conteúdo criativo:** são licenciados sob **CC BY-NC-SA 4.0**, como o restante do conteúdo;
- **uso pelo autor:** você concede ao mantenedor (Matheus Saleh) o direito permanente, mundial e gratuito de
  usar, modificar, relicenciar e distribuir sua contribuição, **inclusive comercialmente**, por exemplo numa
  versão do jogo vendida em lojas como a Steam.

Seu nome entra nos créditos do jogo se a contribuição for incorporada.
