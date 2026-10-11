# Memória do ciclo

## Decisões

- Tipos de passo da política = motivos de retenção atuais: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente (`submit|name|shortcut|dialog|unclassified|agent`). Sem tipos novos.
- Pagamento, envio a pessoas, segredos e cartão: sempre retidos; NÃO são chaves da política, são uma detecção própria (`sensitiveCategory`, `src/main/browser/sensitive.ts`) que roda ANTES da política, para qualquer tipo. Liberação vinda de arquivo/importação é descartada com aviso.
- Refinamento: 1_SPEC.md (14 regras, 12 critérios). Precedência por tipo: agente > squad > workspace > padrão retido.
- Plano (2_PLAN.md): campo `screenPolicy` (agente, squad, `runner.screenPolicy`), schema v28→v29; nome na UI "aprovações dos passos na tela" (não "autonomia"); política resolvida por chamada (instantâneo em `CallScreen`), vale na próxima etapa; mudança registrada em `saveConfig` (`screen-policy`); passo autônomo registrado em `screen-autonomous` (audit.ts) com `policyLevel` = agent|squad|workspace|default (nomes que a #268 deve adotar); `screen_confirm` pay/send e palavras sensíveis sempre perguntam; navegador pareado/modelo/importação nunca sobem política (molde `screenRaised`); passe de site não vale para passo sensível; frase de prompt só aparece com tipo liberado (prompt idêntico sem config).
- Prioridade proposta priority:medium; sem marco.
- Resposta: Usar os motivos que o app já retém, como estão: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente. Não entram tipos novos; "novos tipos de passo" fica fora do escopo. Pagamento, envio a pessoas, segredos e cartão continuam sempre retidos e a política não pode liberá-los. Como não são tipos separados, seguem detectados como hoje, por palavras no nome do controle. <!-- answer:12 -->

## Restrições

- Padrão tudo retido; `screen_handoff` inalterado; strings via `t()` nos dois catálogos; CHANGELOG Unreleased; toda escrita externa pela porta Actions (esta mudança não cria nenhuma).
- Não vai à produção sem #268 (auditoria); não dá para impor em código, é condição de mesclagem/lançamento.
- Comentários e identificadores em inglês; repositório público (sem nomes/hosts/issues reais).

## Tentado e descartado

- Lista nova de tipos de passo (descartada pela pessoa).
- Pôr as quatro categorias como chaves da política (descartado: política não pode expressar liberação delas).

## Perguntas abertas

- Nenhuma bloqueante.
- Não verificado: tela de configurações além de ScreenFields.tsx; nomes dos testes de renderização; chaves de prompt por modelo em cyclePrompts.ts e texto atual de runner.rules.screen (dizer "todo" passo?); se o probe coleta `autocomplete` para cartão; formato do plano da #268; nada foi executado (tsc, vitest, lints).
- Lista de palavras das quatro categorias é conservadora e em tabela (publish/delete ficam com a política); ajustável na revisão.

## Onde o trabalho está

Planejamento concluído (2_PLAN.md). Próxima etapa: implementação na ordem do plano (tipos/resolução, config v29, detecção, intermediário, callScreen/prompt, registro de mudança, UI com a Experiência, CHANGELOG/docs), depois todos os gates do AGENTS.md.
- Passagem support → product-owner: Planejar: mapear as camadas de configuração (agente, squad, workspace), a tela de configurações, a detecção por palavras das quatro categorias sempre retidas e a ligação com #268. <!-- handoff:19 -->
- Passagem product-owner → pessoa: Planejar a partir de 1_SPEC.md. Ler a tela de configurações (Settings.tsx, TeamSettings.tsx), onde moram agente/squad/workspace (AgentDef, SquadDef, bloco de autonomia do workspace/fluxo em src/shared/config/types.ts), o classificador src/main/browser/classify.ts (lista de palavras mistura pagamento e envio com salvar/apagar: prever detecção das quatro categorias antes da política), asks.ts/intermediary.ts, screenPrompt.ts e o registro de #268 para reaproveitar. Cuidar do choque de nome com a \"autonomia\" existente. <!-- handoff:30 -->
