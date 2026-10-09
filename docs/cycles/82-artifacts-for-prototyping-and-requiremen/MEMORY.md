# Memória do ciclo

## Decisões

- Triagem de 82 (tentativa 5): pedido de funcionalidade, não duplicata, dá para entender por leitura. Sem pergunta para a pessoa e sem pergunta para quem abriu.
- Sugestão de prioridade: `priority:low` (a da issue), por ser capacidade de fluxo sem defeito nem bloqueio.
- Squad proposto: plataforma — o trabalho é do runtime (plugin embutido, leitura de fase e gate, `specLayout` na configuração compartilhada); nenhum escopo reivindica a issue por rótulo ou pasta.

## Restrições

- Esta etapa só lê: nada foi executado (nenhum teste nem aplicativo), então tudo o que se afirma é leitura.
- Fora de escopo, dito pela própria issue: protótipo em alta fidelidade; o layout dos artefatos é assunto do refino.

## Tentado e descartado

- Procurar `rules/cycle-artifacts.md`, citado na issue: não existe na árvore; os artefatos do ciclo estão descritos nos documentos do projeto (`docs/cycles.md`) — usar esse.
- Procurar duplicatas varrendo os textos das issues do ciclo por requisito/protótipo/manual: só esta issue; relacionadas #84, #96, #97.

## Perguntas abertas

Nenhuma que pause a etapa. Fica para o refino: nome e lugar de cada documento, em qual etapa entra, onde o manual aparece, se o plugin embutido vem ligado por padrão e se documentos de plugin também movem a fase.

## Onde o trabalho está

- `0_TRIAGE.md` entregue nesta tentativa; a anterior reiniciada não tinha deixado documento algum na pasta.
- Confirmado por leitura: o gate soma documentos declarados por plugin (`src/main/gate.ts:106,120`, registro em `src/main/plugins/module.ts:664-665`, teste `test/gate-plugin-documents.test.ts` lido e não rodado); a fase lê só os `phaseFiles` configurados (`src/main/cards.ts:38`); o único plugin embutido é `plugins/web-search`, com um documento; nenhum declara requisitos, protótipo ou manual.
- Próxima etapa: refino (product-owner).
