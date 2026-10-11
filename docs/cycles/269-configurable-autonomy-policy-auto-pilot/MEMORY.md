# Memória do ciclo

## Decisões

- Tipos de passo da política = motivos de retenção atuais: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente. Sem tipos novos; "novos tipos de passo" fora do escopo.
- Pagamento, envio a pessoas, segredos e cartão: sempre retidos, a política não libera (aviso). Detectados como hoje, por palavras no nome do controle.
- Tipo da issue: pedido de funcionalidade; sem duplicadas. Sugestão: priority:medium; squad plataforma com apoio da experiência (tela de configurações).
- Resposta: Usar os motivos que o app já retém, como estão: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente. Não entram tipos novos; "novos tipos de passo" fica fora do escopo. Pagamento, envio a pessoas, segredos e cartão continuam sempre retidos e a política não pode liberá-los. Como não são tipos separados, seguem detectados como hoje, por palavras no nome do controle. <!-- answer:12 -->

## Restrições

- Padrão tudo retido; `screen_handoff` inalterado; strings via `t()` nos dois catálogos; CHANGELOG Unreleased.
- Não vai à produção sem #268 (auditoria).

## Tentado e descartado

- Lista nova de tipos de passo (descartada pela pessoa).

## Perguntas abertas

- Nenhuma. Não verificado: camadas de configuração agente/squad/workspace e tela de configurações no código.

## Onde o trabalho está

Triagem concluída (só lida). Próxima: planejamento.
