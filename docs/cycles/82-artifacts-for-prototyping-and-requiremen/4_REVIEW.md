# Os três documentos do ciclo seguem sem tocar no núcleo, e o nome de um deles agora é do aplicativo

## O que foi revisado

A correção do achado bloqueante da rodada anterior e, com ela, a mudança inteira: os documentos de requisitos, protótipo e manual do usuário declarados por um plugin que vem com o aplicativo, e a fase e o portão que passam a lê-los. O diff tem 77 arquivos (sem a pasta do ciclo), 1009 linhas acrescentadas e 254 removidas.

Leitura feita nesta rodada: `src/shared/plugins/declaration.ts` (o tipo de documento com `flow` e `chain`), `src/main/plugins/read.ts` (a leitura das duas pastas e a recusa), `src/main/plugins/runtime.ts` (a guarda de escrita e a fonte do documento), `src/main/plugins/types.ts`, `src/main/plugins/module.ts`, `src/main/gate.ts`, `src/main/cards.ts`, `src/main/index.ts`, `src/renderer/src/screens/Gate.tsx`, `src/shared/plugins/phase.ts`, `src/shared/cycles/templates/agentFlow.ts`, `src/shared/config/migrations.ts`, `src/shared/config/types.ts`, os catálogos `en.json`/`pt-BR.json` e `main.en.json`/`main.pt-BR.json`, a declaração embutida `plugins/cycle-artifacts/`, `src/main/paths.ts`, `electron-builder.yml`, `CHANGELOG.md` e `docs/`.

## O bloqueante da rodada anterior foi fechado

O achado era: um plugin de terceiro que declarasse um nome de documento do fluxo, como `USER_MANUAL.md`, gravava por cima do manual que o aplicativo acabara de produzir. A correção está no código e verificada por teste:

- `chain` marca o documento lido da pasta do aplicativo (`src/shared/plugins/declaration.ts:35-36`), e `readFolder` o grava em todo documento que vem de lá (`src/main/plugins/read.ts:114`).
- `readPlugins` recolhe os nomes dos documentos `chain` das declarações do aplicativo que são puras e estão ligadas e recusa, com o motivo, a declaração da pasta do workspace que ofereça um deles: `enabled: false`, `refused` preenchido e nada oferecido (`src/main/plugins/read.ts:149-155`). Com a pasta do aplicativo ausente, ou com a declaração dela desligada, nada é retido.
- `writePluginDocument` recusa escrever um documento `chain`, como segunda barreira (`src/main/plugins/runtime.ts:106-107`).
- O motivo é chave de catálogo nos dois idiomas (`main.plugins.refused.flowDocument`) e o registro recusado é excluído em todo caminho de escrita e de evento (`src/main/plugins/module.ts:275`, `:490`, `:636`, `:658`).

Testes desta correção, verdes nesta rodada: `test/plugin-builtin.test.ts` (a recusa com o nome no motivo, a declaração do aplicativo como única fonte, nada retido com ela desligada, nome colateral preservado) e `test/plugin-runtime.test.ts` (o arquivo que a etapa escreveu fica intacto).

## As sugestões da rodada anterior

- A 3 (nomes do dado de prova que citavam outro projeto) foi atendida: `test/plugins-core.test.ts` usa `notes-plugin`/`7_NOTES.md`/`plugins.notesPlugin.document` e hosts neutros.
- A 4 (linha nova no fim dos dois arquivos novos) foi atendida: `plugins/cycle-artifacts/plugin.json` e `README.md` terminam em quebra de linha.
- A 5 (o ouro das cerimônias) segue registrada como risco: nenhum registro de plugin está ligado no momento daquele teste, e nada no diff desta rodada o liga. Fica como o ponto que muda se alguém ligar um plugin naquele caminho.
- A 2 (o artefato do portão a partir do metadado de uma proposta) segue como risco aceito, sem correção, como a rodada anterior decidiu.

## O que passou nos portões (executado nesta rodada)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | sem erros (exit 0) |
| `npx vitest run` (suíte completa) | 416 arquivos verdes, 1 pulado; 6952 testes verdes, 3 pulados |
| os 8 arquivos do núcleo da mudança | 248 testes verdes |
| `test/config-schema.test.ts`, `test/runner-golden.test.ts`, `test/host-gui.test.ts` | 56 testes verdes |
| `node scripts/theme-audit.mjs` | verde |
| `npm run i18n:lint` | 5483 chaves nos dois idiomas, 12 catálogos, nenhum problema |
| `node scripts/public-audit.mjs` | verde em 1591 arquivos, 0 achados |
| `npx electron-vite build` | construído, exit 0 |

## Não verificado

- Os aceites de ponta a ponta com modelos de verdade (execução passando pelo refinamento, pelo plano e pelo fim, com os três documentos na pasta e o manual ao lado da nota de lançamento): exige modelos e um espaço real. O que está provado é a mesma produção com respostas falsas.
- O clique nos botões do portão na janela e o efeito de desligar o plugin na lista sem reiniciar: o mecanismo tem teste (opção por arquivo, artefato escolhido, leitura a cada chamada), a tela não.
- Um quarto tipo instalado e aberto num portão de verdade: coberto por teste de unidade e de função pura, não demonstrado numa tela.
- Um espaço de trabalho real aberto depois da migração: a migração está testada com objetos.
- A recusa de um plugin do espaço de trabalho vista na lista de plugins: o registro e o motivo estão testados; a linha na tela não.

## Veredito

**Aprovado.** O achado bloqueante da rodada anterior está fechado no código e coberto por teste; as sugestões de higiene da rodada anterior foram atendidas; os critérios de aceite seguem atendidos pelo código e pelos testes; os portões fecham verdes e a fronteira de segurança (guarda de caminho, canal, embutido por capacidade, posse do nome do fluxo, caminho do artefato) está contida. Os riscos aceitos (o artefato do portão pelo metadado de uma proposta e o ouro das cerimônias) não travam a entrega. O que resta é verificação de QA, listada acima.
