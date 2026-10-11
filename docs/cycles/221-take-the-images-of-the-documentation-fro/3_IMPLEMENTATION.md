# As cinco telas da documentação saem limpas do workspace semeado, e duas capturas seguidas escrevem os mesmos arquivos

Esta tentativa retomou a anterior, interrompida quando o app reiniciou. O que faltava era a cerimônia (a imagem
fotografava a falha do agente, com o nome do fornecedor do modelo) e a igualdade byte a byte entre duas execuções.
As duas estão fechadas e conferidas.

## O que mudou

### A cerimônia mostra o turno semeado, e nenhum modelo é chamado

O app serve de novo um turno guardado quando a impressão digital do cartão bate e o turno é recente
(`fingerprint`/`isReusable`, `src/main/falas-core.ts`). A semente passa a escrever, em `falas.json`, um turno
pronto por cartão da cerimônia, com a impressão digital calculada como o app calcula e datado da véspera do dia
fixo (`savedTurns`, `cardFingerprint`, `scripts/seed-docs-workspace.mjs`). Os cartões semeados passam a ter a
forma que o app lê (`Card`), e as linhas da transcrição levam o minuto da chamada (`0:00`), como o app as escreve.

O relógio do processo principal fica no dia da semente (`fixMainClock`, `scripts/captures/run.mjs`): é ali que o
app decide qual é a cerimônia de hoje e se um turno ainda serve. A captura de `call` espera o turno semeado e
recusa a foto se a tela mostrar um provedor (`llm.`); a frase do painel de efeitos que nomeia a ferramenta do
fornecedor sai da página por extração de texto antes da foto.

### Duas execuções escrevem os mesmos arquivos

Cinco das dez imagens variavam de uma execução para a outra, por duas causas:

- **o tempo decorrido da cerimônia** ("Ao vivo · 0:02" contra "0:03", e o minuto de uma linha da transcrição).
  O relógio da janela aceita agora ficar parado (`standingClock(iso, still)`); um roteiro que desenha tempo
  decorrido exporta `STILL_CLOCK` e a janela dele não anda. Os temporizadores continuam a disparar, porque não leem
  esse relógio. Só `call.mjs` o usa;
- **um tom de diferença em poucas dezenas de pixels** (bordas arredondadas e texto), da rasterização. Os dois
  arranques do app e o navegador do celular passam a receber `SAME_PIXELS` (`scripts/captures/shared.mjs`):
  sem GPU, perfil de cor sRGB, sem texto subpixel, um fio de rasterização, sem rasterização parcial e sem as
  otimizações de tempo de execução do Skia. As quatro primeiras sozinhas não bastaram; com as três últimas, a
  variação sumiu.

### Pequenos acertos

- O comentário do dia fixo da semente dizia sábado; `2026-06-15` é segunda-feira.
- `test/seed-docs-workspace.test.ts` ganhou o caso que confere que cada cartão da cerimônia semeada tem um turno
  que o app serve de novo no dia da semente.

## O que foi verificado, com o comando

- `npx electron-vite build` — sai 0.
- `node scripts/captures/run.mjs` três vezes, cada uma sobre um folder semeado na hora: a segunda e a terceira
  comparadas com a primeira por `cmp`, **as dez imagens iguais byte a byte** (ev-84). Antes das mudanças desta
  tentativa, duas execuções davam cinco imagens diferentes; a comparação de pixels mostrou as duas causas acima.
- `call.png` aberta: a cerimônia com a pauta, o cartão `#124`, o turno semeado (Andou, Próximo, Bloqueio, Para
  você), "Ao vivo · 0:00", nenhum aviso de falha e nenhum nome de fornecedor (ev-85; `call-en`, `today`, `phone`
  já vistas pela tentativa anterior em ev-79 a ev-82).
- `npx tsc --noEmit`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/docs-images-check.mjs` —
  saem 0.
- `node scripts/public-audit.mjs` — sai 0, 1669 arquivos.
- `npx vitest run` — 7301 testes passam; 2 reprovam em `test/browser-sites.test.ts` (4 arquivos de navegador)
  porque `@playwright/mcp` não está instalado neste computador, o mesmo estado da base. Não é regressão.
- A árvore de trabalho só tem arquivos rastreados alterados; as cópias de comparação ficaram na pasta de saída.

## O que não foi verificado

- Aceitação 4: uma etapa com `display: true` rodar a captura (na sandbox e no computador) e guardar cada imagem
  como comprovação.
- Aceitação 6: um release refazer as imagens e o pull request mostrar só as que mudaram.
- A igualdade byte a byte em outro computador: foi conferida só neste. As chaves de rasterização reduzem a
  dependência da máquina, mas uma fonte ou um Chromium diferentes podem mudar os pixels.
- A ressalva da revisão sobre a conferência de referências (uma página com caminho relativo não é reconhecida)
  continua sem mudança.
