# Memória do ciclo

## Decisões

- A #220 é pedido de funcionalidade: publicar um site de documentação no GitHub Pages (landing, guia, referência, casos de uso, blog), escrito e mantido pelos agentes pelo ciclo normal.
- Squad `Plataforma`. Prioridade proposta `priority:medium`, como proposta a quem decide. Gate 1 e Gate 2 aprovados pelo app (o ciclo roda sozinho).
- Refino fechou: gerador **VitePress** (o de toolchain); pasta **`site/`**; referência **incluída de `docs/`**, nunca copiada nem movida; **domínio próprio fora do escopo**.
- Plano fechou o resto (2_PLAN.md): o agente de documentação é o **`docs-writer` que o modelo `docs-flow` já cria**, com `shell: 'none'` → `'sandbox'`. **Não** se cria um "onde escrever" no fluxo: um campo novo no esquema custaria migração e um caminho de escrita novo, e a cerca de hoje (um agente da pessoa com `permission: worktree` escreve o *worktree* inteiro) já cobre `site/`.
- A versão estável que abre o blog é `0.8.0`; a linha de status dos README cita a versão do arquivo de versão (`0.9.0-beta.15`).
- Imagem guardada por uma etapa chega ao commit pelo mecanismo que já existe (`copyToCycleFolder`), **só** com `runner.evidence: "cycle"` — escolha da pessoa, o padrão (`app`) não muda.
- **Revisão (2026-10-10):** veredito **`changes`**, com **um bloqueante**: a checagem de links do site não resolve nenhum link quando o site é construído com o prefixo de publicação que o fluxo `pages.yml` define (`SITE_BASE`), porque `site/scripts/check.mjs` junta um endereço absoluto à pasta construída sem retirar o prefixo (`targetOf`, linha 40). Conferido: com o prefixo a checagem sai `1` com 2242 linhas de link quebrado e o arquivo existe na pasta construída sem o prefixo; sem o prefixo as duas passam. O critério 2 e a regra 10 valem hoje só para a prévia local, e falta teste com prefixo. A revisão anterior desta mesma etapa (aprovada) perdeu este defeito; esta rodada o mantém como bloqueante.
- A contradição entre a regra 12 (a linha de status leva ao site) e o D10 do plano (nenhum endereço em arquivo nenhum) resolve-se a favor da spec: o endereço publicado fica nos dois README, e a sugestão é um teste que compare o endereço entre os dois arquivos. O caso novo sobre a cerca em `test/runner-docs.test.ts` **satisfaz** o bloco 8 do plano (é onde vivem `confin edHooks` e os testes de cerca). A reescrita dos links de `docs/` para o arquivo no host, com o endereço lido do `repository.url` do `package.json`, é **aceitável**.
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:313 -->
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:295 -->
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:298 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:301 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:304 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:307 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:310 -->

## Restrições

- O repositório é público: `scripts/public-audit.mjs` é gate de CI e vale para as fontes do site. Nada de empresa, pessoa, host, número real de issue ou segredo; placeholders neutros (`example.com`). **Não** se acrescentou exceção a `scripts/public-audit.allow.json` (as duas de hoje são sobre o segredo dos testes de mascaramento e um endereço de pacote de terceiros).
- `docs/` continua a fonte lida pelos agentes do aplicativo em tempo de execução: a referência é incluída no site, não movida nem copiada.
- Nada no aplicativo escreve Pages nem configuração de repositório: ligar o Pages é ato da pessoa no host, uma vez. O endereço publicado vem de uma variável do fluxo (`SITE_BASE`), nunca de um arquivo da árvore (exceto a menção nos dois README, decidida na revisão).
- O esquema de configuração continua **27**, sem migração: nenhum campo foi acrescentado ou alterado.
- Nenhuma string de interface entra aqui; o site não usa `t()` nem os tokens de tema do renderer (o `theme-audit` varre só `src/renderer/src`).
- A cerca de escrita de um agente do ciclo não mudou: o agente que escreve `site/` continua sujeito à mesma cerca (`.git`, ganchos, segredos, `memory/` do app, caminho que sai por link). Só a capacidade de rodar comandos na sandbox foi acrescentada.

## Tentado e descartado

- Varredura exaustiva de duplicatas sobre todas as issues: não é possível pela árvore.
- **Vincular o fluxo de documentação à pasta do site** (`devCycle.flows.docs` com um "onde escrever"): descartado — exigiria campo novo no esquema, migração e um caminho de escrita novo.
- **Escrever o template do site num arquivo que a etapa *commita* e depois *link*á-lo para `site/`**: um *link* que sai da pasta de trabalho é recusado pelo guarda.
- **Mudar o padrão de `runner.evidence` para `cycle`**: faria toda imagem de toda execução entrar em algum commit.
- **Quatro subagentes de exploração em paralelo, um por dimensão da revisão (regras, segurança, testes, desenho):** os quatro pararam por limite de voltas; o material foi levantado por leitura direta e por execução dos comandos decisivos.

## Perguntas abertas

Nenhuma. A revisão não deixou pergunta bloqueante.

## Onde o trabalho está

- Triagem, refino e plano em 2026-10-10 (tentativa 1): `0_TRIAGE.md`, `1_SPEC.md` (14 regras, 9 critérios antes da mesclagem e 5 depois), `2_PLAN.md` (17 decisões, 9 blocos, testes e riscos).
- **Implementação em 2026-10-10 (tentativa 1): `3_IMPLEMENTATION.md`; o código, os testes e o site estão na worktree (commit 3898d756).** Nove blocos: `site/` com VitePress preso em `1.6.4`; travessia de `docs/` e endereço por caminho; histórico e blog lidos do `CHANGELOG.md`; checagem de links e de línguas; `.github/workflows/pages.yml`; linha de status dos README; `docsWriter()` com `shell: 'sandbox'`; `docs/site.md` e o `CHANGELOG.md`. Esquema continua 27.
- **Revisão em 2026-10-10 (tentativa 1, refeita): `4_REVIEW.md`, veredito `changes`, um bloqueante e três sugestões.** Rodados no shell desta etapa: a auditoria pública (1733 arquivos, exit 0, com os arquivos do site na varredura); os seis arquivos de teste dos módulos do site, do README e da cerca do agente (71 testes, todos passam); a construção do site e a checagem nos dois endereços de origem.
- **O bloqueante, com o arquivo e a linha:** `site/scripts/check.mjs:40` — `targetOf` junta o endereço absoluto de um link à pasta construída sem retirar o prefixo de publicação; com `SITE_BASE=/cerimonias/` a checagem sai `1` e acusa 2242 linhas. A correção precisa de um caso de teste com prefixo.
- **Não verificado (nada disto foi exercitado):** a publicação no host, o site no ar, o Pages ligado, uma mudança posterior atualizando o site na mesclagem, o `npm ci` do fluxo, e o agente de documentação construindo o site com um modelo de verdade.
- **Segue para a implementação** (volta à revisão depois): corrigir a checagem com o prefixo de publicação e cobrir com teste. As sugestões que não bloqueiam: a linha de status dos dois README fixa o número da versão além do arquivo de versão, e o teste do endereço publicado aceita qualquer domínio; a linguagem de endereços das páginas de referência está repetida em três lugares (a função pura, a configuração e o gerador), com teste só na pura; falta um caso de borda para uma página do site que exista só numa língua.
- Passagem support → product-owner: Refinar a #220 a partir deste documento: fechar as escolhas em aberto (gerador VitePress vs Jekyll, pasta e roteamento de squad do agente, referência incluída de docs/ vs movida, domínio próprio) e detalhar a aceitação em passos verificáveis. Fica fora desta etapa decidir prioridade e milestone. Vale confirmar no código, antes do plano, o formato exato do fluxo de Pages e a checagem de links/línguas no CI. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Plano técnico: decidir o agente, o fluxo e o encaminhamento à pasta do site (a spec recomenda um agente novo da pessoa, com sandbox, encaminhado a `site/`) e o que isso muda numa configuração que já tem o agente do fluxo de documentação de hoje; decidir a forma técnica de incluir a referência de `docs/` sem copiá-la (montagem, ligação ou equivalente); dizer como a construção do site, a checagem de links e a checagem das duas línguas entram no fluxo de verificação; e resolver como uma imagem guardada por uma etapa chega ao repositório, já que as ferramentas de arquivo do agente que escreve só a… <!-- handoff:22 -->
- Passagem tl-plataforma → pessoa: Implementar o plano na ordem dos 9 commits, cada um com os gates do repositório verdes (auditoria pública, tipos, suíte, lint de idiomas, construção). Os quatro primeiros commits (1 a 4) são onde se decide o nome exato e a versão do gerador do site, se ele aceita a travessia da pasta de documentação sem uma lista de páginas escrita à mão, e se a checagem de links dele basta ou precisa do módulo próprio: construir o site e provocar um link quebrado e uma página de uma língua só. No commit 8, cobrir com um caso novo as recusas da cerca do agente que escreve quando o palco não é do fluxo de docum… <!-- handoff:49 -->
- Passagem developer → revisor-plataforma: Revisar a implementação contra a spec (docs/cycles/[redacted]/1_SPEC.md) e o plano (2_PLAN.md), sem editar. Pontos que merecem atenção na revisão: (1) o bloco 8 do plano dizia para criar um caso novo em `test/runner-agent.test.ts` sobre `run.docs`; o caso foi criado em `test/runner-docs.test.ts`, onde vivem `confinedHooks` e os testes de cerca — a revisão deve decidir se isso satisfaz o plano ou se o caso deve morar no outro arquivo; (2) a linha de status dos README cita o endereço publicado (`exatasmente.github.io/coxia`), que o plano (D10) queria fora de qualquer arquivo — a spec (regra 12) … <!-- handoff:280 -->
