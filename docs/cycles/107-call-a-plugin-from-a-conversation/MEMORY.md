# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (enhancement); não é bug, pergunta nem duplicada. Sem pergunta ao autor: a issue já diz o que acontece hoje e o que se espera.
- Três decisões da pessoa, em 1_SPEC.md: comando com barra chama plugin e `@` continua sendo agente; resposta numa conversa de execução também vira documento na pasta do ciclo; telefone pareado pode permitir o pedido da chamada de conversa.
- Plano (2_PLAN.md): evento novo `conversation-called` no catálogo fixo (contrato 1, sem migração); comando = `/` + id do plugin + pergunta não vazia, por função pura em `src/shared/plugins/calls.ts`; mensagem de comando nunca vira menção nem resposta da pergunta de execução; conversa de execução roda com o alvo da execução e conversa comum com pasta vazia própria (`chatTarget`, `documents: false`); resposta entregue como linha do aplicativo via `say` injetável; pedido em Ações ganha `thread`/`asked`, nasce com `holdsRun: false` e é deduplicado por conversa; `plugins:answer` sai de `DESKTOP_ONLY` e o serviço recusa pedido sem `thread` vindo do navegador; o kit ganha `asked`, `thread`, `runId`; a busca na web declara `conversation-called`.
- Implementado na ordem do plano, num commit (`feat: call a plugin from a conversation and answer it there #107`). Uma leitura do plano virou regra: pedido aberto em Ações = `ok: false` com `refused: null`; o ramo de rede devolve `refused: null` nesse caso.
- Resposta: Com /${comando} é comando e @ é agente, uma melhoria, um agente pode chamar outro agente durante a sua rodada e esperar a resposta dele para continuar algo como o sendMessage marcando o agente em questão e se for necessário esperar a resposta o agente que chamou aguarda até o outro responder para continuar, esse ciclo pode ir se expandindo, um agente chamado pode chamar outro e assim em diante até a resposta ser finalizada, deve ter um controle para evitar loops infinitos, conversas demoradas não significam loop, mas assuntos repetitivos, agente fazerem ações que outros já firerazm durante o c… <!-- answer:27 -->
- Resposta: issue separada <!-- answer:35 -->
- Resposta: sim <!-- answer:43 -->
- Resposta: pode permitir <!-- answer:50 -->

## Restrições

- Catálogo fixo e público; declaração com evento fora dele continua recusada; contrato de declaração segue 1.
- `callPlugin` exige `runId` ou `thread`; sem nenhum dos dois a recusa de sempre continua.
- Permissão: rede e escrita pela porta de Ações; o telefone permite só o pedido da chamada de conversa (origem verificada no serviço) e os quatro momentos do ciclo continuam só no computador.
- Resposta na conversa entra cercada como material, nunca como instrução; é linha do aplicativo (o assinante não acorda com ela).
- Nenhum caminho de escrita novo: documento só pela guarda da pasta do ciclo em conversa de execução; pasta de teste não libera requisição nem escrita.
- Repositório público: sem empresa, pessoa, host real, número real ou segredo; exemplos neutros (`example.com`, `group/project`, `#123`).

## Tentado e descartado

- Descartado no plano (mantido): exigir o interruptor de efeitos externos para o telefone permitir; deixar comando desconhecido sem resposta.
- Duas edições paralelas no mesmo arquivo corromperam `forum.ts` e os catálogos na primeira passagem; refeitas uma a uma.
- `test/plugins-service.test.ts` corre com `CERIMONIAS_DATA_DIR` numa pasta vazia temporária; nunca a pasta da pessoa.
- Nesta revisão, hipóteses levantadas e derrubadas por leitura: colisão de nome entre `conversationCommand` e `conversationCommands` de `executor.ts` (variável real e sem relação); código `plugin.waiting` reutilizado em `noteDelivery` (resolve para a mesma chave, sem defeito).

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Entregues: código, testes, 3_IMPLEMENTATION.md e 4_REVIEW.md (aprovada, sem bloqueante). Mudança em 33 arquivos + 2 novos; um commit na branch.
- Gates re-rodados na revisão nesta árvore: `npx tsc --noEmit` limpo; `npx vitest run` sobre os onze arquivos tocados, 272 de 272 verdes (2 arquivos, 90 casos, na reconferência); `npm run i18n:lint` 5491 chaves, 0 achados; `node scripts/public-audit.mjs` 1605 arquivos, limpo. Conhecido vermelho fora da mudança: quatro arquivos do navegador do aplicativo por `@playwright/mcp` ausente e quatro casos de conflito instáveis sob a suíte cheia.
- Não verificado: nenhum critério de aceite no aplicativo em funcionamento; o documento real gravado pela combinação execução, sandbox e busca na web; a permissão em Ações contra instância real; os botões na tela do telefone (sem teste de componente).
- Próxima etapa: verificação dos dez critérios de aceite no aplicativo, re-rodando só o que tocar.
- Quatro sugestões em aberto (nenhuma bloqueia): linha sem quebra no fim em `src/main/plugins/conversation.ts` e `src/shared/plugins/calls.ts`; a escrita irreversível anunciada a partir de uma chamada de conversa não leva a conversa, então ela não sabe se a escrita saiu ou foi bloqueada; o caso positivo de um agente chamando um plugin não tem teste próprio; o código `plugin.waiting` é reutilizado.
- Passagem developer → revisor-plataforma: verificar os dez critérios de aceite no aplicativo, na ordem. <!-- handoff:137 -->
- Passagem support → product-owner: Levar a triagem ao refino do produto: fechar as três decisões de desenho que a issue deixa em aberto (como o plugin é chamado e como isso se distingue de chamar um agente; se a resposta de uma conversa de execução também vai para a pasta do ciclo; o que o telefone pareado pode permitir) e então escrever a especificação. <!-- handoff:14 -->
- Passagem product-owner → pessoa: Levar a especificação fechada para a etapa seguinte do ciclo: as três decisões de desenho já foram respondidas e incorporadas à 1_SPEC.md (comando com barra para plugin e @ para agente; resposta de conversa de execução também vira documento na pasta do ciclo; telefone pareado pode permitir o pedido da chamada de conversa). Nada de código foi alterado e nenhum critério de aceite foi executado — a capacidade nova ainda não existe. <!-- handoff:57 -->
- Passagem tl-plataforma → pessoa: Implementar o plano 2_PLAN.md na ordem que ele dá, com os testes que ele nomeia por comportamento; nada de código foi alterado e nenhum critério de aceite foi executado. Ao terminar a mudança, rodar os gates (npx tsc --noEmit, npx vitest run, node scripts/theme-audit.mjs, npm run i18n:lint, node scripts/public-audit.mjs) e registrar a mudança em CHANGELOG.md sob ## [Unreleased]. <!-- handoff:81 -->
