# Triagem: entregar uma tarefa a uma sessão do Claude Code

## Tipo
Pedido de funcionalidade (rótulo `enhancement`). Não é bug, pergunta nem duplicada.

## Dá para entender?
Sim. Apenas lida; nada foi executado e não há o que reproduzir. Problema, comportamento esperado, limites (desligado por padrão, só desktop, negado ao celular pareado e à persona, recusado em workspace `test: true`, nada de `~/.claude` em testes) e quatro critérios de aceite estão claros.

## Decisões de produto (resposta de quem abriu)
- **Configuração:** campo "Executor" na própria etapa do fluxo, com "Agente do Coxia" (padrão, sem mudança para quem não mexe) e "Sessão do Claude Code". A primeira versão aceita o executor Claude Code em qualquer etapa.
- **Opção global** "Entregar tarefas ao Claude Code": desligada por padrão, só desktop. O campo só aparece e só é escolhível com ela ligada. Celular pareado e persona não ligam a opção nem escolhem o executor.
- **Recusa:** com a opção desligada, ou em workspace `test: true`, a execução recusa com mensagem clara, sem cair no agente normal.
- **Resultado:** substitui a resposta da etapa (não é anexo); a transcrição fica como registro da etapa. Sessão sem resultado ou com erro faz a etapa falhar como qualquer agente.
- **Valem como na issue:** pedido de permissão vira item pendente e a etapa espera; escrita fora do worktree é recusada; nada de `~/.claude` em testes; o `coxia-state` não é o caminho.
- **Fica para o plano:** ACP vs. Agent SDK, como o limite de escrita é imposto, formato do campo no esquema do fluxo, encaixe com a entrega de sessões (#280).

## Conferido no código (só leitura, etapa anterior)
- O app já traz `@anthropic-ai/claude-agent-sdk` (`src/main/claudeSdk.ts`), carregado sob demanda.
- Não há referência a ACP em `src/`; ACP exigiria dependência nova.
- Pontos prováveis para permissões e limite de escrita: `src/main/engine/open/` e `src/main/runner/hooks.ts` (não analisados a fundo).
- Memória do workspace (decisão da implementação de #280, 2026-10-12): o módulo de sessões registra os canais sempre e recusa quando desligado; pedidos de permissão só existem para sessões que o Coxia dirige pelo SDK. Lido da memória, não conferido no código nesta etapa.

## O que falta
Nada que só quem abriu possa dizer. Estado da #280 (dependência) segue não verificado no código.

## Relacionadas
- #262: issue de origem (entrega 3).
- #280: sessões do Claude Code no app; dependência (entregas 1 e 2).
- #282: sessões com Remote Control, desligado por padrão; mesma família e fronteira de segurança.
Nenhuma duplicada. (Conteúdo de #262, #280 e #282 não lido na íntegra.)

## Squad e prioridade (sugestões)
- Squad sugerido: plataforma (runner, motores, fronteira de segurança), embora o campo na tela do fluxo toque a Experiência.
- Prioridade sugerida: priority:medium (opcional, desligado por padrão, depende de outras entregas). Não preenchida.
