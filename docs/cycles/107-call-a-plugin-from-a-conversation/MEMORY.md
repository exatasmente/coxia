# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (enhancement); não é bug, pergunta nem duplicada. Entendido por leitura do código — nada foi executado no produto em nenhuma tentativa desta etapa.
- Sem pergunta ao autor: a issue já diz o que acontece hoje e o que se espera, e não há defeito a reproduzir.
- Quatro respostas da pessoa, incorporadas à 1_SPEC.md:
  - Com /${comando} é comando e @ é agente, uma melhoria, um agente pode chamar outro agente durante a sua rodada e esperar a resposta dele para continuar algo como o sendMessage marcando o agente em questão e se for necessário esperar a resposta o agente que chamou aguarda até o outro responder para continuar, esse ciclo pode ir se expandindo, um agente chamado pode chamar outro e assim em diante até a resposta ser finalizada, deve ter um controle para evitar loops infinitos, conversas demoradas não significam loop, mas assuntos repetitivos, agente fazerem ações que outros já firerazm durante o c… <!-- answer:27 -->
  - Issue separada: controle de repetição entre agentes. <!-- answer:35 -->
  - Sim: resposta da conversa de execução também vira documento na pasta do ciclo. <!-- answer:43 -->
  - Pode permitir: o telefone pareado permite o pedido que a chamada de conversa abrir. <!-- answer:50 -->
- Plano (2_PLAN.md, entregue nesta etapa): evento novo `conversation-called` no catálogo fixo (contrato continua 1 por ser acréscimo; nenhuma migração — nada de campo novo de configuração); comando = `/` + id do plugin + pergunta não vazia, decidido por função pura em `src/shared/plugins/calls.ts`, e mensagem de comando nunca vira menção (gravada sem `mentions` em `forum.ts`) nem resposta da pergunta da execução (`answerPost` devolve null); conversa de execução roda com o alvo da execução (documento gravado) e conversa sem execução roda numa pasta vazia própria com `documents:false` (nada escrito, issue 0 sem título); resposta entregue como linha do aplicativo com código+parâmetros (`main.forum.code.plugin.*`) via dependência injetável `say`; pedido em Ações ganha `thread`/`asked`, nasce com `holdsRun:false` e é deduplicado por conversa; telefone: `plugins:answer` sai de `DESKTOP_ONLY` e a origem da chamada no serviço recusa pedido sem `thread`; contexto do kit ganha `asked`, `thread`, `runId` (JavaScript) e `$2`, `$3` (shell); busca na web declara o evento e responde à pergunta mantendo o histórico do documento.

## Restrições

- O catálogo de eventos é fixo e público (`src/shared/plugins/events.ts`); declaração que nomeie evento fora dele continua recusada.
- Hoje a chamada de plugin exige `runId` (`src/main/plugins/module.ts`, `callPlugin`) — o plano abre o caminho só para chamada de conversa com alvo próprio.
- Permissão: rede e escrita passam pela porta de Ações; recusar pedido e bloquear escrita já cabem ao telefone; permitir passa a caber ao telefone só para pedido de conversa (origem verificada); os pedidos dos quatro momentos do ciclo continuam só no computador.
- Resposta na conversa entra cercada como material (`<data>`), mesmo formato da resposta de menção; nunca como instrução.
- Menção `@` só resolve para agentes da equipe; tópico de chamada entre agentes carrega menção e fica de fora da chamada de plugin.
- Nenhum caminho de escrita novo: documento só pela guarda da pasta do ciclo e só em conversa de execução; espaço de teste não libera requisição nem escrita; escrita irreversível é anunciada antes de sair.
- Repositório público: sem empresa, pessoa, host real, número real de issue ou segredo; exemplos neutros. Chaves novas nos dois catálogos, tótem de tema na tela, texto de usuário por `t()`.

## Tentado e descartado

- Buscas no rastreador por "plugin" (14) e "conversation" (24): nenhuma duplicata.
- Descartado nesta etapa: exigir o interruptor de efeitos externos para o telefone permitir (canal normal + guarda de origem no serviço); deixar comando de plugin desconhecido sem resposta (a conversa diz que nenhum plugin atende).
- Nenhum comando, teste, gate ou execução do produto em qualquer tentativa desta etapa; escrita dos documentos por leitura de código e dos documentos da etapa.
- Procedimento `p-c32ccc0a` (revisão 1) guardado na triagem.

## Perguntas abertas

- Nenhuma. As três decisões que a issue deixava em aberto foram respondidas e estão incorporadas; a etapa não pausa.

## Onde o trabalho está

- Entregues: `0_TRIAGE.md`, `1_SPEC.md` (decisões fechadas) e `2_PLAN.md` (esta etapa: mudanças por arquivo e função, ordem, um teste por comportamento, riscos, decisões e o que os testes não cobrem).
- Próxima etapa: implementar pelo plano, na ordem dele, com os testes que ele nomeia, e rodar os gates ao fim; nenhum critério de aceite foi executado porque a capacidade nova ainda não existe.
- Âncoras lidas nesta tentativa: `1_SPEC.md`, `2_PLAN`, `src/shared/plugins/{events,declaration,grants}.ts`, `src/main/plugins/{module,runtime,read}.ts`, `src/main/actions.ts` (`PluginAskUnit`, `proposePluginAsk`, `skipAction`), `src/main/{forum,webPolicy}.ts`, `src/main/runner/{module,service}.ts`, `src/main/mentions/{module,answer,converse}.ts`, `src/main/{modules,rpc}.ts`, `src/renderer/src/screens/PluginActionCard.tsx`, `PluginsSection.tsx`, `docs/plugins/{README.md,kit/coxia-plugin.d.ts}`, `plugins/web-search/*`, catálogos `main.*`/`ui-*`, `CHANGELOG.md`, testes `plugins-*`, `plugin-*`, `forum-*`, `runner-lifecycle`.
- Passagem support → product-owner: Levar a triagem ao refino do produto e fechar as três decisões de desenho. <!-- handoff:14 -->
- Passagem product-owner → pessoa: Levar a especificação fechada para a etapa seguinte. <!-- handoff:57 -->
