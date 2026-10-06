# Memória do ciclo

## Decisões

- A issue é pedido de correção de documentação: três textos desatualizados sobre o motor aberto (a nota do assistente, a seção de escolha de motor e a tabela de cobertura de `docs/llm-providers.md`).
- O refinamento escreveu `1_SPEC.md`: o que muda para quem usa (a nota deixa de dizer que o motor aberto só lê; a escolha do motor passa a ser descrita como configuração e o gancho de ambiente vira auxílio de teste; a tabela e as notas honestas do README passam a contar o modelo real que rodou; nada de novo é apresentado como testado), as regras, o que fica fora e onze critérios de aceite.
- Prioridade proposta: `priority:medium` (documentação visível, sem defeito de comportamento). Marco: nenhum. São propostas para a pessoa aceitar.
- Alcance fechado no refinamento: entram os três textos da issue **mais** as notas honestas do README, nas duas línguas, porque repetem a mesma frase de "só testado contra um servidor falso" e contrariam o registro de quatro execuções reais. **Ficam fora** a frase da "camada de configuração vai trocar" em `docs/configuration.md` e no comentário do `bridge.ts`, a seção de limitações conhecidas e a promessa de testar modelos locais de verdade.
- A pergunta sobre execução nova com modelo real foi para a pessoa, com o que já se sabe: não achamos registro de execução real depois das quatro; se não houver, a tabela só passa a contar certo as quatro.

## Restrições

- Tarefa de documentação e texto de interface: sem mudança de comportamento no código.
- Nesta etapa nada foi executado: os pontos foram conferidos lendo o código, os catálogos, os documentos e o changelog, nunca rodando testes ou abrindo tela.
- A nota é uma string de interface: chave nos dois catálogos (`src/shared/i18n/wizard.{en,pt-BR}.json`), mesma chave, mesmos parâmetros.
- A cópia congelada `test/fixtures/catalogs-main/wizard.*.json` é o texto do `main`, não do worktree: **não** deve acompanhar a mudança. Mas `test/gitlab-catalogs-unchanged.test.ts` só aceita diferença entre a cópia e o texto novo se a chave entrar na lista `INTENDED` daquele teste, com motivo; sem isso, o teste fica vermelho. Isso vale para qualquer chave de interface tocada.
- Sem número de issue, nome real, host ou segredo nos textos; o audit público vale para docs, comentários e mensagens de commit.

## Tentado e descartado

- Procurar na `docs/runner.md` e no `CHANGELOG.md` execuções reais além das quatro já registradas: nenhuma nova. A hipótese de que a tabela esteja só desatualizada no texto — e não na cobertura — ficou como pergunta para a pessoa, não como conclusão.
- Puxar para este trabalho toda frase velha sobre o motor aberto: em `docs/configuration.md` (pt e en) e no `bridge.ts` a camada de configuração continua tratada como futura, mas isso está fora dos três textos da issue e virou pergunta em aberto.

## Perguntas abertas

- O alcance da tabela de cobertura: existe execução com modelo real depois das quatro registradas? Sem isso, a tabela conta só as quatro. Pergunta feita à pessoa.
- Se a frase velha de `docs/configuration.md` e do `bridge.ts` entra no mesmo trabalho.

## Onde o trabalho está

- Triagem e refinamento concluídos (`0_TRIAGE.md`, `1_SPEC.md`). Não verificado: nenhuma tela aberta, nenhum teste rodado.
- Estado conferido por leitura: a nota (`wizard.models.openEngineNote`, em `src/renderer/src/wizard/steps/ModelsStep.tsx`) diz "ferramentas só de leitura" para todo `kind` que não é Claude, enquanto `buildTools` (`src/main/engine/open/loop.ts`) dá `Write`/`Edit` com raiz de escrita, `Bash` da lista e as ferramentas MCP permitidas; a escolha por configuração existe (`llm.providers[].engine`, papel aponta provedor, `engineFor`/`openSelection`), e o gancho `openEngineFromEnv` segue no código como teste. O README continua dizendo que só o servidor falso foi testado, embora o changelog de 0.4.0 e a `docs/runner.md` registrem o modelo real.
- Onde segue: implementação dos textos; revisão, QA e a nota de quem abriu a issue.
- Passagem product-owner → implementação: escrever `1_SPEC.md` foi o desta etapa; os textos a mudar e os cuidados (chave nos dois catálogos, mesma redação nas duas línguas, `INTENDED` do teste de catálogos quando a chave de interface mudar, e o que a tabela pode afirmar) estão na especificação.
- Passagem support → product-owner: Atualizar os três textos: a nota do assistente nos dois catálogos (parando de dizer que o motor aberto só lê, dizendo que ele lê, escreve no worktree e roda comandos sob a mesma política do Claude Agent SDK, e que a qualidade depende do modelo), a seção de seleção de `docs/llm-providers.md` nas duas línguas (descrevendo a escolha provedor → motor em `llm.providers` e deixando o gancho de ambiente só como auxílio de teste, se ainda usado) e a tabela de cobertura da mesma página. A tarefa é de documentação e textos de interface, não de código de comportamento. Não verificado nesta etapa: nenhuma… <!-- handoff:7 -->
