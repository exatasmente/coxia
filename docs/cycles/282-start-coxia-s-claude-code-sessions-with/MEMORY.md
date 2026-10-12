# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível como escrito (só lido). Sugestão: priority:medium, squad plataforma.

## Restrições

- Desligado por padrão; só desktop; `test: true` recusa; auditoria uma linha por sessão; aviso de que contorna regras do celular pareado; persona não liga.
- Etapas isoladas usam `settingSources: []` (src/main/agents.ts:524): opções têm de ser passadas pelo app.

## Tentado e descartado

- Nada.

## Perguntas abertas

- O SDK abre a ponte em sessão não interativa? Não verificado.
- Precedência por agente vs por run; suporte real a espelho só de leitura.

## Onde o trabalho está

- Triagem pronta (0_TRIAGE.md). Dependência: issue de sessões (entregas 1 e 2 da #262), sem ciclo nem código. Relacionadas: #262, #269, #270, #157, #268.
