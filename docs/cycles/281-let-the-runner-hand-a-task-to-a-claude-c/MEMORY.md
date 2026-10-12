# Memória do ciclo

## Decisões

- Etapa do fluxo ganha o campo "Executor": "Agente do Coxia" (padrão) ou "Sessão do Claude Code"; primeira versão aceita em qualquer etapa com agente.
- Opção global "Entregar tarefas ao Claude Code": desligada por padrão, só desktop; campo só aparece/escolhível com ela ligada. Celular pareado e persona não ligam nem escolhem.
- Opção desligada ou workspace test: true: a execução recusa com mensagem clara, sem cair no agente normal.
- Resultado da sessão substitui a resposta da etapa; transcrição fica como registro da etapa. Sessão sem resultado/erro: etapa falha como qualquer agente.
- Permissões da sessão viram item pendente e a etapa espera; escrita fora do worktree é recusada; nada de ~/.claude em testes; coxia-state não é o caminho.
- Spec escrita em 1_SPEC.md (10 critérios de aceite). Prioridade proposta: medium.
- Resposta: (1) Como a etapa é configurada: um campo na própria etapa do fluxo, "Executor", com duas opções: "Agente do Coxia" (padrão, o que existe hoje) e "Sessão do Claude Code". Quem não mexe no campo não vê mudança. O campo só aparece e só pode ser escolhido com a opção global "Entregar tarefas ao Claude Code" ligada (desligada por padrão, só desktop). Com a opção desligada, ou em workspace test: true, a etapa não alcança nenhuma sessão: a execução recusa com mensagem clara, sem cair silenciosamente no agente normal. Celular pareado e persona não podem ligar a opção nem escolher o executor. (2) Resul… <!-- answer:22 -->

## Restrições

- Tipo: pedido de funcionalidade. Sem duplicadas; relacionadas #262, #280 (dependência), #282.
- FlowStage (src/shared/runs/types.ts) hoje não tem campo de executor.

## Tentado e descartado

## Perguntas abertas

- Para o plano: ACP vs. Agent SDK (SDK em src/main/claudeSdk.ts; ACP exigiria dependência nova), como impor o limite de escrita, formato do campo no esquema do fluxo, encaixe com #280 (memória diz canais sempre registrados e recusam quando desligados; busca por módulo de sessões nesta worktree não achou nada: não verificado).

## Onde o trabalho está

- Refinamento concluído (1_SPEC.md), sem código. Próxima: plano.
- Passagem support → product-owner: Planejar: escolher ACP vs. Agent SDK (SDK já embarcado), como impor o limite de escrita ao worktree, o campo "Executor" no esquema do fluxo (qualquer etapa) e o encaixe com os canais de sessões da #280 (recusa quando desligado, persona/celular negados). <!-- handoff:35 -->
