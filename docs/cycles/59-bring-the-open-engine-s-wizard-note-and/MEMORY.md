# Memória do ciclo

## Decisões

- A issue é pedido de correção de documentação: três textos desatualizados sobre o motor aberto (a nota do assistente, a seção de escolha de motor e a tabela de cobertura de `docs/llm-providers.md`).
- Escopo fechado no refinamento e mantido no plano: os três textos da issue **mais** a linha das limitações conhecidas da mesma página, a nota honesta do README (duas línguas) e uma linha no CHANGELOG. Ficam fora `docs/configuration.md`, o comentário do `bridge.ts`, a seção de limitações sobre modelos pequenos e a promessa de testar modelos locais.
- **A pessoa confirmou que não há execução com modelo real depois das quatro registradas** (DeepSeek v4.1 flash pelo OpenRouter, no motor aberto, no runner, contra host falso). Decisão: a tabela **não** ganha cobertura nova; ela continua contando as quatro, e o documento de implementação diz que nada novo rodou.
- Prioridade `priority:medium`. Marco: nenhum.
- Implementação decidiu e fez: (1) `wizard.models.openEngineNote` nos dois catálogos, chave mantida, sem parâmetro, com o texto do plano; (2) `docs/llm-providers.md` — a passagem de escolha do motor apresentada como configuração (provedor → motor, papel → provedor e modelo), o bloco de variáveis de ambiente mantido só como recurso de teste, "o que a camada de configuração precisa entregar" virou "o que a seleção entrega", e o padrão de fontes de contexto deixou de ser atribuído ao gancho; (3) a linha das limitações conhecidas das duas línguas passou a descrever leitura, escrita confinada ao worktree e comandos da lista, sem rede; (4) a nota honesta do README nas duas línguas passou a contar o modelo real em quatro execuções no runner contra host falso e que nenhum provedor local foi testado; (5) entrada nova em `INTENDED` de `test/gitlab-catalogs-unchanged.test.ts` para `wizard.models.openEngineNote` (motivo, `language: 'both'`, sem `replace`) e fixture intacta; (6) linha em `## [Unreleased]` de `CHANGELOG.md`, seção Changed.

## Restrições

- A nota é string de interface: mesma chave `wizard.models.openEngineNote` nos dois catálogos, mesmos marcadores (nenhum), mesmo sentido.
- A cópia congelada `test/fixtures/catalogs-main/wizard.*.json` é o texto do `main` e **não** acompanha a mudança; `test/gitlab-catalogs-unchanged.test.ts` só aceita a diferença com a chave em `INTENDED`, motivo ≥20 caracteres.
- Sem número de issue, nome real, host ou segredo em texto, doc ou commit. Nenhum literal novo em código (`scripts/i18n-lint.mjs` cobre `src/renderer/src`, `src/main` e `src/shared`, não `docs/` nem README).
- Nada de comportamento muda: nenhuma chave de config, nenhum padrão, nenhuma ferramenta do modelo, nenhum texto enviado a modelo.

## Tentado e descartado

- Procurar execução real nova: nenhuma; a tabela ficou como estava.
- Mexer no corpo da tabela de cobertura e no texto ao redor: lidos inteiros, já contam as quatro execuções e o que não rodou; só a linha das limitações estava velha.
- Trocar o parâmetro `{ stage }` do prompt de etapa para esconder "Plan": descartado (mexeria em mais arquivos e catálogo congelado do principal).
- Investigar a fundo as 4 falhas da suíte inteira: são estouro de tempo e concorrência em `conflict-resolve`, `release-git`, `runner-chain` e `public-audit`; os quatro arquivos passam sozinhos. Não foi medido se também falham com o repositório sem esta mudança — não verificado.

## Perguntas abertas

- Nenhuma. A pergunta sobre execução real nova foi respondida pela pessoa (não houve). Segue como trabalho futuro, não como pergunta: a frase velha sobre a camada de configuração em `docs/configuration.md` e no `bridge.ts`, fora do escopo.

## Onde o trabalho está

- Triagem, refinamento, plano e implementação concluídos (`0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md`).
- Rodado nesta etapa: `npx tsc --noEmit` (0), `npm run i18n:lint` (0), `node scripts/theme-audit.mjs` (0), `node scripts/public-audit.mjs` (0), os quatro testes de catálogo (23 passam), `test/public-audit` + `conflict-resolve` + `runner-chain` (49 passam) e `test/release-git` (69 passam). A suíte inteira de uma vez: 218 arquivos passam, 4 falham por estouro de tempo/concorrência e passam sozinhos; **não verificado** se falham sem esta mudança. Nenhuma tela foi aberta e nenhuma execução com modelo real rodou.
- Diff: sete arquivos — `src/shared/i18n/wizard.en.json`, `src/shared/i18n/wizard.pt-BR.json`, `docs/llm-providers.md`, `README.md`, `README.pt-BR.md`, `test/gitlab-catalogs-unchanged.test.ts`, `CHANGELOG.md` — mais a memória do ciclo. Nenhum arquivo de comportamento.
- Onde segue: revisão, QA e a nota de quem abriu a issue.
- Passagem para a revisão: os textos mudados estão no `3_IMPLEMENTATION.md` e o diff toca só os sete arquivos listados; o ponto de atenção é o diff de catálogo (a fixture é do `main` e não acompanha) e a tabela de cobertura, que **não** devia mudar.
- Passagem support → product-owner: Atualizar os três textos: a nota do assistente nos dois catálogos (parando de dizer que o motor aberto só lê, dizendo que ele lê, escreve no worktree e roda comandos sob a mesma política do Claude Agent SDK, e que a qualidade depende do modelo), a seção de seleção de `docs/llm-providers.md` nas duas línguas (descrevendo a escolha provedor → motor em `llm.providers` e deixando o gancho de ambiente só como auxílio de teste, se ainda usado) e a tabela de cobertura da mesma página. A tarefa é de documentação e textos de interface, não de código de comportamento. Não verificado nesta etapa: nenhuma… <!-- handoff:7 -->
- Passagem product-owner → pessoa: Escrever os textos, sem mudar comportamento: (1) a nota do assistente nos dois catálogos (`wizard.models.openEngineNote` em `src/shared/i18n/wizard.{en,pt-BR}.json`), afirmando que o motor aberto é o loop de agente do app, que ele lê, escreve dentro do worktree do run e executa comandos sob a mesma política do Claude Agent SDK, e que a qualidade depende do modelo; (2) a seção de escolha de motor em `docs/llm-providers.md`, nas duas línguas, descrevendo provedor → motor em `llm.providers` e deixando o gancho de ambiente só como auxílio de teste; (3) a tabela de cobertura e o texto ao redor dela… <!-- handoff:16 -->
- Passagem tl-experiencia → pessoa: Implementar os textos do plano, sem mudar comportamento: (1) `wizard.models.openEngineNote` nos dois catálogos (`src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json`), com o texto proposto no plano (o motor aberto é o loop de agente do app; lê, escreve no worktree do run e roda comandos sob a mesma política do Claude Agent SDK; a qualidade depende do modelo), chave mantida e sem parâmetro; (2) a passagem de escolha de motor de `docs/llm-providers.md` nas duas línguas (provedor → motor em `llm.providers`, papel → provedor e modelo, gancho de ambiente só como recurso de teste) e a linha das lim… <!-- handoff:26 -->
