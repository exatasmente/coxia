# Os minutos do dia mostram as perguntas que ficaram sem resposta em dias anteriores

Implementação de 1_SPEC.md (seguindo 2_PLAN.md). Código, testes e catálogos prontos e verificados pelos comandos das tentativas; a primeira tentativa havia escrito a maior parte do código, a segunda conferiu as mudanças e rodou os gates completos, e a terceira fechou o bloqueante da revisão com o teste que faltava.

## O que foi implementado

- Pareamento da pergunta-forma: o instantâneo por versão (`snapshotOf`, em `src/shared/minutesVersions.ts`) guarda agora `stage` junto de cada pergunta sem resposta; o assunto sem modelo é o par **ref + estágio**, e o squad do turno circula junto. `mergeDay` preserva o estágio e, num índice de dia escrito antes do campo, busca-o na lista de `covered` da mesma versão (sem estágio conhecido, `null` — pareia só pela atividade); o índice continua `version: 1`, nada antigo é reescrito.
- Regra pura da repetição: `repeatedUnanswered(date, today, previousDays)` compara a pergunta sem resposta do dia com até sete dias anteriores que têm índice, conta repetição só entre dias diferentes, nunca cruza squads, e devolve para cada item a pergunta mais recente, o estágio, as datas em ordem crescente e a contagem de dias. Sem repetição, lista vazia.
- Dados do dia: `src/main/minutesStore.ts` ganha `previousDayAnswers` (lê os índices dos dias anteriores, nunca cria um para dia vazio e salta dia corrompido), `dayEntries`, `dayRepeats` e `crossDayRepeats`; `dayView` leva `repeated: RepeatedQuestion[]` à janela.
- Documento do dia: `writeDayFile` anexa, depois das partes das versões, uma seção ao nível do dia ("## Perguntas repetidas sem resposta") com uma linha por item — pergunta, ref, datas e contagem — só quando há repetição; o arquivo de cada versão fica como está, e dias antigos não são reescritos.
- Tela: o bloco do dia em `src/renderer/src/screens/MinutesParts.tsx` mostra, depois das perguntas sem resposta do dia e só quando há repetidas, o título com a contagem e um item por pergunta: ref em mono, texto, datas e contagem de dias. Cores só por tokens do tema.
- Aviso à cerimônia: `prepareTurn` (em `src/main/agents.ts`) calcula `crossDayRepeats` do cartão e o prompt do turno ganha a nota "Esta decisão já ficou sem resposta nos dias anteriores: …" pelo novo slot `{crossDay}` em `prompt.sdd.turn.main`, e pelo fim de `earlierText` no caminho do mesmo dia. O reuso de turno de dia anterior (`reusableTurn`) volta antes do prompt e não leva a nota nesta rodada (limitação declarada no plano).
- Catálogos: chaves novas em `src/shared/i18n/minutes.pt-BR.json` / `minutes.en.json` (`minutes.day.repeated*`, `minutes.file.repeated.*`, `prompt.sdd.turn.crossDay`) e o `prompt.sdd.turn.main` dos dois catálogos com `{crossDay}`. O teste de catálogos intencionais (`test/gitlab-catalogs-unchanged.test.ts`) foi atualizado com o motivo.
- `CHANGELOG.md`: entrada em `## [Unreleased]`.

## Testes (um por comportamento)

- `test/minutes-repeat.test.ts` (novo) — o núcleo puro: pareia dias diferentes com textos não idênticos; não pareia quando o estágio mudou; nada em comum → vazio; duas vezes o mesmo dia → não repetida; pergunta resolvida não entra; squads diferentes não pareiam; índice sem estágio pareia pela atividade e o estágio cai de `covered`.
- `test/minutes-versions.test.ts` — `snapshotOf` guarda o estágio; `mergeDay` o preserva e faz o `covered` de índice antigo.
- `test/minutes-store.test.ts` — ida e volta do estágio no índice do dia; leitura de índice antigo; `dayView().repeated` com dois dias; `writeDayFile` escreve a seção só com repetidas, depois das versões, e não reescreve o documento do dia antigo; `previousDayAnswers` lê até sete dias e salta o dia que a pasta segura sem índice (só o arquivo antigo do dia) e o dia com índice corrompido, sem criar índice para eles — teste novo de 2026-10-09, que fecha o bloqueante da revisão; `crossDayRepeats` só na pergunta que repetiu.
- `test/same-day.test.ts` — a nota cruzada chega ao prompt, no caminho do cartão novo e no do mesmo dia.

## O que foi rodado na tentativa de 2026-10-09 (bloqueante da revisão)

- `npx vitest run test/minutes-store.test.ts` — 28 testes, todos passaram (inclui o teste novo do salto de dia sem índice e do índice corrompido).
- `npx tsc --noEmit` — passou, sem erros.

## O que foi rodado na tentativa de 2026-10-09 (retomada)

- `npx tsc --noEmit` — passou, sem erros.
- `npx vitest run` — 312 arquivos, 4899 testes, todos passaram.
- `npm run i18n:lint` — 4809 chaves nos dois idiomas, nos 11 catálogos.
- `node scripts/theme-audit.mjs` — passou (contraste 4.5:1 nos dois temas, 55 pares; nenhum literal novo na tela).
- `node scripts/public-audit.mjs` — 1278 arquivos, nada que mexa em empresa ou pessoa.

## Não verificado

- Nenhum critério de aceite foi exercitado na tela com o app rodando: o comportamento da tela foi conferido pela leitura do render do bloco do dia, pelo typecheck e pelos dados do `dayView` nos testes, não por uma sessão interativa de interface. O gate de build do Electron (`electron-vite build`) também não rodou — pertence ao CI.
- Na tentativa que tratou o bloqueante, a suíte completa de testes e os demais gates não foram rodados de novo (só o arquivo de teste tocado e o typecheck).
- Os números da issue (127 na semana; 5–8 nos dias de exemplo) continuam sem ser reproduzidos neste ciclo.
