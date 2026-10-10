# Plano de teste dos documentos de requisitos, protótipo e manual

Cada critério de aceite da especificação vira um cenário. Onde a execução dependia de modelos de
verdade, de uma janela do aplicativo ou de um espaço de trabalho real, o cenário diz o que foi
exercitado e o que ficou só lido no código, e por quê. Nenhum arquivo do produto foi alterado para
testar.

## Como cada cenário foi exercitado

- **Testes do repositório** (verdes nesta etapa): suíte completa — 417 arquivos, 6955 testes, 6918
  verdes, 34 pulados, 3 vermelhos (dois arquivos, ambiente — ver o cenário 20); e o lote dos arquivos
  da mudança — 9 arquivos, 253 testes, todos verdes.
- **Portões da mudança** (verdes nesta etapa): `npx tsc --noEmit`, `scripts/theme-audit.mjs`,
  `npm run i18n:lint` (5483 chaves nos dois idiomas), `scripts/public-audit.mjs` (1592 arquivos) e
  `npx electron-vite build`.
- **Vetores de caixa-preta**: um roteiro descartável, guardado fora da worktree, chamou o código de
  produção desta árvore (leitor da declaração, junção da fase, leitor da fase do cartão, lista de
  portões, escolha do artefato, leitura das duas pastas de plugin e a guarda de escrita) e conferiu a
  saída de 19 casos. Nada foi mexido no produto; o roteiro não ficou na worktree.
- **Tela**: nenhum cenário rodou na janela do aplicativo. O binário do Electron não existe nesta
  máquina e o host de onde ele se baixa está bloqueado pela rede da sandbox (o registro de pacotes
  responde, a liberação de versão não). Isso é dito em cada cenário que dependeria da tela.

## Cenários

### 1. O plugin embutido declara os três documentos, cada um no seu portão e na sua âncora

**O que fazer.** Ler a declaração que vem com o aplicativo (`plugins/cycle-artifacts/plugin.json`)
com o leitor de declarações e a leitura das duas pastas de plugin.

**O que esperar.** A declaração é aceita; oferece exatamente `REQUIREMENTS.md` (portão 1, antes de
`1_SPEC.md`), `PROTOTYPE.md` (portão 2, antes de `2_PLAN.md`) e `USER_MANUAL.md` (sem portão, antes
de `6_RELEASE_NOTE.md`); sem código, sem eventos e sem nota para os agentes.

**Resultado.** Passou. O vetor `builtin-declaration` mostra `refused=null` e os três documentos com
os portões e as âncoras esperados; o `plugin-builtin` do repositório confere o mesmo.

### 2. A pasta que traz só um dos documentos novos mostra a fase daquele documento

**O que fazer.** Pôr três pastas de cartão distintas com só `REQUIREMENTS.md`, só `PROTOTYPE.md` e só
`2_PLAN.md`, com o plugin embutido ligado, e ler a fase de cada uma.

**O que esperar.** Cada pasta mostra a fase do documento que ela traz (requisitos, protótipo, plano);
uma pasta sem nenhum deles mostra a mesma frase de "sem artefato" de hoje; o protótipo fica mais
adiantado que o plano.

**Resultado.** Passou. `phase-requirements-only`, `phase-prototype-above-plan` e `phase-no-documents`
mostram "requisitos escritos", "protótipo escrito" e "plano escrito", e "pasta de spec sem artefato"
para a pasta vazia.

### 3. Um documento colateral não move a fase

**O que fazer.** Juntar à lista de fase um documento sem âncora (o resultado de uma busca) ao lado de
um com âncora e comparar a ordem.

**O que esperar.** O colateral fica fora da lista; o documento de fluxo entra logo acima da sua
âncora; a lista do ciclo mantém a ordem e os rótulos.

**Resultado.** Passou. `collateral-out-of-phase` devolve `2_PLAN.md,REQUIREMENTS.md,1_SPEC.md` — o
`7_WEB_SEARCH.md` não entra.

### 4. O primeiro portão lê os requisitos; o segundo, o protótipo

**O que fazer.** Com uma pasta que traz só `REQUIREMENTS.md`, calcular a lista de artefatos do
primeiro portão e do segundo; depois acrescentar `1_SPEC.md`, `2_PLAN.md`, `PROTOTYPE.md` e
`USER_MANUAL.md` e refazer a conta.

**O que esperar.** Só com os requisitos, o portão 1 já oferece um artefato (hoje ele falharia com uma
pasta só de tipos novos); com os demais, o portão 1 oferece a spec e os requisitos, o portão 2 o plano
e o protótipo; o manual não é artefato de portão nenhum.

**Resultado.** Passou. `gate1-reads-requirements-only`, `gate2-reads-prototype` e
`manual-not-a-gate-artifact`.

### 5. O botão do portão abre o artefato que ele nomeia

**O que fazer.** Com duas opções no portão 1 (spec e requisitos), escolher o artefato pelo arquivo do
botão; e escolher por um arquivo que não é daquele cartão.

**O que esperar.** O arquivo nomeado abre aquele artefato; um arquivo fora do cartão cai de volta na
primeira opção do portão (nada é aberto por parâmetro); sem arquivo, a primeira opção.

**Resultado.** Passou. `pick-by-file`, `pick-rejects-foreign-path` e `pick-default-first`.

### 6. O aplicativo nunca deixa um plugin da pasta do espaço responder por um documento do fluxo

**O que fazer.** Pôr, na pasta de plugins do espaço, um plugin que declare `USER_MANUAL.md` e outro
que declare um nome colateral (`7_NOTES.md`), ler as duas pastas e tentar escrever o manual pelo
plugin.

**O que esperar.** A declaração que responde por um nome do fluxo volta recusada (ligada desligada,
motivo presente, fora de tudo que a fase e o portão leem); o nome colateral continua sendo do plugin;
a escrita do manual pelo plugin é recusada e o arquivo que a etapa escreveu fica intacto; um
documento colateral ainda é escrito.

**Resultado.** Passou. `refused-in-the-list` (o motivo cita `USER_MANUAL.md`),
`refused-does-not-reach-the-readers`, `collateral-name-kept`, `write-guard` e
`collateral-still-written`. Sem a pasta do aplicativo, ou com a declaração dela desligada, nada é
retido — também conferido.

### 7. Desligar o plugin tira os tipos da leitura, sem reiniciar

**O que fazer.** Ler os documentos ligados com o plugin embutido ligado e depois com a escolha
desligada guardada na configuração, sem reiniciar nada.

**O que esperar.** Ligado, os três documentos; desligado, nenhum; a escolha guardada vale nos dois
sentidos.

**Resultado.** Passou. `on-off-without-restart` (3 documentos ligado, 0 desligado). O efeito **na
tela** — ver a fase e o portão mudarem depois de mexer na lista de plugins — não foi exercitado: sem
a janela do aplicativo (cenário 14).

### 8. Um espaço de trabalho antigo ganha os três arquivos na produção; o fluxo editado não muda

**O que fazer.** Migrar um arquivo de configuração na versão anterior, com as listas de produção que
o aplicativo entregava, e migrar outro com uma lista já tocada pela pessoa.

**O que esperar.** As listas iguais às antigas recebem os documentos novos (requisitos no
refinamento, protótipo no plano, manual na etapa que fecha); a lista tocada fica como está, com nota
própria; uma segunda passagem não mexe.

**Resultado.** Passou. `test/config-migrations.test.ts`, dentro do lote de 253 testes verdes.

### 9. A etapa que termina sem um dos seus documentos é pedida uma vez e depois falha

**O que fazer.** Rodar o refinamento com respostas falsas: uma vez deixando o `REQUIREMENTS.md` de
fora, outra faltando só um dos dois documentos.

**O que esperar.** Um pedido nomeando o que falta, na mesma sessão; se o documento não vier, a etapa
falha nomeando-o.

**Resultado.** Passou. `test/runner-missing-documents.test.ts`, no lote verde.

### 10. O fluxo do ciclo de agentes produz os três onde a especificação coloca

**O que fazer.** Ler o `produces` de cada etapa dos dois modelos do ciclo de agentes e os rótulos da
fase e do portão nos dois idiomas.

**O que esperar.** `refine` produz `1_SPEC.md` e `REQUIREMENTS.md`; `plan`, `2_PLAN.md` e
`PROTOTYPE.md`; `communicate`, `6_RELEASE_NOTE.md` e `USER_MANUAL.md`; o modelo de engenharia ganha
os dois primeiros e não ganha o manual; as seis chaves resolvem em pt-BR e em inglês.

**Resultado.** Passou. `test/cycle-templates.test.ts` (no lote verde) e o vetor `labels-resolve`
("Requisitos"/"Requirements", "requisitos escritos"/"requirements written").

### 11. Os portões da mudança fecham verdes

**O que fazer.** Rodar os portões do repositório: tipos, suíte, auditoria de tema, idiomas, área
pública e compilação.

**O que esperar.** Todos verdes.

**Resultado.** Passou, com uma ressalva. `tsc` exit 0; `theme-audit` exit 0; `i18n:lint` 5483 chaves
nos dois idiomas; `public-audit` 1592 arquivos sem achado; `electron-vite build` exit 0. A suíte
completa tem 3 testes vermelhos em dois arquivos, sem relação com a mudança (cenário 20).

### 12. Um quarto tipo de documento, declarado por um plugin da equipe, é lido do mesmo jeito

**O que fazer.** Um tipo de documento qualquer com `flow` (portão e âncora) é lido, entra na fase na
sua âncora e aparece no portão que declarou, sem nenhuma mudança no aplicativo.

**O que esperar.** O mecanismo vale para qualquer tipo com `flow`, não só para os três nomes.

**Resultado.** Passou. Coberto por `test/plugins-core.test.ts`, `test/phase-flow-documents.test.ts` e
`test/gate-plugin-documents.test.ts` (no lote verde) e pelos vetores de fase e de portão, que usam um
nome genérico (`A.md`/`B.md` na função pura). Um quarto tipo **instalado e aberto numa tela** não foi
demonstrado — sem a janela do aplicativo (cenário 14).

### 13. A suíte completa do repositório roda

**O que fazer.** Rodar `npx vitest run` na worktree.

**O que esperar.** Tudo verde.

**Resultado.** 417 arquivos (2 pulados), 6955 testes: 6918 verdes, 34 pulados, 3 vermelhos em
`test/harness-finalize.test.ts` (1) e `test/voice-setup.test.ts` (2) — ambiente, ver o cenário 20.
O lote dos arquivos da mudança (9 arquivos, 253 testes) roda verde isolado.

### 14. Aceites 1 a 3 numa execução de verdade, com modelos

**O que fazer.** Uma execução que passa pelo refinamento, pelo plano e pelo fim, com o documento de
requisitos ao lado da spec, o de protótipo na mesma pasta, o manual ao lado da nota de lançamento, e a
fase do cartão acompanhando cada um.

**O que esperar.** Os três documentos aparecem na pasta do ciclo nas etapas certas; a fase do cartão é
a do documento mais avançado.

**Resultado.** Não rodou. Exige modelos de verdade e a janela do aplicativo (o binário do Electron não
existe nesta máquina e o host de onde ele se baixa está bloqueado pela rede da sandbox). O que se
provou é a mesma produção com respostas falsas (cenários 8, 9 e 10) e a fase lida do código
(cenário 2).

### 15. O clique nos botões do portão, na janela

**O que fazer.** Abrir a tela do portão de um cartão com dois artefatos no mesmo portão, apertar cada
botão e ver qual documento abre a cerimônia.

**O que esperar.** Cada botão abre o artefato que ele nomeia, com o rótulo certo.

**Resultado.** Não rodou. O mecanismo está provado pelos vetores (cenário 5) e pela conferência do
código da tela; a tela não foi exercitada.

### 16. A recusa de um plugin do espaço, vista na lista de plugins

**O que fazer.** Abrir a tela de plugins com um plugin do espaço que declare um nome do fluxo e ler a
linha dele.

**O que esperar.** A linha aparece marcada como recusada, com o motivo, e sem nada oferecido.

**Resultado.** Não rodou na tela. O registro recusado e o motivo estão provados pelos vetores
(cenário 6) e pelos testes; a linha como o aplicativo a desenha não foi vista.

### 17. Um espaço de trabalho real, antigo, abre depois da migração

**O que fazer.** Abrir a pasta de uma pessoa que já usava o aplicativo, com pastas sem os documentos
novos, e conferir as fases e os portões.

**O que esperar.** As mesmas fases e os mesmos portões de sempre.

**Resultado.** Não rodou. A migração está provada com objetos (cenário 8) e o leitor devolve o de hoje
quando não há plugin (vetores); nenhum dado real de pessoa é usado em teste.

### 18. A pasta do aplicativo ausente não derruba a leitura

**O que fazer.** Ler uma pasta de plugins de espaço com a pasta do aplicativo apontada para um lugar
que não existe.

**O que esperar.** A lista traz os plugins do espaço e nada do aplicativo, sem erro.

**Resultado.** Passou. `missing-app-folder` (nenhum plugin, sem erro) e o caso equivalente no
`plugin-builtin` do repositório.

### 19. A declaração recusa um `flow` que não presta

**O que fazer.** Declarar um documento com portão fora de 1/2, com `before` vazio, com pasta ou com
`flow` sem nada dentro, e ler.

**O que esperar.** Cada caso recusado com o motivo próprio; uma declaração sem `flow` continua
colateral, como hoje.

**Resultado.** Passou. `test/plugins-core.test.ts` (no lote verde).

### 20. Observação: dois arquivos da suíte falham por causa do ambiente da sandbox, não da mudança

**O que fazer.** Rodar a suíte completa e, depois, só os dois arquivos vermelhos; reproduzir a causa
fora da suíte.

**O que esperar.** A falha é do ambiente, não da mudança.

**Resultado.** Confirmado. `test/harness-finalize.test.ts` conta caminhos locais reescritos; o
diretório temporário da sandbox (`/tmp`/`/dev/shm`) é pequeno e o caminho da raiz cai dentro dele, e a
redação em prosa transforma esse caminho em `~` antes da contagem — fora da suíte, o mesmo texto dá
`paths=0`. `test/voice-setup.test.ts` falha com `disk-low`: os 512 MiB do tmpfs ficam abaixo da
margem que o fluxo de voz exige. Nenhum dos dois toca em nada desta mudança.

## Resumo

| Cenário | Resultado | Comprovação |
|---|---|---|
| 1. A declaração embutida e os três tipos | passou | ev-16, ev-19 |
| 2. Fase de uma pasta com um só documento novo | passou | ev-16 |
| 3. Colateral fora da fase | passou | ev-16 |
| 4. Portão 1 lê requisitos, portão 2 lê protótipo | passou | ev-16 |
| 5. O botão abre o artefato que nomeia | passou | ev-16 |
| 6. Um plugin do espaço não responde por um nome do fluxo | passou | ev-16, ev-19 |
| 7. Desligar tira os tipos da leitura | passou (na leitura; a tela não) | ev-16 |
| 8. Migração de um espaço antigo | passou | ev-19 |
| 9. Etapa sem um dos seus documentos | passou | ev-19 |
| 10. Produção nos dois modelos | passou | ev-16, ev-19 |
| 11. Portões da mudança | passou (3 vermelhos de ambiente) | ev-20, ev-21, ev-22 |
| 12. Um quarto tipo | passou (na leitura; a tela não) | ev-19 |
| 13. Suíte completa | passou com 3 vermelhos de ambiente | ev-17, ev-20 |
| 14. Aceites 1-3 com modelos | não rodou | — |
| 15. Clique dos botões do portão | não rodou | — |
| 16. Recusa vista na lista de plugins | não rodou (na tela) | ev-16 |
| 17. Espaço real antigo | não rodou | — |
| 18. Pasta do aplicativo ausente | passou | ev-16, ev-19 |
| 19. Declaração com `flow` inválido | passou | ev-19 |
| 20. Observação: falhas de ambiente | confirmado | ev-17, ev-18 |

## O que não foi verificado

- Os aceites de ponta a ponta com modelos de verdade e um espaço real (cenários 14 e 17): o binário do
  Electron não existe nesta máquina e o host de onde ele se baixa está bloqueado pela rede da sandbox;
  testar com dado real de pessoa nunca é teste automatizado.
- A janela do aplicativo: o clique nos botões do portão (15), o efeito de desligar o plugin na lista de
  plugins (7) e a recusa vista na lista (16), além de um quarto tipo aberto numa tela (12).
- O que o código não cobre e nenhum vetor tocou: o desenho da tela do portão e o da lista de plugins.
- Risco aceito que segue da revisão (não é critério de aceite): o artefato do portão a partir do
  metadado de uma proposta pode abrir outro artefato calculado do mesmo cartão.

## Resultado dos cenários

- O plugin embutido declara os três documentos, cada um no seu portão e na sua âncora: passou (executado na sandbox) — Lida a `plugins/cycle-artifacts/plugin.json` pelo leitor de declarações: aceita, com REQUIREMENTS.md (portão 1, antes de 1_SPEC.md), PROTOTYPE.md (portão 2, antes de 2_PLAN.md) e USER_MANUAL.md (sem portão, antes de 6_RELEASE_NOTE.md); sem código, sem eventos e sem nota. Os seis rótulos resolvem nos dois idiomas.
- A pasta que traz só um dos documentos novos mostra a fase daquele documento: passou (executado na sandbox) — Pastas com só REQUIREMENTS.md, só PROTOTYPE.md, só 2_PLAN.md e vazia: as fases saem "requisitos escritos", "protótipo escrito", "plano escrito" e "pasta de spec sem artefato". O protótipo fica acima do plano.
- Um documento colateral não move a fase: passou (executado na sandbox) — A junção da fase com um documento sem âncora (7_WEB_SEARCH.md) ao lado de um com âncora devolve 2_PLAN.md,REQUIREMENTS.md,1_SPEC.md: o colateral fica de fora.
- O primeiro portão lê os requisitos; o segundo, o protótipo: passou (executado na sandbox) — Com só REQUIREMENTS.md, o portão 1 já oferece [[1,REQUIREMENTS.md]]; com os demais, o portão 1 oferece 1_SPEC.md e REQUIREMENTS.md e o portão 2 oferece 2_PLAN.md e PROTOTYPE.md; USER_MANUAL.md não é artefato de portão nenhum.
- O botão do portão abre o artefato que ele nomeia: passou (executado na sandbox) — `pickGateOption` abre REQUIREMENTS.md quando o botão o nomeia, cai na primeira opção do portão (1_SPEC.md) para um arquivo fora do cartão (/etc/passwd) e na primeira opção quando nenhum arquivo é nomeado.
- Um plugin do espaço não responde por um documento do fluxo: passou (executado na sandbox) — Um plugin que declara USER_MANUAL.md volta com enabled=false e o motivo citando o nome; um nome colateral (7_NOTES.md) segue do plugin; `writePluginDocument` recusa escrever o manual e o arquivo que a etapa escreveu fica intacto; um colateral ainda é escrito. Sem a pasta do aplicativo, nada é retido.
- Desligar o plugin tira os tipos da leitura, sem reiniciar: passou (executado na sandbox) — Cada leitura lê as pastas de novo: ligado devolve 3 documentos, com a escolha desligada guardada devolve 0, e religar devolve os 3. O efeito na tela (mexer na lista de plugins e ver a fase mudar) não foi exercitado — a janela do aplicativo não está disponível nesta máquina.
- Um espaço de trabalho antigo ganha os três arquivos na produção; o fluxo editado não muda: passou (executado na sandbox) — `test/config-migrations.test.ts` cobre a migração v24→v25: listas iguais às entregues recebem os documentos novos, lista tocada pela pessoa fica intacta com nota própria, segunda passagem não mexe.
- A etapa que termina sem um dos seus documentos é pedida uma vez e depois falha: passou (executado na sandbox) — `test/runner-missing-documents.test.ts` roda o refinamento com respostas falsas: um pedido nomeando o que falta e, persistindo, a etapa falha nomeando o documento.
- O fluxo do ciclo de agentes produz os três onde a especificação coloca: passou (executado na sandbox) — `test/cycle-templates.test.ts` confere o `produces` por etapa nos dois modelos (refine com 1_SPEC.md+REQUIREMENTS.md, plan com 2_PLAN.md+PROTOTYPE.md, communicate com 6_RELEASE_NOTE.md+USER_MANUAL.md; engenharia sem o manual) e as seis chaves nos dois idiomas.
- Os portões da mudança fecham verdes: passou (executado na sandbox) — `npx tsc --noEmit` exit 0; `scripts/theme-audit.mjs` exit 0; `npm run i18n:lint` 5483 chaves nos dois idiomas; `scripts/public-audit.mjs` 1592 arquivos sem achado; `npx electron-vite build` exit 0.
- Um quarto tipo de documento, declarado por um plugin da equipe, é lido do mesmo jeito: passou (executado na sandbox) — O mecanismo é genérico: um tipo qualquer com `flow` é lido, entra na fase na sua âncora e aparece no portão que declarou (provado por `test/plugins-core.test.ts`, `test/phase-flow-documents.test.ts` e `test/gate-plugin-documents.test.ts`, e pela função pura com nomes genéricos). Um quarto tipo instalado e aberto numa tela não foi demonstrado.
- A suíte completa do repositório roda: passou (executado na sandbox) — 417 arquivos (2 pulados), 6955 testes: 6918 verdes, 34 pulados, 3 vermelhos em test/harness-finalize.test.ts e test/voice-setup.test.ts — ambiente (ver o cenário das falhas de ambiente). O lote dos arquivos da mudança (9 arquivos, 253 testes) roda verde isolado.
- Aceites 1 a 3 numa execução de verdade, com modelos: não rodou (lido) — Não rodou: exige modelos de verdade e a janela do aplicativo. O binário do Electron não existe nesta máquina e o host de onde ele se baixa está bloqueado pela rede da sandbox. O que se provou é a mesma produção com respostas falsas e a fase lida do código.
- O clique nos botões do portão, na janela: não rodou (lido) — Não rodou: a janela do aplicativo não está disponível. O mecanismo (escolha por arquivo, queda para a primeira opção do portão) está provado pelos vetores; o clique na tela não foi exercitado.
- A recusa de um plugin do espaço, vista na lista de plugins: não rodou (lido) — O registro recusado e o motivo estão provados pelos vetores; a linha como o aplicativo a desenha não foi vista — sem a janela do aplicativo.
- Um espaço de trabalho real, antigo, abre depois da migração: não rodou (lido) — Não rodou: a migração está provada com objetos e o leitor devolve o de hoje quando não há plugin; nenhum dado real de pessoa é usado em teste.
- A pasta do aplicativo ausente não derruba a leitura: passou (executado na sandbox) — Ler com a pasta do aplicativo apontada para um lugar inexistente devolve nenhum plugin e não falha; os plugins do espaço seguem lidos.
- A declaração recusa um `flow` que não presta: passou (executado na sandbox) — `test/plugins-core.test.ts` cobre portão fora de 1/2, before vazio, before com pasta e flow sem nada dentro; uma declaração sem flow continua colateral.
- Os três vermelhos da suíte são de ambiente, não da mudança: passou (executado na sandbox) — `test/harness-finalize.test.ts` conta caminhos reescritos e o temporário da sandbox cai em /tmp e /dev/shm: a redação em prosa transforma o caminho em `~` antes da contagem (reproduzido fora da suíte, paths=0). `test/voice-setup.test.ts` falha com `disk-low` (512 MiB do tmpfs abaixo da margem do fluxo de voz). Isolados, 3 falhas em 26 testes; nenhum toca na mudança.
