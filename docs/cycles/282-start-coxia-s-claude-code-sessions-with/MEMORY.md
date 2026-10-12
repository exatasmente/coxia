# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível como escrito. Sugestão: priority:medium, squad plataforma.
- Refinamento: 1_SPEC.md escrita (12 regras, 10 critérios). Proposta priority:medium, sem marco (depende da issue de sessões).
- Plano (2_PLAN.md): etapa 0 = sondagem do SDK, que decide tudo. Três níveis off/mirror/control, padrão off. Precedência: a execução só restringe (mais restritivo vence). Política pura em src/main/remoteControl.ts; campo próprio `remoteControl` em EngineRequest (vence `extra`); canais `remoteControl:` negados ao celular em webPolicy; persona nunca preenche o campo; auditoria uma linha por sessão com deduplicação pelo id; migração v34→v35 em STEPS com types/defaults/schema.

## Restrições

- Desligado por padrão; só desktop; `test: true` recusa; auditoria uma linha por sessão; aviso de que contorna regras do celular pareado; persona não liga.
- Etapas isoladas usam `settingSources: []` (src/main/agents.ts:524): opções têm de ser passadas pelo app.
- Repositório público: exemplos neutros nos testes.

## Tentado e descartado

- Passar a opção por `extra` (aberto, qualquer chamador ligaria a ponte): descartado.

## Perguntas abertas

- O SDK abre a ponte em sessão não interativa? Não verificado (bloqueia a implementação; etapa 0).
- Espelho só de leitura suportado de fato? Não verificado; sem ele o nível mirror sai.
- Auditoria: reutilizar `audited` (actions.ts) ou o sink de browser/audit.ts? Não verificado.
- Precedência (execução só restringe) é proposta, ainda não confirmada pelo product owner.
- Dependência: issue de sessões (entregas 1 e 2 da #262), sem ciclo nem código; critério 9 e sessão solta do 8 ficam fora do plano.
- Critérios 1 e 3 só com conta/SDK reais: QA manual.

## Onde o trabalho está

- Triagem, especificação e plano prontos (0_TRIAGE, 1_SPEC, 2_PLAN). Próxima etapa: implementação, começando pela sondagem. Pontos de entrada: src/main/agents.ts sdkOptions, src/main/engine/contract.ts, src/main/webPolicy.ts, src/shared/config/{types,defaults,schema,migrations}.ts, workspaces-core.ts (test). Relacionadas: #262, #269, #270, #157, #268.
- Passagem support → product-owner: Especificação: verificar no SDK se uma sessão iniciada pelo Agent SDK abre a ponte (remoteControlAtStartup/autoUploadSessions não verificados), definir nível por agente vs por run, espelho só de leitura, e a dependência da issue de sessões (sem ciclo). Pontos de entrada: src/main/agents.ts sdkOptions, src/main/webPolicy.ts DESKTOP_ONLY/PERSONA_UNLISTED, auditoria da #268. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento: primeiro verificar no SDK se uma sessão não interativa abre a ponte e se há espelho só de leitura; definir a precedência agente x execução; apoiar-se em sdkOptions (agents.ts), DESKTOP_ONLY/PERSONA_UNLISTED (webPolicy.ts), recusa em test:true e o mecanismo de auditoria da #268. Registrar a dependência da issue de sessões. <!-- handoff:20 -->
