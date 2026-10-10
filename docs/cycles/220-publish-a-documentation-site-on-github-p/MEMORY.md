# Memória do ciclo

## Decisões

- A #220 é pedido de funcionalidade: publicar um site de documentação no GitHub Pages (landing, guia, referência, casos de uso, blog), escrito e mantido pelos agentes pelo ciclo normal.
- Squad `Plataforma`. Prioridade proposta `priority:medium` (nada quebra sem o site; documentação pública desatualizada e pedido grande), como proposta a quem decide.
- Refino fechou: gerador **VitePress** (o de toolchain); pasta **`site/`**; referência **incluída de `docs/`**, nunca copiada nem movida; **domínio próprio fora do escopo**.
- Plano fechou o resto (2_PLAN.md, tentativa 1): o agente de documentação é o **`docs-writer` que o modelo `docs-flow` já cria**, com `shell: 'none'` → `'sandbox'` (permissão de escrita e rastreador como estão). **Não** se cria um "onde escrever" no fluxo: um campo novo no esquema custaria migração e um caminho de escrita novo, e a cerca de hoje (um agente da pessoa com `permission: worktree` escreve o *worktree* inteiro, porque `writeRoot`/`writeAllow` só existem em execução do fluxo de documentação) já cobre `site/`.
- A referência entra pela travessia de `docs/` na construção: uma página por documento, com endereço derivado do caminho, sem lista paralela e sem copiar o arquivo; a língua de cada bloco vem dos títulos do próprio arquivo.
- A página do histórico e o blog saem do `CHANGELOG.md` na construção, com o extrator que o repositório já tem para a nota de release como fonte.
- As três checagens do site (constrói, links, duas línguas) entram **na etapa `check` do fluxo de verificação que já existe** (é ele que reprova o pedido de merge); a publicação é um fluxo `pages.yml` novo, com a fonte de publicação do host.
- A versão estável que abre o blog é `0.8.0` (a primeira seção estável do histórico); a linha de status dos README passa a citar a versão do **arquivo de versão** (hoje `0.9.0-beta.15`), nunca escrita à mão.
- Imagem guardada por uma etapa chega ao commit pelo mecanismo que já existe: a peça é copiada para a pasta do ciclo (`copyToCycleFolder`) **só** com `runner.evidence: "cycle"`, escolha da pessoa (o padrão é `app`, e o plano não o muda). Sem esse caminho, nada de captura de tela é prometido (regra 8: texto e espaço reservado até o outro pedido chegar).

## Restrições

- O repositório é público: `scripts/public-audit.mjs` é gate de CI e vale para as fontes do site (rastreados + não ignorados; nada ignora uma pasta de site). Nada de empresa, pessoa, host, número real de issue ou segredo; placeholders neutros (`example.com`). O endereço real do site publicado não é escrito em arquivo: no fluxo ele vem de uma variável do fluxo. **Não** se acrescenta exceção a `scripts/public-audit.allow.json` (só tem duas entradas hoje, nenhuma sobre host de site).
- `docs/` é lido pelos agentes do aplicativo em tempo de execução: a referência é incluída no site, não movida nem copiada.
- Nada no aplicativo escreve Pages nem configuração de repositório: ligar o Pages é ato da pessoa no host, uma vez.
- O esquema de configuração continua 27 e não há migração: nenhum campo é acrescentado ou alterado (um campo novo exigiria `STEPS`, `types.ts`, `defaults.ts` e `schema.ts`).
- Nenhuma string de interface entra aqui; a regra de `t()` é do renderer, não do site. O site não usa os tokens de tema do renderer.
- A permissão de escrita de um agente do ciclo não é um caminho novo: o agente que escreve `site/` continua sujeito à mesma cerca (`.git`, ganchos, segredos, `memory/` do app, caminho que sai por link) e a rede da sandbox é só o proxy do app, para os hosts nomeados do agente.

## Tentado e descartado

- Varredura exaustiva de duplicatas sobre todas as issues: não é possível pela árvore.
- `git ls-files` não está disponível nesta sandbox (o `.git` não é acessível).
- **Vincular o fluxo de documentação à pasta do site** (`devCycle.flows.docs` com um "onde escrever"): descartado no plano — exigiria campo novo no esquema, migração e um caminho de escrita novo, para entregar o que a cerca do agente comum já entrega.
- **Escrever o template do site dentro do que o agente constrói num arquivo que a etapa *commita*, e depois *link*á-lo para a pasta `site/` do repositório**: não resolve — um *link* que sai da pasta de trabalho é recusado pelo guarda, e nada que a etapa escreva fora da pasta do ciclo é levado ao repositório pelo app. O caminho que existe é a peça copiada para a pasta do ciclo.
- **Mudar o padrão de `runner.evidence` para `cycle`** para as imagens chegarem sozinhas: descartado (faria toda imagem de toda execução entrar em algum commit).
- **Dois subagentes de exploração em paralelo** (levantamento do repositório e do agente/execução): os dois pararam por limite de voltas sem entregar; o material foi levantado por leitura direta.

## Perguntas abertas

- Nenhuma bloqueia a implementação. Se a entrega do site exigir que os documentos do ciclo do próprio site fiquem versionados dentro da pasta do site (o critério 14 fala de "um fluxo de documentação com gate"), isso é um segundo pedido: o `docs-flow` escreve o estado privado da execução fora do site, e o plano usa o fluxo que existe.

## Onde o trabalho está

- Triagem em 2026-10-10 (tentativa 1): `0_TRIAGE.md`. Refino em 2026-10-10 (tentativa 1): `1_SPEC.md` (14 regras, 9 itens de aceitação antes da mesclagem e 5 depois da publicação ligada).
- Plano em 2026-10-10 (tentativa 1): `2_PLAN.md`, com 17 decisões, o que muda por camada, 9 commits com arquivo e função, 13 testes, 13 riscos, o que cobre dos critérios e o que fica de fora, e o que foi conferido por leitura.
- Próximo: implementação, na ordem dos 9 commits. Os quatro primeiros decidem o nome e a versão exatos do gerador, a travessia de `docs/` e a checagem de links.
- **Nada foi executado em nenhuma etapa**: todo item que depende de construir o site, de prévia local, de integração contínua, de host ou da lista de hosts do agente segue não exercitado.
- Passagem support → product-owner: Refinar a #220 a partir deste documento: fechar as escolhas em aberto (gerador VitePress vs Jekyll, pasta e roteamento de squad do agente, referência incluída de docs/ vs movida, domínio próprio) e detalhar a aceitação em passos verificáveis. Fica fora desta etapa decidir prioridade e milestone. Vale confirmar no código, antes do plano, o formato exato do fluxo de Pages e a checagem de links/línguas no CI. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Plano técnico: decidir o agente, o fluxo e o encaminhamento à pasta do site (a spec recomenda um agente novo da pessoa, com sandbox, encaminhado a `site/`) e o que isso muda numa configuração que já tem o agente do fluxo de documentação de hoje; decidir a forma técnica de incluir a referência de `docs/` sem copiá-la (montagem, ligação ou equivalente); dizer como a construção do site, a checagem de links e a checagem das duas línguas entram no fluxo de verificação; e resolver como uma imagem guardada por uma etapa chega ao repositório, já que as ferramentas de arquivo do agente que escreve só a… <!-- handoff:22 -->
