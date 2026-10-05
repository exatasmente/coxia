# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (`enhancement`). Nada é aplicado em silêncio: aceitar cria um agente comum e editável depois.
- A resposta de quem abriu fechou as quatro decisões de produto e o refino fechou o resto na spec `1_SPEC.md`: a fonte é o histórico já gravado (execuções, comandos permitidos, decisões/atas), sem gravar nada novo na v1 (transcrição das cerimônias fica para depois); o registro fica nos dados do workspace, por sugestão, sem prazo, com proposta + evidência + decisão + quem + quando, e a recusa guarda a impressão (papel + etapa + tipo de evidência); a proposta aparece em Ações com nome, papel, etapa, rascunho de prompt, permissões no mínimo e evidência com links, com os três caminhos (aceitar cria agente comum; editar abre o editor em Configurações › Time preenchido; recusar pede motivo opcional); e é oferecida a pedido (botão "Sugerir agentes" em Configurações › Time) e no fim da retro (no máximo duas).
- O plano técnico (`2_PLAN.md`) fechou os pontos de desenho: etapa sempre **existente** (`devCycle.stages`/`flows`), sem caminho novo de fluxo e sem tocar `runs:migrateFlow`; a fonte comando lê a linha de auditoria (`kind: 'exec'`); o registro em `suggestions.json` (dado do workspace, irmão de `acoes.json` — sem migração de schema); a proposta como tipo de ação novo (`kind: 'suggest-agent'`, função `proposeAgentSuggestion`, **não** `proposeVcsAction`); aceitar cria o agente direto e não abre o editor; o gancho da retro herda só a forma da #16.
- Implementação seguiu as três fases do plano, em um único commit `feat: add agent suggestions from the cycle history`. O limiar ficou em `{ count: 3, sources: 2 }` (`DEFAULT_THRESHOLD`). A impressão é `papel + etapa + tipo de evidência`, normalizada. O `blockedByRejection` compara as ocorrências novas (`source:ref:subject`) com as que a recusa já viu.
- O aceite não passa por `assertExternalWrite` (criar agente é local); o ramo `suggest-agent` de `approveAction` chama um hook registrado no import de `suggestionsModule`, que cria o agente e grava o registro. A falha do aceite (etapa desaparecida) deixa a ação `failed` — `approveAction` engole o erro no seu try/catch, então o teste verifica o estado, não um throw.
- Correção da revisão, nesta rodada: (1) o gancho do fim da retro agora corre **depois** de `write(retro)` (`askRetro`), e `latestRetro(squad)` deixou de exigir que o nome do arquivo case inteiro com o formato do dia — a retro de squad era **sempre** ignorada (não "às vezes"); (2) a deduplicação da proposta considera só cartões `suggest-agent` ainda pendentes/em execução — quem decide se a sugestão pode voltar é o `blockedByRejection`; (3) o pedido de edição é limpo depois de entregue (`TeamSettings`) e o `TeamSection` guarda em `ref` o id já tratado, então re-render não reabre o editor.
- Resposta de quem abriu: ### Resposta **1. De onde a sugestão nasce.** Do histórico que o app já grava, sem gravar nada novo na primeira versão: - das **execuções**: perguntas que chegam à pessoa (`needs-person`) sobre o mesmo tema em execuções diferentes, devoluções repetidas para a mesma etapa pelo mesmo motivo, rodadas de revisão e cenários de QA que voltam com o mesmo tipo de achado, e etapas que a pessoa assume à mão (pula, refaz ou responde no lugar do agente); - dos **comandos permitidos**: o mesmo comando que a pessoa permite de novo e de novo é um passo manual repetido; - das **cerimônias**: as decisões e ata… <!-- answer:24 -->

## Restrições

- Repositório público: nada de empresa, pessoa, host ou número de issue real em código, teste, fixture ou doc. O registro e a evidência vivem nos dados do workspace, nunca no repositório.
- Sugestão nasce somente leitura e sem comandos; nada acima do mínimo; nada aplicado sem o "sim".
- A v1 não grava história nova nem lê a transcrição das cerimônias.
- Não misturar com a #16 (da #16 só a forma "proposta em Ações" e o gancho do fim da retro) nem com a #8.
- Toda string de interface por `t()` nos dois catálogos; tema por tokens.
- Canais de decisão da sugestão são desktop-only (`suggestions:suggest`, `suggestions:reject`, `suggestions:edited` em `DESKTOP_ONLY`); `suggestions:list` fica aberto como leitura.
- Testes usam a flow de engenharia (`agentFlowEngineering`), cujas etapas (`refine`/`plan`/`implement`/`review`/`qa`) é que podem ser cobertas; a template SDD não tem etapa `review` de trabalho.

## Tentado e descartado

- Descartado tratar "duração de etapa" como fonte; descartado voltar a perguntar a quem abriu.
- Descartado reusar `proposeVcsAction`: exigiria um `VcsCommand` falso e passaria pela validação de escrita externa, que a sugestão não faz.
- Descartado gravar o registro na configuração: seria dado do workspace, não config, e arrastaria migração de schema.
- Descartado criar/alterar etapas do fluxo a partir da sugestão; descartado sugerir permissões acima do mínimo; descartado oferecer sugestão no meio de execução/cerimônia.
- Descartado mandar o cartão ler nome/papel/prompt do texto do `output`: o `unit` guarda o proposto estruturado e `suggestionOf(a)` o lê.
- Na tentativa anterior, descartado tratar como bloqueante a deduplicação por chave (o comportamento correspondia ao que a spec pedia); nesta rodada ela virou **correção**: a checagem passou a olhar só cartões `suggest-agent` pendentes/em execução.

## Perguntas abertas

- Nenhuma de produto. O limiar é um valor de partida, não medido em uso real; o comportamento do modelo real e a renderização do cartão numa tela ficam para o teste. Nenhuma pausa.

## Onde o trabalho está

- `docs/cycles/[redacted]/` com `0_ISSUE.md`, `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md` e `4_REVIEW.md`. O código já está commitado; o app commita os documentos.
- Correção da revisão aplicada nesta rodada em `src/main/retro.ts` (gancho depois do `write`; `latestRetro` reconhecendo a retro de squad), `src/main/actions.ts` (deduplicação só do cartão pendente), `TeamSettings.tsx` (pedido de edição consumido) e `TeamSection.tsx` (id já tratado em `ref`). Testes novos em `test/retro-issues.test.ts` (3) e `test/suggestions-module.test.ts` (3).
- Gates rodados **nesta etapa** e verdes: `npx tsc --noEmit`; `npx vitest run` (214 arquivos, 3564 testes); `node scripts/theme-audit.mjs`; `npm run i18n:lint` (4031 chaves nos dois idiomas, 0 textos soltos); `node scripts/public-audit.mjs` (864 arquivos); `npx electron-vite build`.
- Verificado por reversão: com o gancho de volta para antes do `write`, os três testes de `test/retro-issues.test.ts` ficam vermelhos; com a deduplicação antiga, o teste do cartão já decidido fica vermelho. O caminho "Editar" é do renderer e não tem teste.
- Não verificado: comportamento do modelo real, volume do histórico, limiar medido, renderização real do cartão e o caminho "editar" aberto no aplicativo.
- Próxima etapa: teste.
- Passagem product-owner → pessoa: Escrever o plano técnico (2_PLAN.md) sobre a spec funcional pronta… <!-- handoff:34 -->
- Passagem tl-plataforma → pessoa: Implementar a sugestão de agentes novos em três commits, na ordem do plano… <!-- handoff:45 -->
- Passagem developer → revisor-plataforma: Revisar a implementação da sugestão de agentes novos… <!-- handoff:97 -->
- Passagem revisor-plataforma → developer: Revisão da entrega contra a spec e o plano: um ponto bloqueante (o gancho do fim da retro antes de a retro ser persistida) e duas sugestões (deduplicação e pedido de edição). O essencial conforme: leitura pura, limiar antes do modelo, etapa existente, aceite somente leitura, registro fora do repositório, recusa bloqueando a volta e limites com as frentes vizinhas. Nada executado na revisão. <!-- handoff:110 -->
- Passagem developer → revisor-plataforma: Correção da revisão aplicada e verificada: gancho do fim da retro movido para depois de `write(retro)` e `latestRetro(squad)` corrigido (a retro de squad nunca era encontrada); deduplicação da proposta restrita ao cartão pendente; pedido de edição consumido (limpo em `TeamSettings`, id tratado em `ref` no `TeamSection`). Testes: 6 novos, 3564 verdes, `tsc`, tema, i18n, auditoria pública e build verdes. Falta: o teste da etapa. <!-- handoff:new -->
- Passagem support → product-owner: Refinar a sugestão de agentes novos a partir da resposta de quem abriu: a spec funcional e o plano técnico precisam fechar (1) de que histórico a sugestão é derivada, com as fontes apontadas — perguntas `needs-person` do mesmo tema entre execuções, devoluções repetidas para a mesma etapa pelo mesmo motivo, rodadas de revisão e cenários de QA que repetem o tipo de achado, etapas que a pessoa assume à mão, o mesmo comando aprovado repetidas vezes e as decisões/atas das cerimônias —, lendo só o que o app já grava (run JSON, `historico/`, atas) e sem gravar nada novo na v1; (2) como a sugestão cit… <!-- handoff:27 -->
