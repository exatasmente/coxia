# Memória do ciclo

## Decisões

- Tipos de passo da política = motivos de retenção atuais: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente. Sem tipos novos; "novos tipos de passo" fora do escopo.
- Pagamento, envio a pessoas, segredos e cartão: sempre retidos, a política não libera (aviso). Detectados por palavras no nome do controle (e nas palavras da confirmação do agente), e essa detecção vale ANTES da política.
- Tipo da issue: pedido de funcionalidade; sem duplicadas. Prioridade proposta: priority:medium (opcional, mas só vai à produção com #268); sem marco. Squad plataforma com apoio da experiência (tela de configurações).
- Refinamento concluído: 1_SPEC.md com 14 regras, 12 critérios de aceite. Precedência por tipo de passo (agente > squad > workspace > padrão retido).
- Resposta: Usar os motivos que o app já retém, como estão: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente. Não entram tipos novos; "novos tipos de passo" fica fora do escopo. Pagamento, envio a pessoas, segredos e cartão continuam sempre retidos e a política não pode liberá-los. Como não são tipos separados, seguem detectados como hoje, por palavras no nome do controle. <!-- answer:12 -->

## Restrições

- Padrão tudo retido; prompt idêntico ao de hoje sem configuração; `screen_handoff` inalterado; strings via `t()` nos dois catálogos; CHANGELOG Unreleased.
- Não vai à produção sem #268 (auditoria).
- O nome "autonomia" já existe no código com outro sentido (ciclo/fluxo/squad/agente: etapas começam e passam sozinhas); a política precisa de nome distinto na interface.

## Tentado e descartado

- Lista nova de tipos de passo (descartada pela pessoa).

## Perguntas abertas

- Nenhuma bloqueante. Para o planejamento: palavras para segredos e cartão não existem na lista de hoje (src/main/browser/classify.ts mistura pagar/comprar/enviar com salvar/apagar no motivo "name"); se a confirmação do agente traz o tipo; onde guardar a política por nível; ligação do registro de mudanças com o de #268.
- Lido nesta etapa: classify.ts, screenPrompt.ts, HoldWhy em shared/browser.ts, tipos AgentDef/SquadDef/autonomia em shared/config/types.ts. Não verificado: tela de configurações por dentro, formato da auditoria de #268.

## Onde o trabalho está

Refinamento concluído (1_SPEC.md). Próxima etapa: planejamento.
- Passagem support → product-owner: Planejar: mapear as camadas de configuração (agente, squad, workspace), a tela de configurações, a detecção por palavras das quatro categorias sempre retidas e a ligação com #268. <!-- handoff:19 -->
