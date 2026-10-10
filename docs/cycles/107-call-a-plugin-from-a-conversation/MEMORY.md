# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (enhancement); não é bug, pergunta nem duplicada. Sem pergunta ao autor: a issue já diz o que acontece hoje e o que se espera.
- Três decisões da pessoa, em 1_SPEC.md: comando com barra chama plugin e `@` continua sendo agente; resposta numa conversa de execução também vira documento na pasta do ciclo; telefone pareado pode permitir o pedido da chamada de conversa (além de recusar e bloquear, que já podia).
- Plano (2_PLAN.md): evento novo `conversation-called` no catálogo fixo (contrato 1, sem migração); comando = `/` + id do plugin + pergunta não vazia, por função pura em `src/shared/plugins/calls.ts`; mensagem de comando nunca vira menção (`mentions: []` em `forum.ts`) nem resposta da pergunta de execução (`answerPost` devolve null); conversa de execução roda com o alvo da execução e conversa comum com pasta vazia própria (`chatTarget` em `<dados>/sandbox/plugin-call`, `documents: false`); resposta entregue como linha do aplicativo com código+parâmetros via dependência injetável `say`; pedido em Ações ganha `thread`/`asked`, nasce com `holdsRun: false` e é deduplicado por conversa; `plugins:answer` sai de `DESKTOP_ONLY` e o serviço recusa pedido sem `thread` quando a chamada vem do navegador; contexto do kit ganha `asked`, `thread`, `runId` (JavaScript) e `$2`, `$3` (shell); busca na web declara `conversation-called` e responde mantendo o histórico do documento.
- Implementado nesta etapa na ordem do plano. Uma leitura do plano virou regra de código: pedido aberto em Ações = `ok: false` com `refused: null`, e o ramo de rede devolve `refused: null` nesse caso (a frase antiga de espera virou a linha `plugin.waiting`; a chave `main.plugins.waiting.network` ficou sem uso no código e continua nos catálogos).
- Códigos novos da conversa: `main.forum.code.plugin.{answered,waiting,notCalled,unknownCommand}`; recusa e falha depois que a pessoa responde reutilizam `run.plugin.refused.*` e `run.plugin.failed`. Motivos de não chamada: `main.plugins.call.{off,refused,notOffered}` mais as recusas já existentes.
- Resposta: Com /${comando} é comando e @ é agente, uma melhoria, um agente pode chamar outro agente durante a sua rodada e esperar a resposta dele para continuar algo como o sendMessage marcando o agente em questão e se for necessário esperar a resposta o agente que chamou aguarda até o outro responder para continuar, esse ciclo pode ir se expandindo, um agente chamado pode chamar outro e assim em diante até a resposta ser finalizada, deve ter um controle para evitar loops infinitos, conversas demoradas não significam loop, mas assuntos repetitivos, agente fazerem ações que outros já firerazm durante o c… <!-- answer:27 -->
- Resposta: issue separada <!-- answer:35 -->
- Resposta: sim <!-- answer:43 -->
- Resposta: pode permitir <!-- answer:50 -->

## Restrições

- Catálogo fixo e público; declaração com evento fora dele continua recusada; contrato de declaração segue 1.
- Hoje `callPlugin` exige `runId` ou agora `thread`; sem nenhum dos dois a recusa de sempre continua.
- Permissão: rede e escrita pela porta de Ações; o telefone permite só o pedido da chamada de conversa (origem verificada no serviço) e os quatro momentos do ciclo continuam só no computador.
- Resposta na conversa entra cercada como material, nunca como instrução; é linha do aplicativo (o assinante não acorda com ela).
- Nenhum caminho de escrita novo: documento só pela guarda da pasta do ciclo em conversa de execução; pasta de teste não libera requisição nem escrita.
- Repositório público: sem empresa, pessoa, host real, número real ou segredo; exemplos neutros (`example.com`, `group/project`, `#123`).

## Tentado e descartado

- Descartado no plano (mantido): exigir o interruptor de efeitos externos para o telefone permitir; deixar comando desconhecido sem resposta (a conversa diz que nenhum plugin atende).
- Duas edições paralelas no mesmo arquivo corromperam `forum.ts` e os catálogos na primeira passagem; refeitas uma a uma e conferidas (JSON válido, chaves nos dois idiomas). Nada disso ficou no código.
- `test/plugins-service.test.ts` corre com `CERIMONIAS_DATA_DIR` numa pasta vazia temporária para ler a linha real do fórum; nunca a pasta da pessoa.
- Nenhum app aberto e nenhum critério de aceite executado nesta etapa.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Entregues: código, testes e `3_IMPLEMENTATION.md` (por arquivo e função, testes por comportamento, o que foi e o que não foi verificado). Mudança em 33 arquivos + 2 novos (`src/shared/plugins/calls.ts`, `src/main/plugins/conversation.ts`).
- Gates desta etapa: `npx tsc --noEmit` limpo; `npx vitest run` 6923 de 6944 casos verdes (6 vermelhos fora da mudança: quatro arquivos do navegador do aplicativo por `@playwright/mcp` ausente do `node_modules` e quatro casos de conflito que passam sozinhos 22/22); `node scripts/theme-audit.mjs`, `npm run i18n:lint` e `node scripts/public-audit.mjs` limpos.
- Não verificado: nenhum critério de aceite no aplicativo; o documento real gravado pela busca na web, a permissão contra instância real e os botões na tela do telefone (sem teste de componente).
- Próxima etapa: verificação dos dez critérios de aceite no aplicativo (handoff), re-rodando só o que tocar.
- Passagem support → product-owner: Levar a triagem ao refino do produto: fechar as três decisões de desenho que a issue deixa em aberto (como o plugin é chamado e como isso se distingue de chamar um agente; se a resposta de uma conversa de execução também vai para a pasta do ciclo; o que o telefone pareado pode permitir) e então escrever a especificação. <!-- handoff:14 -->
- Passagem product-owner → pessoa: Levar a especificação fechada para a etapa seguinte do ciclo: as três decisões de desenho já foram respondidas e incorporadas à 1_SPEC.md (comando com barra para plugin e @ para agente; resposta de conversa de execução também vira documento na pasta do ciclo; telefone pareado pode permitir o pedido da chamada de conversa). Nada de código foi alterado e nenhum critério de aceite foi executado — a capacidade nova ainda não existe. <!-- handoff:57 -->
- Passagem tl-plataforma → pessoa: Implementar o plano 2_PLAN.md na ordem que ele dá, com os testes que ele nomeia por comportamento; nada de código foi alterado e nenhum critério de aceite foi executado. Ao terminar a mudança, rodar os gates (npx tsc --noEmit, npx vitest run, node scripts/theme-audit.mjs, npm run i18n:lint, node scripts/public-audit.mjs) e registrar a mudança em CHANGELOG.md sob ## [Unreleased]. <!-- handoff:81 -->
