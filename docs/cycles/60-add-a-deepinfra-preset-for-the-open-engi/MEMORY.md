# Memória do ciclo

## Decisões

- A issue é um pedido de funcionalidade (`enhancement`), não um defeito: falta um atalho na lista do motor aberto, não há comportamento errado.
- Escopo já reduzido por quem abriu: entrada de atalho no motor aberto, uma linha em `docs/llm-providers.md` e o texto novo nos dois catálogos. O aviso do wizard para `unrecognized_model` está fora — vai para outra issue, se fizer falta.
- Squad proposto: `plataforma` (atalhos de provedor e configuração do motor aberto; a parte de catálogo acompanha a entrada nova).
- Prioridade sugerida: `priority:medium`, como já está no rótulo.
- Nenhuma pergunta a quem abriu: a issue basta para entender e implementar.

## Restrições

- Nada foi executado nesta etapa; tudo acima é leitura de código e da issue. O teste de conexão contra o serviço real segue não verificado.
- Sem duplicadas: nenhum outro ciclo deste repositório pede um atalho novo para o motor aberto.
- Regras do repositório para o atalho: cada atalho precisa da chave `wizard.preset.<id>` nos dois catálogos (`test/wizard-i18n.test.ts` cobra) e de uma linha na tabela de testados em `docs/llm-providers.md`.

## Tentado e descartado

- Perguntar a quem abriu pelo endereço da página de chave ou pelo modelo sugerido: descartado. A issue diz "a página de chave como `keyUrl`" e traz um modelo sugerido; é detalhe público, não algo que só quem abriu sabe.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Triagem concluída em `0_TRIAGE.md`. A próxima etapa é o refinamento do produto: virar isso numa especificação e confirmar squad e prioridade.
- Fatos lidos: `OPEN_PRESETS` e `PresetId` em `src/shared/wizard.ts`; rótulos `wizard.preset.*` em `src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json`; `keyUrl` e o seletor em `src/renderer/src/wizard/steps/ModelsStep.tsx`; tabela de provedores testados em `docs/llm-providers.md`. Nenhuma menção ao serviço no código.
