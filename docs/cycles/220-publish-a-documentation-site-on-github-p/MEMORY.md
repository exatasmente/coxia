# Memória do ciclo

## Decisões

- #220 pede um site de documentação no GitHub Pages (landing, guia, referência, casos de uso, blog) escrito e mantido pelos agentes pelo ciclo normal. Squad `Plataforma`; `priority:medium`; gates 1 e 2 aprovados pelo app.
- Refino fechou: gerador **VitePress**; pasta **`site/`**; referência **incluída de `docs/`**, nunca copiada; domínio próprio fora do escopo.
- Plano: o agente `docs-writer` que o modelo `docs-flow` já cria passa a ter `shell: 'sandbox'` (permissão `worktree` continua); esquema continua **27**, sem migração. Onde a máquina não tem sandbox, o modelo baixa `sandbox` para os comandos de antes (`withoutSandbox`).
- Versão que abre o blog: **0.8.0** (estável); a linha de status dos dois README cita a versão do arquivo de versão e leva ao endereço publicado, contrariando a D10 do plano a favor da regra 12.
- Imagem de etapa só chega ao commit com `runner.evidence: "cycle"` (o padrão é `app`); nada muda o padrão.
- O prefixo de publicação nunca vive em arquivo: a construção o recebe do fluxo e a checagem o lê da própria construção (`baseOf`, `withinBase`, `targetOf`).
- A checagem de línguas nomeia o par pela forma que o site escreve: pasta `pt-br/` para páginas escritas à mão, marca `.pt-br` e endereço `/reference/…` para páginas geradas. A página cujo par existe ao lado passa sem link próprio (a navegação leva); um link que leva a uma página que não é o par reprova.
- Um documento de português com o inglês sob um segundo título (`# … (English)`) vira duas páginas (`blocksOf`); um documento de uma língua só continua uma página.
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:313 -->
- Resposta: Volta e pede o ajuste que falta e somente os que faltam <!-- answer:493 -->
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:295 -->
- Resposta: O pull request está sendo aberto de novo contra a branch release/0.9.0. <!-- answer:298 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:301 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:304 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:307 -->
- Resposta: O pull request está sendo aberto de novo contra a branch main. <!-- answer:310 -->

## Restrições

- Repositório público: `node scripts/public-audit.mjs` é portão e vale para as fontes do site; nada de empresa, pessoa, host privado, número real de issue ou segredo; nenhuma exceção nova em `scripts/public-audit.allow.json`. O único endereço publicado no repositório são as duas linhas de status dos README (regra 12).
- `docs/` continua sendo a fonte lida pelos agentes; a referência é incluída, não copiada. `CONFIG_SCHEMA_VERSION` segue 27.
- Nada da construção entra no commit: `site/generated/`, `site/.vitepress/dist/` e `site/.vitepress/cache/` são ignorados.
- A cerca de escrita do agente que escreve não mudou; só a capacidade de rodar comandos na sandbox foi acrescentada. Nenhuma string de interface do desktop passa por aqui.
- `runner.evidence: "cycle"` é escolha da pessoa, nunca o padrão.
- As sugestões não bloqueantes (o teste do endereço dos README aceitar qualquer host; a checagem de links não olhar `src`; as páginas escritas à mão não ligarem as línguas por link) continuam fora do escopo destas passadas.

## Tentado e descartado

- Exigir `SITE_BASE` no ambiente da checagem: descartado; o prefixo é lido da construção.
- Escrever o prefixo num campo da página gerada: descartado; os endereços de `assets/` já o dizem.
- Vincular o fluxo de documentação à pasta do site (`devCycle.flows.docs`): descartado (campo novo, migração, caminho de escrita novo).
- Exigir o link que leva de uma língua para a outra nas páginas escritas à mão: permanece sugestão, não coberta.

## Perguntas abertas

Nenhuma.

## Onde o trabalho está

- Triagem, refino e plano: `0_TRIAGE.md`, `1_SPEC.md` (14 regras, 14 critérios), `2_PLAN.md` (17 decisões, 9 blocos).
- Implementação: `site/` com VitePress preso em 1.6.4; travessia de `docs/`; blog e histórico do `CHANGELOG.md`; `pages.yml`; linha de status dos README; `docsWriter()` com sandbox; `docs/site.md`; esquema 27. Testes: `test/site-check.test.ts` (20), `test/site-docs-pages.test.ts` (8), `test/site-changelog.test.ts` (11), `test/readme-status.test.ts` (3), `test/site-reference-languages.test.ts` (3, **2 vermelhos**).
- **Rodadas 1 a 4 da revisão:** veredicto `changes` nas quatro. Corrigidos: o prefixo da checagem de links; a regra de candidatos e os três casos vermelhos da rodada 2.
- **Rodada 4 (esta):** a tentativa de fechar o bloqueante da rodada 3 mudou a checagem para percorrer `generated/` e julgar as fontes geradas por documento, mas **continua sem ler `docs/`**: um documento bilíngue que perde a metade portuguesa é escrito como página de uma língua só, marcada `site: one-language`, e a checagem a dispensa (`site/scripts/check.mjs:188`; marca escrita em `site/.vitepress/build-sources.mjs:127`). Bloqueantes desta rodada: (1) o critério 13 continua não atendido; (2) `npx tsc --noEmit` sai 1 (`test/site-reference-languages.test.ts(42,62)` TS7006) e a suíte tem 2 falhas no arquivo novo. Verdes: theme-audit, i18n:lint, public-audit (1734), a construção com `SITE_BASE=/cerimonias/` e sua checagem (0). Provado que a checagem pega um link quebrado (mesmo com o prefixo) e que pega a remoção artificial de só o arquivo gerado `.pt-br`; não pega o documento que perde a língua.
- Passagem revisor-plataforma → developer (rodada 4): ler `docs/` na checagem e julgar pelo documento (par obrigatório), reescrever os casos do teste novo para as mensagens reais, e fazer o typecheck passar.
- Passagem support → product-owner: Refinar a #220 a partir deste documento: fechar as escolhas em aberto (gerador VitePress vs Jekyll, pasta e roteamento de squad do agente, referência incluída de docs/ vs movida, domínio próprio) e detalhar a aceitação em passos verificáveis. Fica fora desta etapa decidir prioridade e milestone. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Plano técnico: decidir o agente, o fluxo e o encaminhamento à pasta do site, como incluir a referência sem copiá-la, como a construção e as checagens entram no fluxo de verificação e como uma imagem de etapa chega ao repositório. <!-- handoff:22 -->
- Passagem tl-plataforma → pessoa: Implementar o plano na ordem dos 9 commits, cada um com os gates verdes. <!-- handoff:49 -->
- Passagem developer → revisor-plataforma (rodada 1): revisar a implementação contra a spec e o plano. <!-- handoff:280 -->
- Passagem revisor-plataforma → developer (rodada 1): a checagem de links não resolve link algum quando o site é construído com o prefixo de publicação. <!-- handoff:346 -->
- Passagem developer → revisor-plataforma (rodada 2): deixar verdes os três casos vermelhos, decidir `assetsOf`/`checkAssets` e conferir o bloco de código de `site/README.md`. <!-- handoff:386 -->
- Passagem pessoa → developer: Volta e pede o ajuste que falta e somente os que faltam <!-- handoff:494 -->
- Passagem developer → revisor-plataforma (rodada 3): conferir a regra de nomeação do par e o documento de duas línguas sob um segundo título. <!-- handoff:577 -->
- Passagem developer → revisor-plataforma (rodada 3): terminar a correção da checagem de línguas e rodar todos os portões. <!-- handoff:705 -->
- Passagem revisor-plataforma → developer: Round 3 of the review of the documentation site. The round-2 blocking finding is fixed and verified here: the language check now names the pair a page actually has (the pt-br/ folder beside a hand-written page, the mirrored name for a Portuguese half, the /reference/… address with the .pt-br mark for a generated page), and the three site test files that were red are green (38 cases in the four site/readme test files, the whole suite 7673 passed / 3 skipped / 0 failed). One point the handoff asked to confirm — a document written in Portuguese with its English half under a second title — behaves… <!-- handoff:626 -->
