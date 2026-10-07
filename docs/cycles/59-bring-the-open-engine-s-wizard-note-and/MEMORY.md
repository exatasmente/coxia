# Memória do ciclo

## Decisões

- A issue é pedido de correção de documentação: três textos desatualizados sobre o motor aberto (a nota do assistente, a seção de escolha de motor e a tabela de cobertura de `docs/llm-providers.md`).
- Escopo fechado no refinamento e mantido no plano e na implementação: os três textos da issue **mais** a linha das limitações conhecidas da mesma página, a nota honesta do README (duas línguas) e uma linha no CHANGELOG. Ficam fora `docs/configuration.md`, o comentário do `bridge.ts`, a seção de limitações sobre modelos pequenos e a promessa de testar modelos locais.
- A pessoa confirmou que não há execução com modelo real depois das quatro registradas. A tabela **não** ganhou cobertura nova; continua contando as quatro.
- Prioridade `priority:medium`. Marco: nenhum.
- Implementação fez: (1) `wizard.models.openEngineNote` nos dois catálogos, chave mantida, sem parâmetro; (2) `docs/llm-providers.md` — escolha do motor como configuração, gancho de ambiente só como recurso de teste, "a seleção entrega a `runOpenOnce`", padrão de fontes de contexto; (3) a linha das limitações conhecidas descrevendo leitura, escrita no worktree e comandos da lista; (4) a nota honesta do README nas duas línguas; (5) entrada em `INTENDED` de `test/gitlab-catalogs-unchanged.test.ts` (motivo, `language: 'both'`, sem `replace`), fixture intacta; (6) linha em `## [Unreleased]` do `CHANGELOG.md`.
- **Revisão aprovou; QA aprovou.** O commit da mudança (`4150452`) são sete arquivos, nenhum de comportamento: só texto de interface, documentos e o livro de testes.
- **QA verificou cada critério de aceite por execução nesta máquina** (ver "Onde o trabalho está"); nenhum critério ficou vermelho.

## Restrições

- A nota é string de interface: mesma chave `wizard.models.openEngineNote` nos dois catálogos, mesmos marcadores (nenhum), mesmo sentido.
- A cópia congelada `test/fixtures/catalogs-main/wizard.*.json` é o texto do `main` e **não** acompanha a mudança; `test/gitlab-catalogs-unchanged.test.ts` só aceita a diferença com a chave em `INTENDED`, motivo ≥20 caracteres.
- Sem número de issue, nome real, host ou segredo em texto, doc ou commit. A auditoria pública passou com os textos novos; o único endereço real que aparece em README/CHANGELOG é o do próprio projeto, que já está publicado.
- Nada de comportamento muda: nenhuma chave de config, nenhum padrão, nenhuma ferramenta do modelo, nenhum texto enviado a modelo.
- A seção histórica `[0.1.0]` do CHANGELOG e a fixture congelada mantêm as frases velhas de propósito.

## Tentado e descartado

- Procurar execução real nova: nenhuma; a tabela ficou como estava.
- Mexer no corpo da tabela de cobertura: lida inteira, já conta as quatro execuções e o que não rodou.
- Trocar o parâmetro `{ stage }` do prompt de etapa para esconder "Plan": descartado (mexeria em mais arquivos).
- Rodar a suíte inteira por padrão (`npx vitest run`): estoura o tempo do comando. Rodada em segundo plano com `--maxWorkers=2` completou em 727 s.
- **Medido agora o que ficou pendente na revisão: com `--maxWorkers=2` a suíte inteira dá 221 arquivos e 3663 testes passando, 1 teste vermelho** — `voice-setup` "reports a failed install to the error log…", estouro de 5 s. Rodado sozinho, o mesmo teste passa (exit 0). É ruído de carga, sem relação com o diff, e **não** foram os 7 arquivos de git que a revisão viu com a suíte em paralelo.

## Perguntas abertas

- Nenhuma. Segue como trabalho futuro, não como pergunta: a frase velha sobre a camada de configuração em `docs/configuration.md` e no `bridge.ts`, fora do escopo.

## Onde o trabalho está

- Triagem, refinamento, plano, implementação, revisão e QA concluídos (`0_TRIAGE.md` a `5_TEST_PLAN.md` da revisão/QA). Falta só a nota de quem abriu a issue.
- Commit da mudança: `4150452` ("feat: update the open engine wizard note and provider docs #59"), sete arquivos de texto/doc/teste. A implementação fez o commit; QA não alterou código.
- **Rodado na QA (nesta máquina, agora):** `npx tsc --noEmit` (0), `npm run i18n:lint` (0; 4054 chaves nas duas línguas, 0 literais), `node scripts/theme-audit.mjs` (0; 55 pares de contraste no claro e no escuro, 8 cores literais em `api.ts`, número de antes), `node scripts/public-audit.mjs` (0; 911 arquivos), os quatro testes de catálogo (`23 passed`, exit 0), a suíte inteira com `--maxWorkers=2` (221 arquivos / 3663 testes passando, 1 vermelho por estouro de tempo em `voice-setup`, que passa sozinho) e `npx vitest run test/voice-setup.test.ts` (exit 0).
- **Verificado por execução:** os dez critérios de aceite da especificação. Nenhuma frase velha sobrou em `docs/llm-providers.md` nem no README; a tabela de cobertura não foi tocada (o diff não tem hunk nela); a fixture congelada segue com o texto do `main`; a chave da nota aparece no mesmo lugar para provedores que não são Claude e os dois idiomas dizem o mesmo; as três afirmações novas da nota batem com `buildTools` (`loop.ts:135-153`), com `openSelection`/`engineFor` e com os limites que a própria página já declara.
- **Não verificado:** nada foi aberto na tela (a nota do assistente foi conferida no catálogo e no ponto de uso, não renderizada); nenhuma execução com modelo real; se o estouro do `voice-setup` também acontece sem esta mudança (o diff não toca nada que o teste exercite).
- Diff do ciclo: só a memória foi reescrita por esta etapa; os sete arquivos da mudança estão no commit da implementação.
- Onde segue: comentário de QA e a nota de quem abriu a issue.
- Passagem support → product-owner: Atualizar os três textos: a nota do assistente nos dois catálogos (parando de dizer que o motor aberto só lê, dizendo que ele lê, escreve no worktree e roda comandos sob a mesma política do Claude Agent SDK, e que a qualidade depende do modelo), a seção de seleção de `docs/llm-providers.md` nas duas línguas (descrevendo a escolha provedor → motor em `llm.providers` e deixando o gancho de ambiente só como auxílio de teste, se ainda usado) e a tabela de cobertura da mesma página. A tarefa é de documentação e textos de interface, não de código de comportamento. Não verificado nesta etapa: nenhuma… <!-- handoff:7 -->
- Passagem product-owner → pessoa: Escrever os textos, sem mudar comportamento: (1) a nota do assistente nos dois catálogos (`wizard.models.openEngineNote` em `src/shared/i18n/wizard.{en,pt-BR}.json`), afirmando que o motor aberto é o loop de agente do app, que ele lê, escreve dentro do worktree do run e executa comandos sob a mesma política do Claude Agent SDK, e que a qualidade depende do modelo; (2) a seção de escolha de motor em `docs/llm-providers.md`, nas duas línguas, descrevendo provedor → motor em `llm.providers` e deixando o gancho de ambiente só como auxílio de teste; (3) a tabela de cobertura e o texto ao redor dela… <!-- handoff:16 -->
- Passagem tl-experiencia → pessoa: Implementar os textos do plano, sem mudar comportamento: (1) `wizard.models.openEngineNote` nos dois catálogos (`src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json`), com o texto proposto no plano (o motor aberto é o loop de agente do app; lê, escreve no worktree do run e roda comandos sob a mesma política do Claude Agent SDK; a qualidade depende do modelo), chave mantida e sem parâmetro; (2) a passagem de escolha de motor de `docs/llm-providers.md` nas duas línguas (provedor → motor em `llm.providers`, papel → provedor e modelo, gancho de ambiente só como recurso de teste) e a linha das lim… <!-- handoff:26 -->
- Passagem dev-experiencia → tl-experiencia: Revisar o diff dos sete arquivos (nenhum de comportamento) contra o `3_IMPLEMENTATION.md`. Pontos de atenção: (a) a fixture `test/fixtures/catalogs-main/wizard.*.json` não pode ter mudado — só a entrada em `INTENDED` de `test/gitlab-catalogs-unchanged.test.ts`; (b) a tabela de cobertura e o texto ao redor de `docs/llm-providers.md` **não** deviam mudar (nada novo rodou); (c) as frases velhas — "ferramentas só de leitura"/"read-only tools", "a camada de configuração vai trocar"/"the configuration layer will replace", "por enquanto a seleção"/"For now selection", "só foi testado contra um servid… <!-- handoff:55 -->
- Passagem tl-experiencia → qa-experiencia: Aprovar a mudança. A revisão não achou defeito bloqueante: os sete arquivos são texto e documentação, os catálogos mudaram a mesma chave nos dois idiomas com a diferença declarada no teste, a fixture congelada está intacta e a tabela de cobertura não foi tocada. `tsc`, o lint de i18n, as duas auditorias e os quatro testes de catálogo passaram. A suíte inteira tem estouros de tempo em arquivos de git, sem relação com o diff; não foi possível medir se falham sem a mudança por limite de comandos da etapa. Falta a nota de quem abriu a issue. <!-- handoff:81 -->
