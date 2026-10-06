# Memória do ciclo

## Decisões

- A issue é pedido de correção de documentação: três textos desatualizados sobre o motor aberto (a nota do assistente, a seção de escolha de motor e a tabela de cobertura de `docs/llm-providers.md`).
- O refinamento escreveu `1_SPEC.md`: o que muda para quem usa, as regras, o que fica fora e onze critérios de aceite. Escopo fechado: os três textos da issue **mais** as notas honestas do README, nas duas línguas. Ficam fora `docs/configuration.md`, o comentário do `bridge.ts`, a seção de limitações sobre modelos pequenos e a promessa de testar modelos locais.
- Prioridade proposta: `priority:medium`. Marco: nenhum.
- **A pessoa confirmou que não há execução com modelo real depois das quatro registradas** (duas de ~50 chamadas a US$ 0,3 e mais duas a US$ 0,08 e ~US$ 0,14, DeepSeek v4.1 flash pelo OpenRouter, no motor aberto, no runner, contra host falso). Decisão do plano: a tabela **não** ganha cobertura nova; ela passa a contar certo o que já rodou, e o comentário da etapa diz que nada novo rodou.
- O plano (esta etapa) decidiu também trocar a linha das limitações conhecidas de `docs/llm-providers.md` ("ferramentas só de leitura; sem Edit/Write"), que não é citada pela issue mas é a mesma afirmação que manda corrigir, e deixar a tabela como está. Texto proposto para a nota do assistente (pt): "Este provedor roda no motor aberto (o loop de agente do Coxia): ele lê, escreve dentro do worktree da execução e roda comandos sob a mesma política de segurança do Claude Agent SDK. A qualidade depende do modelo escolhido." (en análogo). Textos propostos para a passagem de escolha e para as notas do README estão no plano.
- Nada de comportamento muda; nenhum texto literal novo em código.

## Restrições

- A nota é string de interface: chave `wizard.models.openEngineNote` nos dois catálogos (`src/shared/i18n/wizard.{en,pt-BR}.json`, linha 118), mesma chave, sem parâmetro novo, mesmo sentido nas duas línguas.
- A cópia congelada `test/fixtures/catalogs-main/wizard.*.json` é o texto do `main` e **não** acompanha a mudança. `test/gitlab-catalogs-unchanged.test.ts` só aceita a diferença se a chave entrar na lista `INTENDED`, com motivo (≥20 caracteres); uma entrada cobre os dois idiomas, e sem `replace` o teste só confere a língua — que deve ser pt-BR (o padrão). Vale conferir também `test/i18n.test.ts` (mesmas chaves e mesmos marcadores; o laço percorre `CATALOGS['pt-BR']`, que é a fusão dos catálogos) e `test/main-catalogs.test.ts` (idem, e toda chave pedida por `t('main…')` no código precisa existir).
- `scripts/i18n-lint.mjs` cobre `src/renderer/src`, `src/main` e `src/shared` (não lê `docs/` nem o README): nenhum literal novo em código, sob pena de `npm run i18n:lint` vermelho.
- Sem número de issue, nome real, host ou segredo nos textos; o audit público vale para docs, comentários e mensagens de commit. Commit sem prefixo de tipo (o app acrescenta) e sem número de issue.

## Tentado e descartado

- Procurar execução real nova além das quatro na `docs/runner.md` e no `CHANGELOG.md`: nenhuma; a pessoa confirmou. A tabela não é atualizada com cobertura e sim mantida como está (já correta).
- Mexer no corpo da tabela de `docs/llm-providers.md` e no texto ao redor: lidos inteiros, já contam as quatro execuções e o que não rodou. Só a linha das limitações conhecidas estava velha.
- Varrer `docs/cycles.md`, `docs/configuration.md` e `CONTRIBUTING.md` atrás da mesma frase: o ponto 6 do `CONTRIBUTING.md` é regra de estilo (não afirmação sobre o motor), e `docs/configuration.md` (linhas ~131/~279) tem a frase velha da "camada de configuração" — fora do escopo, virou próximo passo.
- Trocar o parâmetro `{ stage }` do prompt de etapa por texto puro para esconder o "Plan": **descartado**. `cycleWord(i.stage.label)` passa por `catalogs-main/…`? Não — `pt-BR.json` (o catálogo real) tem `cycle.agentFlow.stage.plan: "Plano"`, mas uma cópia congelada do catálogo principal também existe (`test/fixtures/catalogs-main/pt-BR.json`, participa do `MAIN` e é lido pela comparação do catálogo, que não usa `shownText`). Além disso `cycle.decisionLog.ref` diz "o {heading} do Plan", e o registro de decisões de uma sessão escreve no arquivo de plano da pasta de specs. Mudar isso mexeria em mais arquivos do que a issue pede e ficaria de fora.

## Perguntas abertas

- Nenhuma. A pergunta sobre execução real nova foi respondida pela pessoa (não houve). Segue em aberto como trabalho futuro, não como pergunta: a frase velha sobre a camada de configuração em `docs/configuration.md` e no `bridge.ts`, fora do escopo.

## Onde o trabalho está

- Triagem, refinamento e plano concluídos (`0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`). **Não verificado**: nada foi executado nesta execução; a leitura de código, catálogos, documentos e testes foi o método.
- Estado conferido por leitura: a nota (`wizard.models.openEngineNote` em `ModelsStep.tsx`) diz "ferramentas só de leitura" e a linha ~101 de `docs/llm-providers.md` diz o mesmo, enquanto `buildTools` (`engine/open/loop.ts`) dá `Write`/`Edit` com raiz de escrita (de `confine`/`writeRoot`, em `agents.ts`), `Bash` da lista e MCP permitido; a escolha por configuração existe (`llm.providers[].engine`, `llm.roles`, `engineFor`/`openSelection`) e o gancho `openEngineFromEnv` segue no código em quatro pontos; a tabela e o texto ao redor já contam as quatro execuções com modelo real e o que não rodou; o README (as duas línguas, linha ~110) ainda diz "só o servidor falso".
- Onde segue: implementação, revisão, QA e a nota de quem abriu a issue.
- Passagem product-owner → implementação: os textos a mudar, os testes que prendem a mudança (`INTENDED`, paridade de catálogos, lint) e os textos propostos estão no `2_PLAN.md`; o gancho de ambiente segue descrito como auxílio de teste; nada novo é apresentado como testado, porque a pessoa confirmou que nada novo rodou.
- Passagem support → product-owner: Atualizar os três textos: a nota do assistente nos dois catálogos (parando de dizer que o motor aberto só lê, dizendo que ele lê, escreve no worktree e roda comandos sob a mesma política do Claude Agent SDK, e que a qualidade depende do modelo), a seção de seleção de `docs/llm-providers.md` nas duas línguas (descrevendo a escolha provedor → motor em `llm.providers` e deixando o gancho de ambiente só como auxílio de teste, se ainda usado) e a tabela de cobertura da mesma página. A tarefa é de documentação e textos de interface, não de código de comportamento. Não verificado nesta etapa: nenhuma… <!-- handoff:7 -->
- Passagem product-owner → pessoa: Escrever os textos, sem mudar comportamento: (1) a nota do assistente nos dois catálogos (`wizard.models.openEngineNote` em `src/shared/i18n/wizard.{en,pt-BR}.json`), afirmando que o motor aberto é o loop de agente do app, que ele lê, escreve dentro do worktree do run e executa comandos sob a mesma política do Claude Agent SDK, e que a qualidade depende do modelo; (2) a seção de escolha de motor em `docs/llm-providers.md`, nas duas línguas, descrevendo provedor → motor em `llm.providers` e deixando o gancho de ambiente só como auxílio de teste; (3) a tabela de cobertura e o texto ao redor dela… <!-- handoff:16 -->
