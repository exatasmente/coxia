# Memória do ciclo

## Decisões

- A #220 é pedido de funcionalidade: publicar um site de documentação no GitHub Pages (landing, guia, referência, casos de uso, blog), escrito e mantido pelos agentes pelo ciclo normal.
- Squad `Plataforma`. Prioridade proposta `priority:medium`, como proposta a quem decide. Gate 1 e Gate 2 aprovados pelo app (o ciclo roda sozinho).
- Refino fechou: gerador **VitePress** (o de toolchain); pasta **`site/`**; referência **incluída de `docs/`**, nunca copiada nem movida; **domínio próprio fora do escopo**.
- Plano fechou o resto (2_PLAN.md): o agente de documentação é o **`docs-writer` que o modelo `docs-flow` já cria**, com `shell: 'none'` → `'sandbox'`. **Não** se cria um "onde escrever" no fluxo: um campo novo no esquema custaria migração e um caminho de escrita novo, e a cerca de hoje (um agente da pessoa com `permission: worktree` escreve o *worktree* inteiro, porque `writeRoot`/`writeAllow` só existem em execução do fluxo de documentação) já cobre `site/`.
- A versão estável que abre o blog é `0.8.0`; a linha de status dos README passa a citar a versão do arquivo de versão (`0.9.0-beta.15`).
- Imagem guardada por uma etapa chega ao commit pelo mecanismo que já existe (`copyToCycleFolder`), **só** com `runner.evidence: "cycle"` — escolha da pessoa, o padrão (`app`) não muda. Sem esse caminho, nada de captura de tela é prometido.

## Restrições

- O repositório é público: `scripts/public-audit.mjs` é gate de CI e vale para as fontes do site. Nada de empresa, pessoa, host, número real de issue ou segredo; placeholders neutros (`example.com`). **Não** se acrescentou exceção a `scripts/public-audit.allow.json`.
- `docs/` continua a fonte lida pelos agentes do aplicativo em tempo de execução: a referência é incluída no site, não movida nem copiada.
- Nada no aplicativo escreve Pages nem configuração de repositório: ligar o Pages é ato da pessoa no host, uma vez. O endereço publicado vem de uma variável do fluxo (`SITE_BASE`), nunca de um arquivo da árvore.
- O esquema de configuração continua **27**, sem migração: nenhum campo foi acrescentado ou alterado.
- Nenhuma string de interface entra aqui; o site não usa `t()` nem os tokens de tema do renderer.
- A cerca de escrita de um agente do ciclo não mudou: o agente que escreve `site/` continua sujeito à mesma cerca (`.git`, ganchos, segredos, `memory/` do app, caminho que sai por link).

## Tentado e descartado

- Varredura exaustiva de duplicatas sobre todas as issues: não é possível pela árvore.
- `git ls-files` não está disponível nesta sandbox (o `.git` não é acessível).
- **Vincular o fluxo de documentação à pasta do site** (`devCycle.flows.docs` com um "onde escrever"): descartado — exigiria campo novo no esquema, migração e um caminho de escrita novo.
- **Escrever o template do site num arquivo que a etapa *commita* e depois *link*á-lo para `site/`**: um *link* que sai da pasta de trabalho é recusado pelo guarda.
- **Mudar o padrão de `runner.evidence` para `cycle`**: faria toda imagem de toda execução entrar em algum commit.
- **Dois subagentes de exploração em paralelo:** os dois pararam por limite de voltas; o material foi levantado por leitura direta. Um subagente de revisão do diff também parou no limite de voltas; a revisão foi feita por leitura direta.

## Perguntas abertas

## Onde o trabalho está

- Triagem, refino e plano em 2026-10-10 (tentativa 1): `0_TRIAGE.md`, `1_SPEC.md` (14 regras, 9 critérios antes da mesclagem e 5 depois), `2_PLAN.md` (17 decisões, 9 blocos, testes e riscos).
- **Implementação em 2026-10-10 (tentativa 1): `3_IMPLEMENTATION.md` escrito; o código, os testes e o site estão na worktree.** Nove blocos: `site/` com VitePress preso em `1.6.4`; travessia de `docs/` e endereço por caminho; histórico e blog lidos do `CHANGELOG.md`; checagem de links e de línguas; `.github/workflows/pages.yml`; linha de status dos README; `docsWriter()` com `shell: 'sandbox'`; `docs/site.md` e o `CHANGELOG.md`. Esquema continua 27.
- **Quatro correções que o plano não fixava** e a execução encontrou: (1) as fontes geradas vão para `site/generated/` (a varredura de páginas do gerador não desce numa pasta com ponto — `.vitepress/sources` era invisível); (2) a geração roda quando a configuração é carregada, porque o gerador pede as páginas antes de qualquer gancho da construção (`onAfterConfigResolve` chega tarde — conferido em `resolveConfig`); (3) os endereços das páginas geradas saem de `rewrites`; (4) links de dentro de `docs/` para arquivos que não são páginas do site são reescritos para o arquivo no host, com o endereço lido do `repository.url` do `package.json`. Também foi preciso escapar, fora de trechos de código, o texto que o compilador leria como etiqueta (`<stage>`, `<nome>`), que quebrava a construção.
- **Portões rodados e verdes em 2026-10-10:** `npx tsc --noEmit`, `npx vitest run` (7662 testes), `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` (1732 arquivos), `npx electron-vite build`, `npm run docs:build` (79 páginas) e `npm run docs:check`. O site foi conduzido em `127.0.0.1:4123` com Playwright (doze páginas, duas línguas); as duas falhas que a checagem existe para pegar foram provocadas e reprovam com `exit 1`.
- **Não verificado (nada disto foi exercitado):** a publicação no host, o site no ar, o Pages ligado, uma mudança posterior atualizando o site na mesclagem, o `npm ci` do fluxo, e o agente de documentação construindo o site com um modelo de verdade.
- **Dois pontos para a revisão decidir:** (1) o bloco 8 do plano pedia o caso novo sobre `run.docs` em `test/runner-agent.test.ts`; ele foi escrito em `test/runner-docs.test.ts`, onde vivem `confinedHooks`; (2) a linha de status dos README cita o endereço publicado, e o D10 do plano queria endereço em arquivo nenhum — a spec (regra 12) pede que a linha leve ao site.
- Passagem support → product-owner: Refinar a #220 a partir deste documento: fechar as escolhas em aberto (gerador VitePress vs Jekyll, pasta e roteamento de squad do agente, referência incluída de docs/ vs movida, domínio próprio) e detalhar a aceitação em passos verificáveis. Fica fora desta etapa decidir prioridade e milestone. Vale confirmar no código, antes do plano, o formato exato do fluxo de Pages e a checagem de links/línguas no CI. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Plano técnico: decidir o agente, o fluxo e o encaminhamento à pasta do site (a spec recomenda um agente novo da pessoa, com sandbox, encaminhado a `site/`) e o que isso muda numa configuração que já tem o agente do fluxo de documentação de hoje; decidir a forma técnica de incluir a referência de `docs/` sem copiá-la (montagem, ligação ou equivalente); dizer como a construção do site, a checagem de links e a checagem das duas línguas entram no fluxo de verificação; e resolver como uma imagem guardada por uma etapa chega ao repositório, já que as ferramentas de arquivo do agente que escreve só a… <!-- handoff:22 -->
- Passagem tl-plataforma → pessoa: Implementar o plano na ordem dos 9 commits, cada um com os gates do repositório verdes (auditoria pública, tipos, suíte, lint de idiomas, construção). Os quatro primeiros commits (1 a 4) são onde se decide o nome exato e a versão do gerador do site, se ele aceita a travessia da pasta de documentação sem uma lista de páginas escrita à mão, e se a checagem de links dele basta ou precisa do módulo próprio: construir o site e provocar um link quebrado e uma página de uma língua só. No commit 8, cobrir com um caso novo as recusas da cerca do agente que escreve quando o palco não é do fluxo de docum… <!-- handoff:49 -->
