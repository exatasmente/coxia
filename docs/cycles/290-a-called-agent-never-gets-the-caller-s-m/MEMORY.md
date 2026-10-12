# Memória do ciclo

## Decisões

- Triagem: tipo bug (regressão da beta 0.11.0), squad proposto plataforma, prioridade sugerida priority:high (não definida).

## Restrições

- Testes com fakes (test/helpers); textos via t() nos dois catálogos; CHANGELOG Unreleased; gates do AGENTS.md.

## Tentado e descartado

- Nada executado na triagem; só leitura.

## Perguntas abertas

- Por que o relógio de ociosidade (10 min) não disparou em 70 min: não identificado.
- Duplicadas no tracker: não pesquisadas.

## Onde o trabalho está

- Triagem concluída (0_TRIAGE.md). Causas conferidas por leitura: conversation.ts:188-190 e :331 (primeira mensagem fora do prompt), :220-243 (laço sem esperar chamador), executor.ts:1189-1190 e 1137-1143 (deadlock com chamado que escreve), callStops sem conversas do runner (mentions/stop.ts, module.ts:381).
