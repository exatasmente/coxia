# Memória do ciclo

## Decisões

- A issue é pedido de correção de documentação: três textos desatualizados sobre o motor aberto (a nota do assistente, a seção de escolha de motor e a tabela de cobertura de `docs/llm-providers.md`).
- Escopo fechado no refinamento e mantido no plano: os três textos da issue **mais** a linha das limitações conhecidas da mesma página, a nota honesta do README (duas línguas) e uma linha no CHANGELOG. Ficam fora `docs/configuration.md`, o comentário do `bridge.ts`, a seção de limitações sobre modelos pequenos e a promessa de testar modelos locais.
- A pessoa confirmou que não há execução com modelo real depois das quatro registradas. A tabela **não** ganha cobertura nova; continua contando as quatro.
- Prioridade `priority:medium`. Marco: nenhum.
- Implementação fez: (1) `wizard.models.openEngineNote` nos dois catálogos, chave mantida, sem parâmetro; (2) `docs/llm-providers.md` — escolha do motor como configuração, gancho de ambiente só como recurso de teste, "a seleção entrega a `runOpenOnce`", padrão de fontes de contexto; (3) a linha das limitações conhecidas descrevendo leitura, escrita no worktree e comandos da lista; (4) a nota honesta do README nas duas línguas; (5) entrada em `INTENDED` de `test/gitlab-catalogs-unchanged.test.ts` (motivo, `language: 'both'`, sem `replace`), fixture intacta; (6) linha em `## [Unreleased]` do `CHANGELOG.md`.
- **Revisão aprovou.** O diff é só texto e documentação, nenhuma linha de comportamento. Os três textos mudados dizem o que o motor faz, a fixture congelada continua com o texto do `main` e a tabela de cobertura não foi tocada.

## Restrições

- A nota é string de interface: mesma chave `wizard.models.openEngineNote` nos dois catálogos, mesmos marcadores (nenhum), mesmo sentido.
- A cópia congelada `test/fixtures/catalogs-main/wizard.*.json` é o texto do `main` e **não** acompanha a mudança; `test/gitlab-catalogs-unchanged.test.ts` só aceita a diferença com a chave em `INTENDED`, motivo ≥20 caracteres.
- Sem número de issue, nome real, host ou segredo em texto, doc ou commit. Nenhum literal novo em código.
- Nada de comportamento muda: nenhuma chave de config, nenhum padrão, nenhuma ferramenta do modelo, nenhum texto enviado a modelo.
- A seção histórica `[0.1.0]` do CHANGELOG e a fixture congelada mantêm as frases velhas de propósito.

## Tentado e descartado

- Procurar execução real nova: nenhuma; a tabela ficou como estava.
- Mexer no corpo da tabela de cobertura e no texto ao redor: lidos inteiros, já contam as quatro execuções e o que não rodou; só a linha das limitações estava velha.
- Trocar o parâmetro `{ stage }` do prompt de etapa para esconder "Plan": descartado (mexeria em mais arquivos).
- Medir se os estouros de tempo da suíte inteira acontecem também sem esta mudança: não deu — o orçamento de comandos da revisão acabou depois da suíte inteira. Segue não verificado.

## Perguntas abertas

- Nenhuma. Segue como trabalho futuro, não como pergunta: a frase velha sobre a camada de configuração em `docs/configuration.md` e no `bridge.ts`, fora do escopo.

## Onde o trabalho está

- Triagem, refinamento, plano, implementação e revisão concluídos (`0_TRIAGE.md` a `4_REVIEW.md`).
- Rodado na revisão: `npx tsc --noEmit` (0), `npm run i18n:lint` (0), `node scripts/public-audit.mjs` (0), `node scripts/theme-audit.mjs` (0), os quatro testes de catálogo (23 passam) e a suíte inteira (215 arquivos passam, 7 falham por estouro de tempo em arquivos de git/update — `conflict-resolve`, `release-git`, `runner-chain`, `updates-source`, `update-script`, `runner-release`, `conflict-policy` —, nenhum de catálogo ou doc). **Não verificado** se esses estouros também ocorrem sem esta mudança. Nenhuma tela foi aberta e nenhuma execução com modelo real rodou.
- Diff: sete arquivos — `src/shared/i18n/wizard.en.json`, `src/shared/i18n/wizard.pt-BR.json`, `docs/llm-providers.md`, `README.md`, `README.pt-BR.md`, `test/gitlab-catalogs-unchanged.test.ts`, `CHANGELOG.md` — mais a memória do ciclo. Nenhum arquivo de comportamento.
- Onde segue: QA e a nota de quem abriu a issue.
- Passagem revisão → QA: verificar sobretudo os dois pontos que a suíte inteira não cobriu sozinha — que a fixture congelada segue byte a byte igual e que o teste de catálogos passa verde com a entrada nova em `INTENDED` — e conferir a suíte inteira em máquina menos carregada.
- Passagem support → product-owner: Atualizar os três textos: a nota do assistente nos dois catálogos (parando de dizer que o motor aberto só lê, dizendo que ele lê, escreve no worktree e roda comandos sob a mesma política do Claude Agent SDK, e que a qualidade depende do modelo), a seção de seleção de `docs/llm-providers.md` nas duas línguas (descrevendo a escolha provedor → motor em `llm.providers` e deixando o gancho de ambiente só como auxílio de teste, se ainda usado) e a tabela de cobertura da mesma página. A tarefa é de documentação e textos de interface, não de código de comportamento. Não verificado nesta etapa: nenhuma… <!-- handoff:7 -->
- Passagem product-owner → pessoa: Escrever os textos, sem mudar comportamento: (1) a nota do assistente nos dois catálogos (`wizard.models.openEngineNote` em `src/shared/i18n/wizard.{en,pt-BR}.json`), afirmando que o motor aberto é o loop de agente do app, que ele lê, escreve dentro do worktree do run e executa comandos sob a mesma política do Claude Agent SDK, e que a qualidade depende do modelo; (2) a seção de escolha de motor em `docs/llm-providers.md`, nas duas línguas, descrevendo provedor → motor em `llm.providers` e deixando o gancho de ambiente só como auxílio de teste; (3) a tabela de cobertura e o texto ao redor dela… <!-- handoff:16 -->
- Passagem tl-experiencia → pessoa: Implementar os textos do plano, sem mudar comportamento: (1) `wizard.models.openEngineNote` nos dois catálogos (`src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json`), com o texto proposto no plano (o motor aberto é o loop de agente do app; lê, escreve no worktree do run e roda comandos sob a mesma política do Claude Agent SDK; a qualidade depende do modelo), chave mantida e sem parâmetro; (2) a passagem de escolha de motor de `docs/llm-providers.md` nas duas línguas (provedor → motor em `llm.providers`, papel → provedor e modelo, gancho de ambiente só como recurso de teste) e a linha das lim… <!-- handoff:26 -->
- Passagem dev-experiencia → tl-experiencia: Revisar o diff dos sete arquivos (nenhum de comportamento) contra o `3_IMPLEMENTATION.md`. Pontos de atenção: (a) a fixture `test/fixtures/catalogs-main/wizard.*.json` não pode ter mudado — só a entrada em `INTENDED` de `test/gitlab-catalogs-unchanged.test.ts`; (b) a tabela de cobertura e o texto ao redor de `docs/llm-providers.md` **não** deviam mudar (nada novo rodou); (c) as frases velhas — "ferramentas só de leitura"/"read-only tools", "a camada de configuração vai trocar"/"the configuration layer will replace", "por enquanto a seleção"/"For now selection", "só foi testado contra um servid… <!-- handoff:55 -->
