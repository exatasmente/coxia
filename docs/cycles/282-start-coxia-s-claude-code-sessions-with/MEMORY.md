# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível como escrito. Sugestão: priority:medium, squad plataforma.
- Refinamento: 1_SPEC.md escrita (12 regras, 10 critérios). Proposta priority:medium, sem marco (depende da issue de sessões).

## Restrições

- Desligado por padrão; só desktop; `test: true` recusa; auditoria uma linha por sessão; aviso de que contorna regras do celular pareado; persona não liga.
- Etapas isoladas usam `settingSources: []` (src/main/agents.ts:524): opções têm de ser passadas pelo app.

## Tentado e descartado

- Nada.

## Perguntas abertas

- O SDK abre a ponte em sessão não interativa? Não verificado (bloqueia a implementação).
- Espelho só de leitura suportado de fato? Não verificado.
- Precedência agente vs execução: não decidida (proposta: execução só restringe).
- Dependência: issue de sessões (entregas 1 e 2 da #262), sem ciclo nem código.

## Onde o trabalho está

- Triagem (0_TRIAGE.md) e especificação (1_SPEC.md) prontas. Próxima etapa: planejamento. Pontos de entrada: src/main/agents.ts sdkOptions, src/main/webPolicy.ts DESKTOP_ONLY/PERSONA_UNLISTED, src/main/workspaces-core.ts (test: true), auditoria da #268. Relacionadas: #262, #269, #270, #157, #268.
- Passagem support → product-owner: Especificação: verificar no SDK se uma sessão iniciada pelo Agent SDK abre a ponte (remoteControlAtStartup/autoUploadSessions não verificados), definir nível por agente vs por run, espelho só de leitura, e a dependência da issue de sessões (sem ciclo). Pontos de entrada: src/main/agents.ts sdkOptions, src/main/webPolicy.ts DESKTOP_ONLY/PERSONA_UNLISTED, auditoria da #268. <!-- handoff:11 -->
