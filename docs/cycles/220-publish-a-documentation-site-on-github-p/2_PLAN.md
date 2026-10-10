# O site de documentação entra no repositório, é publicado pelo fluxo e é escrito por um agente

Este é o plano técnico do pedido de site de documentação (landing, guia, referência, casos de uso e blog) no host de código. Ele decide o que a spec deixou em aberto — o agente, o fluxo e o encaminhamento à pasta do site, a forma de incluir a referência de `docs/` sem copiá-la, onde entram a construção do site, a checagem de links e a checagem das duas línguas, e como uma imagem guardada por uma etapa chega ao repositório — e descreve cada mudança com arquivo e função, a ordem, um teste por comportamento, os riscos e as decisões.

Nada aqui foi executado: a conferência foi de leitura, contra a árvore de trabalho. Todo item que depende de construir o site, abrir a prévia local, rodar a integração contínua ou publicar segue **não verificado**.

---

## 1. Decisões fechadas aqui

| # | Decisão | Motivo |
|---|---|---|
| D1 | Gerador **VitePress**, numa pasta `site/` própria, com o pacote preso por versão exata nas dependências de desenvolvimento | O repositório já tem Vite e electron-vite (`package.json`); a issue pede uma abertura que parece produto |
| D2 | A referência de `docs/` **não é copiada nem movida**: a configuração do site lê os documentos do lugar onde eles estão e o site os alcança a partir de `docs/` | A spec fixa (regra 1) e `docs/` é lido pelos agentes do aplicativo em tempo de execução (`docs/harness.md`, `docs/runner.md`); a mesma árvore sustenta o site |
| D3 | O **texto de cada bloco** de um documento bilíngue vem do arquivo do repositório: uma transformação monta os blocos no lugar de escrever Markdown novo por página | A spec registra que o texto de um bloco é o arquivo; reescrevê-lo faria duas cópias que divergem |
| D4 | **VitePress com o tema de fábrica**, sem tema visual próprio nesta mudança | Os tokens de tema valem para a interface do desktop, não para o site; um tema de repositório é trabalho de design a decidir depois |
| D5 | O agente de documentação é o **`docs-writer`** que o modelo `docs-flow` já cria (`src/shared/cycles/templates/docsFlow.ts:32-46`), mudando três campos: `permission: 'worktree'`, `shell: 'sandbox'`, `tracker: 'none'`, e `screen: true` na configuração da pessoa | A cerca de escrita de um agente da pessoa com `worktree` já é o *worktree* inteiro (`src/main/runner/executor.ts:1008-1009` usa `writeRoot` só quando `run.docs`), então um agente comum escreve `site/` sem nenhum mecanismo novo; o fluxo, o gate, o push e o pull request de hoje valem como estão |
| D6 | O fluxo de documentação **não** ganha um "onde escrever": vincular o fluxo à pasta exigiria um campo novo no esquema, uma migração e um caminho de escrita novo — risco desproporcional | A config do esquema 27 não tem o conceito; a restrição real do agente hoje vem do próprio fluxo, não de uma configuração. A spec descreve o **resultado** (um agente da pessoa com sandbox que escreve `site/` pelo ciclo), e é o que esta mudança entrega |
| D7 | O site constrói com `docs/` disponível: as permissões da construção no CI incluem a leitura do **histórico** do git | A página do histórico e os textos do blog saem do `CHANGELOG.md` na hora de construir, não de uma cópia; a construção não depende de ler o host |
| D8 | As três checagens do site (constrói, links resolvem, as duas línguas têm todas as páginas) rodam **na etapa `check` do fluxo de verificação que já existe** | É o fluxo que reprova o pedido de merge hoje (`.github/workflows/ci.yml`), e acrescentar uma etapa ali é uma linha em vez de um fluxo que pode não ser exigido |
| D9 | A publicação é o fluxo **`.github/workflows/pages.yml`** novo, com uma pasta `site/` no repositório e o gatilho no fluxo de publicação que o host oferece | A spec diz que a pessoa liga a publicação uma vez, no host; o fluxo copia um artefato pré-construído para a fonte do host |
| D10 | Todo lugar do repositório que precisar de um endereço de exemplo (documentação, testes do site, textos de amostra) usa o espaço reservado neutro `example.com`; o endereço real do site publicado **não** é escrito em nenhum arquivo — no fluxo de publicação ele vem de uma variável do próprio fluxo. `scripts/public-audit.allow.json` não ganha entrada nova | Uma entrada de exceção sem um `match` estreito silenciaria o padrão inteiro num arquivo; e o repositório é público (a auditoria é portão de integração contínua). Hoje esse arquivo tem exatamente duas entradas (`test/**` para o segredo dos testes de mascaramento e `package-lock.json` para um endereço de um pacote de terceiros), e nenhuma delas é sobre um host de site |
| D11 | Imagens de etapa no repositório: a captura vai para o **arquivo do ciclo** (a pasta que a etapa já *commita*, dentro do ciclo de documentação) e daí para o site pelo mecanismo que já existe; enquanto as capturas do outro pedido não chegarem, nenhuma imagem real é usada | `copyToCycleFolder` (`src/main/evidence/store.ts:167-176`) copia a peça guardada para `<pasta do ciclo>/evidence/` antes do commit, **mas só com a configuração ligada** (D12). Nada de capturar tela pelo agente é construído aqui, e a cerca de escrita do arquivo do ciclo não muda: o destino continua sendo `site/` dentro da pasta de trabalho da execução |
| D12 | O ajuste de configuração que faz uma peça chegar ao commit é **`runner.evidence: "cycle"`**, escolha da pessoa em Configurações › Runner, e o plano diz isso em vez de mudar o padrão | O campo existe e é `optional` no esquema (`src/shared/config/schema.ts:580`, padrão `evidence: 'app'` em `src/shared/config/defaults.ts:37`); mudá-lo para `cycle` faria toda imagem de toda execução entrar em algum commit, o que não é desta mudança |
| D13 | A navegação (barra e menu) é escrita à mão, cartão por cartão; a lista de páginas da referência é **derivada da pasta `docs/`** na hora de construir | São duas listas de tamanhos diferentes: a navegação é editorial, e a referência precisa crescer sozinha (regra 5) |
| D14 | A página do histórico e o blog **vêm do `CHANGELOG.md`** e de nenhuma segunda cópia | A spec fixa (regras 6 e 7); `scripts/release-changelog.mjs` já faz esse trabalho para a nota de release e é a fonte do extrator do site |
| D15 | A versão estável publicada que abre o blog é lida do arquivo onde ela mora (`package.json`, hoje `0.9.0-beta.15`) e a primeira seção **estável** do histórico é a que tem texto de blog (hoje `0.8.0`) | O histórico ainda não tem seção `[0.8.0]` nesta árvore: as duas primeiras seções são `[Unreleased]` e `[0.9.0-beta.15]` (`CHANGELOG.md:7,9`). As duas leituras são de arquivo, não de memória de conversa |
| D16 | A linha de status dos dois README diz a versão do arquivo de versão, com marca de canal quando ela tem sufixo, e leva ao site | A linha de hoje diz `Status: 0.1, primeira versão pública` (`README.pt-BR.md:7`, `README.md:7`); o arquivo de versão diz `0.9.0-beta.15`. Uma promessa de "a versão estável" envelheceria na mesma semana em que a versão estável muda |
| D17 | O gerador do site na integração contínua sai de um pacote preso por versão exata, e a chave de cache da construção é a versão desse pacote | A chave do cache do fluxo de verificação é derivada de `package-lock.json` (o fluxo das ações de `setup-node` com `cache: npm`); presa por versão exata, uma atualização do gerador muda o `package-lock.json` e derruba o cache |

---

## 2. O que muda, por camada

### 2.1 A pasta do site e a construção

- **`package.json`** — nova dependência de desenvolvimento `vitepress` presa por **versão exata** (sem `^`), na ordem alfabética do bloco `devDependencies`, e três scripts: `docs:dev` (prévia local), `docs:build` (constrói o site) e `docs:check` (checagem do site). O bloco de scripts hoje é `dev`, `build`, `start`, `typecheck`, `test`, `i18n:lint`, `dist`, `dist:public`.
- **`THIRD_PARTY_NOTICES.md`** — regerado com `node scripts/third-party-notices.mjs` depois de instalar a dependência nova. O script lê só `dependencies` (`collectNpm`, `scripts/third-party-notices.mjs:112-136`), então o VitePress **não entra** na tabela; a rodada existe porque tocar no `package-lock.json` é o mesmo caminho e o repositório gera esse arquivo com um script próprio. Verificar na implementação se a lista muda; se não mudar, o arquivo não é tocado.
- **`site/`** — a pasta do site, versionada. Conteúdo:
  - `site/.vitepress/config.mts` — a configuração: título, descrição, os endereços das páginas, a **barra e o menu** escritos à mão, e a lista de páginas da referência **derivada** de `docs/` na hora de construir.
  - `site/.vitepress/theme/` — o ajuste de tema (arquivo próprio), o mínimo para a abertura parecer um produto. Sem cor literal: o site é outro projeto e não entra em `scripts/theme-audit.mjs`, que conta literais do renderer.
  - `site/index.md`, `site/guide/*.md`, `site/use-cases/*.md`, `site/blog/index.md` — as páginas escritas por gente (ou por agente), nas duas línguas.
  - `site/scripts/*.mjs` — os módulos puros que o site acrescenta ao VitePress em tempo de construção: derivar as páginas da referência de `docs/`, montar os blocos por língua, extrair uma seção do histórico, montar a página do histórico e os textos do blog, e a checagem de links e a de línguas.
  - `site/README.md` — o que a pasta é, quem a escreve, como rodar a prévia e como o site é publicado.
- **`.github/workflows/ci.yml`** — a etapa `check` ganha três passos depois de `Build` (`npx electron-vite build`, hoje a última etapa, linha 52): instalar a prévia do gerador (uma vez), construir o site e conferir links e línguas. As permissões do trabalho continuam `contents: read` (`ci.yml:10`); a construção leva `fetch-depth` suficiente para ler o histórico do git (por isso D7).

### 2.2 O fluxo que publica

- **`.github/workflows/pages.yml`** (novo) — nome próprio; gatilhos: o envio na ramificação padrão e o gatilho manual do host. Permissões: leitura do conteúdo, escrita da fonte de publicação e o `id-token` que a fonte do host pede. Trabalho único: baixar a árvore, instalar Node na versão de `.nvmrc` com cache do npm, instalar dependências, construir o site com o mesmo comando do repositório, e usar a ação de publicação do host apontando para a pasta construída. Nenhum passo escreve configuração de repositório: ligar a publicação continua sendo um ato da pessoa no host (regra 2).

### 2.3 As fontes do site

- **A referência vem de `docs/`, lida onde está.** A configuração do site inclui os arquivos de `docs/` como fontes e o site constrói uma página por documento, com endereço derivado do caminho do arquivo. A lista de páginas da referência é a travessia de `docs/`, o que faz um documento novo ter endereço sem uma lista paralela (regra 5).
- **A língua de cada bloco de `docs/` é resolvida pelos títulos do arquivo.** Onze documentos trazem a dupla `## Português` / `## English` no mesmo arquivo (`docs/configuration.md:7` é o primeiro deles; o índice declara as línguas em `docs/README.md:7-19`). Quatro não têm as duas seções: `docs/i18n.md`, `docs/voice.md`, `docs/verify-commands.md` e `docs/images/README.md`. Estes não são traduzidos por esta mudança (a spec os deixa fora): o site mostra a página que existe, e a checagem de línguas só exige as duas línguas onde o arquivo as tem.
- **A página do histórico e o blog saem do `CHANGELOG.md`.** O extrator é o do repositório: `parse` e `status` de `scripts/release-changelog.mjs:26-66` (ou o `scripts/release-notes.sh`, que imprime a seção de uma versão). Em tempo de construção o site lê o arquivo, monta a página do histórico a partir das seções e, para o blog, pega a seção estável mais recente como primeiro texto (hoje `0.8.0`).
- **A versão que aparece nas páginas** vem do `package.json` — o mesmo arquivo que o aplicativo lê para responder a versão do produto (`manifestOf`, `src/main/memory/facts.ts:153-169`, que prefere `package.json` e aceita um valor com sufixo como `0.9.0-beta.15`).

### 2.4 O agente e o ciclo

- **`src/shared/cycles/templates/docsFlow.ts`** — `docsWriter()` muda: `shell: 'none'` passa a `'sandbox'`; `permission` continua `'worktree'`; `tracker` continua `'none'`. O comentário da função muda junto (ele hoje diz "não roda comando").
- **`src/shared/config/team.ts:213`** — `RECOMMENDED['docs-writer']` passa de `{ tracker: 'none', shell: 'none' }` para `{ tracker: 'none', shell: 'sandbox' }`, para a recomendação do editor de time não contradizer o modelo aplicado.
- **`src/shared/i18n/main.pt-BR.json` / `main.en.json`** — o texto do papel do agente (`cycle.docsFlow.team.docsWriter.job` e `.instructions`) diz hoje que ele só escreve o arquivo de instruções da raiz. Passa a dizer o que ele faz: lê o código e os documentos, mantém o site da pasta do site e o arquivo de instruções, roda comandos na sandbox do palco e não lê o host de código.
- **A cerca de escrita não muda.** Um agente com `permission: 'worktree'` numa execução que **não** é do fluxo de documentação não recebe `writeRoot` nem `writeAllow` (`src/main/runner/executor.ts:1008-1009`), então pode escrever qualquer caminho dentro do *worktree*, inclusive `site/`. Continuam recusados: `.git`, as pastas de gancho, arquivos de segredo, o `memory/` do aplicativo e caminhos que saem do *worktree* por link simbólico (`src/main/runner/hooks.ts:69-92`, `src/main/engine/guard.ts`).
- **O que o agente precisa que a pessoa configure, uma vez:**
  - a pasta de navegadores em Configurações › Runner › Sandbox (a que já existe, em geral uma pasta de navegadores do Playwright), porque é assim que o comando do agente alcança um navegador dentro da sandbox;
  - a **tela virtual** em Configurações › Runner › Sandbox, porque é assim que uma etapa ganha um `DISPLAY` (uma tela X virtual, de tamanho fixo, que sobe com a etapa e morre com ela) e a ferramenta de olhar uma imagem;
  - a **tela do agente** (o interruptor do agente que lhe dá a tela virtual e as ferramentas de navegador do aplicativo);
  - **a lista de hosts permitidos do agente**: o nome do host do site publicado, para a verificação pós-publicação (regra 11). A lista é da pessoa: nada no aplicativo nem no modelo de ciclo a traz. A regra do campo é a do esquema (`src/shared/config/schema.ts:286`): nomes exatos em minúsculas, sem curinga e sem porta, no máximo 20 entradas.
  - se o texto do site for citar uma imagem guardada por uma etapa, **`runner.evidence: "cycle"`** (D11, D12).
- **O recorte das capturas de tela do outro pedido não é desta mudança.** O prompt de sandbox diz ao agente, entre outras coisas, como testar uma interface, mas o texto que ensina "como capturar uma tela para o site" é entrega do pedido das imagens. Aqui só entra a frase que proíbe imagem real de pessoa, empresa ou host (regra 8).

### 2.5 A porta

Nenhuma linha nova de efeito externo. O agente que escreve `site/` **propõe** o push e o pedido de merge pelo caminho de sempre (`src/main/runner/door.ts`, `src/main/actions.ts`): a pessoa dá o "sim". O aplicativo não ganha escrita de configuração de repositório nem de publicação.

---

## 3. Ordem das mudanças, arquivo e função

Um commit por bloco, na ordem; cada um fecha o comportamento que descreve.

| # | Commit (assunto) | Arquivos e funções |
|---|---|---|
| 1 | `feat: add the site generator and its folder` | `package.json`: `devDependencies.vitepress` (versão exata) e os scripts `docs:dev`, `docs:build`, `docs:check`. `site/.vitepress/config.mts` (novo), `site/.vitepress/theme/` (novo), `site/index.md`, `site/README.md` |
| 2 | `feat: build the site from the documentation folder` | `site/scripts/docs-pages.mjs`: `referencePages(root)`, `blocksOf(text)`, `langOf(block)`, `pageFor(doc)`, `pagePath(doc, lang)`. `site/.vitepress/config.mts`: a travessia de `docs/` e a lista de páginas da referência |
| 3 | `feat: add the changelog page and the blog to the site` | `site/scripts/changelog.mjs`: `parse(text)`, `status(text, version)`, `recentStable(text)`, `historyPage(sections)`, `postOf(version, body)`, `blogPosts(text)`. `site/blog/index.md`; a página do histórico gerada na configuração |
| 4 | `feat: check the site links and languages` | `site/scripts/check.mjs`: `walkHtml(dir)`, `linksOf(html, file)`, `checkLinks(dir)`, `checkLanguages(root)`, `checkSite(root)`. `site/scripts/cli.mjs`: o ponto de entrada que os scripts do `package.json` chamam |
| 5 | `feat: build the site in the check workflow` | `.github/workflows/ci.yml`: três passos depois de `npx electron-vite build` e o `fetch-depth` da construção |
| 6 | `feat: publish the site with a workflow` | `.github/workflows/pages.yml` (novo) |
| 7 | `feat: point the readme at the published site` | `README.md:7` e `README.pt-BR.md:7`: a linha de status e as duas seções de documentação (`README.md:166-168` "Documentation", `README.pt-BR.md:166-168` "Documentação") |
| 8 | `feat: give the documentation writer a sandbox` | `src/shared/cycles/templates/docsFlow.ts`: `docsWriter()`; `src/shared/config/team.ts:213`: `RECOMMENDED['docs-writer']`; `src/shared/i18n/main.pt-BR.json` e `main.en.json`: `cycle.docsFlow.team.docsWriter.job` e `.instructions`; `docs/harness.md` e `docs/runner.md`: a descrição do agente e do fluxo; `test/cycle-templates.test.ts` e `test/agent-permissions-config.test.ts`: os dois casos existentes ajustados |
| 9 | `docs: describe the documentation site` | `docs/site.md` (novo, pt-BR e en), `docs/README.md` (a linha do índice), `CONTRIBUTING.md` (a linha do site na tabela de scripts), `CHANGELOG.md` sob `## [Unreleased]` |

Não há passo de migração em nenhum commit: nenhum campo de configuração é acrescentado, alterado ou removido. `CONFIG_SCHEMA_VERSION` continua 27 (`src/shared/config/types.ts:5`) e `STEPS` continua com 26 entradas (`src/shared/config/migrations.ts:406`).

---

## 4. Um teste por comportamento

Os módulos novos do site são JavaScript puro, sem o VitePress, para serem testáveis na suíte do repositório (Vitest, em Node). Os arquivos ficam em `site/scripts/` e importam o arquivo do repositório, nunca um site construído.

| Comportamento | Arquivo de teste | O que ele falha sem |
|---|---|---|
| A travessia da pasta de documentação lista cada arquivo de referência, ignora a pasta de histórico de ciclo e trata o índice de uma pasta de documentos como a página dela | `test/site-docs-pages.test.ts` | `referencePages` |
| Um arquivo com as duas línguas vira dois blocos, na ordem do arquivo, cada um com o endereço da língua dele; um arquivo de uma língua só vira um bloco | `test/site-docs-pages.test.ts` | `blocksOf`, `langOf` |
| O endereço de uma página é estável e deriva do caminho do arquivo (um documento novo ganha endereço sem lista paralela) | `test/site-docs-pages.test.ts` | `pagePath` |
| O extrator acha a seção de uma versão pelo cabeçalho e devolve o corpo sem o cabeçalho; não devolve a seção de outra versão e não confunde `[Unreleased]` com uma versão | `test/site-changelog.test.ts` | `parse`, `status` |
| A página do histórico segue o arquivo: mudar o texto de uma seção muda o que a página monta, e nenhuma segunda cópia de histórico é versionada | `test/site-changelog.test.ts` | `historyPage` |
| O blog abre com o texto da versão **estável** mais recente e ignora as seções de beta | `test/site-changelog.test.ts` | `recentStable`, `postOf` |
| A checagem de links reprova um link para uma página que não existe e passa quando todas resolvem | `test/site-check.test.ts` | `checkLinks` |
| A checagem de línguas reprova uma página que só existe numa língua e passa quando as duas existem | `test/site-check.test.ts` | `checkLanguages` |
| O agente de documentação do modelo tem sandbox e continua sem rastreador e com a permissão de escrita, e o fluxo continua com as cinco etapas na ordem | `test/cycle-templates.test.ts` (caso existente, ajustado) | `docsWriter()` |
| A recomendação de permissões do papel `docs-writer` acompanha o modelo | `test/agent-permissions-config.test.ts` (caso existente, ajustado) | `RECOMMENDED['docs-writer']` |
| Nenhum arquivo do site traz nome de empresa, de pessoa, de host, número real de issue ou segredo | `test/public-audit.test.ts` (caso existente, `auditRoot` sobre a raiz) | A varredura da árvore inteira |
| Os dois README dizem a versão atual e levam ao site, e nenhum deles diz a versão de estreia | `test/readme-status.test.ts` (novo) | A linha de status e o link |
| A cerca de escrita de um agente que escreve continua valendo quando o palco não é do fluxo de documentação: `writeRoot`/`writeAllow` só existem com a execução de documentação, `Edit`/`Write` continuam oferecidos, e `.git`, arquivo de segredo e caminho fora do *worktree* continuam recusados | `test/runner-agent.test.ts` (caso existente, um caso novo sobre `run.docs`) | `writes && run.docs` em `src/main/runner/executor.ts:1008-1009` |
| O aplicativo não chama nada de configuração de publicação no host: nenhuma referência de escrita no host fora dos fluxos declarados | `test/vcs-writes.test.ts` (a garantia existente de que só a porta escreve) e a leitura dos fluxos no pedido de merge | — |

Os testes que dependem de navegador (construir e abrir o site, conduzir a página) **não** entram na suíte: a suíte não alcança a rede nem um navegador de verdade, e o repositório já diz isso (`CONTRIBUTING.md:63-70`). Eles são a verificação de etapa e a de QA, com a prévia no endereço local da máquina, dentro da sandbox.

---

## 5. Riscos e como são evitados

| Risco | Como é evitado ou conferido |
|---|---|
| **Publicar sem chave de site.** A pasta construída precisa carregar a marca de origem que a publicação espera; sem ela, a primeira publicação fica sem estilo ou não sobe | O repositório não pode cravar o endereço dele (auditoria pública): a construção do site no fluxo recebe o endereço de origem na hora, de uma variável do próprio fluxo, e a prévia local usa o endereço local. A verificação é abrir a prévia e, depois da publicação, abrir o site publicado |
| **Um link que resolve só na prévia** (endereço absoluto do host local, barra final, extensão de arquivo) | As regras de link e de endereço base são decididas uma vez na configuração do site e conferidas na prévia e na checagem de links (regra 10) |
| **A auditoria pública pega um domínio real nos arquivos do site** | Nada de endereço literal de host no repositório: só o endereço local e marcadores neutros. Conferido rodando a auditoria |
| **O endereço de uma página de referência quebra quando um documento muda de nome** | O endereço deriva do caminho do arquivo; uma página renomeada muda de endereço e a checagem de links pega quem apontava para o endereço antigo |
| **Trabalhar com `docs/` de dentro do site acopla o site aos documentos** | É o que a spec pede (regra 1). O acoplamento é de leitura: nenhum arquivo de `docs/` é alterado pelos commits do site, e o teste do extrator falha se a forma dos documentos mudar |
| **O agente de documentação passa a rodar comandos e a cerca se abre demais** | A permissão de escrita continua **sem** `writeRoot`: a cerca é o *worktree*, exatamente o que todo agente que escreve já tem. Os recusados continuam recusados (`src/main/runner/hooks.ts:69-92`); a rede da sandbox é só o proxy do aplicativo, para os hosts nomeados. Um teste conferindo as recusas (`Bash` fora da lista permitida, o `.git`, um segredo, um caminho que sai por link) é obrigatório no commit 8 |
| **O agente de documentação troca o arquivo de instruções da raiz pelo site** | O fluxo continua produzindo o documento de notas da importação na primeira etapa (`docs-draft` produz `IMPORT_NOTES.md`, `src/shared/cycles/templates/docsFlow.ts:20`), e o texto de instruções do agente diz o que ele escreve. O gate da pessoa continua entre o rascunho e a publicação |
| **Construir o site na etapa `check` deixa o fluxo de verificação caro** | A construção é Node puro, sem navegador; a mesma chave de cache do fluxo (a versão do gerador, D17) faz o passo ser barato depois da primeira vez. Se ficar caro, a saída é mover os três passos para um trabalho próprio do mesmo fluxo de verificação — nunca para um fluxo que não reprova o pedido de merge |
| **A saída construída do site e a pasta de dependências entram no commit** | A construção escreve numa pasta que o `.gitignore` já cobre e as dependências ficam em `node_modules/`, também ignorado (linhas 1 a 10 do `.gitignore`); nada é construído dentro de `site/`. Conferido no commit do site |
| **A linha de status dos README diz uma versão que não é a publicada** | Ela é lida do arquivo de versão, nunca escrita à mão (D16). Um teste falha se um dos dois README deixar de citar a versão do arquivo ou faltar com o link do site |
| **Uma imagem de etapa nunca chega ao repositório** | O caminho existente é `runner.evidence: "cycle"` mais a cópia do arquivo do ciclo (D11). Enquanto as capturas do outro pedido não chegarem, o site fica em texto e espaço reservado (regra 8) e nada é prometido além disso |
| **O agente publica algo sozinho** | O push e o pedido de merge continuam passando pela porta, com o "sim" (seção 2.5). Nenhum caminho novo de escrita é criado |
| **A árvore pública ganha um arquivo que a auditoria recusa** | Cada commit roda `node scripts/public-audit.mjs`; qualquer acerto é corrigido ou entra como exceção justificada e curta em `scripts/public-audit.allow.json` (D10) |

---

## 6. O que este plano cobre, e o que fica de fora

**Cobre**, dos critérios de aceitação da spec: 1 (a mudança acrescenta o site, o fluxo e a checagem e passa nos portões — os commits 1 a 9 e os testes da seção 4), 2 (constrói, links e línguas — a checagem do site), 3 e 4 (as seções nas duas línguas e cada documento de referência alcançável — a travessia de `docs/`), 5 (a página do histórico segue o arquivo), 6 (o blog abre com a versão estável), 7 (nenhuma imagem real), 8 (a publicação declarada e o aplicativo fora da configuração de repositório), 9 (a linha de status dos dois README) e 14 (o agente de documentação pelo ciclo normal — o commit 8, com a verificação dependendo de o documento de especificação ser versionado junto do site, ver abaixo).

**Não cobre (e diz por quê):**

- **O item 10** (o site responde no endereço dentro da execução do fluxo) e o **item 12** (uma mudança posterior atualiza o site na mesclagem) são verificáveis só depois que a pessoa liga a publicação e mescla. O plano entrega o fluxo; a verificação é da pessoa.
- **O item 11** (o site publicado conferido de dentro do aplicativo) depende de o site estar no ar **e** da lista de hosts do agente, que só a pessoa configura. O plano diz os dois (seção 2.4); não pode conferi-los.
- **O item 13** (a checagem pega as duas falhas) tem o passo no plano e o teste; a verificação de que a etapa reprova o pedido de merge é da integração contínua.
- **Uma decisão de escopo que o plano não pode tomar:** o critério 14 diz que a mudança do site chega "num fluxo de documentação com gate", e a spec registra que um documento de especificação do ciclo será versionado junto do código. Este plano **usa o fluxo de documentação que existe** (`docs-flow`: rascunho, gate, publicação, espera) e faz o agente ter sandbox; **não** cria um fluxo novo com pasta de ciclo. Se a entrega exigir que os documentos do ciclo do próprio site fiquem versionados dentro da pasta do site, isso é um segundo pedido — o `docs-flow` escreve o estado privado da execução fora do site. **Pergunta ao product owner**, registrada em `question`.
- **Capturas de tela automáticas e refeitas a cada versão:** é o outro pedido (as imagens da documentação). Aqui entra só o caminho para uma imagem guardada chegar ao repositório (D11, D12).
- **Domínio próprio:** fora do escopo (a spec). O plano não o menciona em nenhuma página.
- **A página de capturas planejadas do repositório** (`docs/images/README.md`, indexada em `docs/README.md:32-36`): ela é uma lista de pendências e a travessia da referência vai alcançá-la. Não é traduzida nem reescrita por esta mudança (a spec a deixa fora); se isso incomodar na prévia, é uma linha na lista de exclusão da travessia, decidida na implementação.
- **Traduzir os documentos que hoje são só em inglês** (`docs/i18n.md`, `docs/voice.md`, `docs/verify-commands.md`): fora do escopo, como a spec diz.
- **Publicar qualquer coisa além do site:** nada de pacote ou artefato de versão no fluxo de publicação.

**Buraco conhecido, dito para não parecer coberto:** o `README.md` e o `README.pt-BR.md` ainda descrevem o estado de estreia em outros pontos além da linha de status; a mudança mexe só na linha e na seção de documentação, como a spec pede (regra 12).

---

## 7. O que esta etapa verificou

Foi **lido, não executado**. A conferência contra a árvore de trabalho, nesta etapa:

- **A pasta `docs/`**: os arquivos de referência são `configuration.md`, `cycles.md`, `harness.md`, `i18n.md`, `llm-providers.md`, `memory.md`, `procedures.md`, `runner.md`, `updates.md`, `vcs-providers.md`, `voice.md`, `verify-commands.md` e `README.md`, mais as pastas `cycles/` (documentos de ciclo), `examples/` (um arquivo de exemplo) e `plugins/` (o kit e dois exemplos). Nada disso é movido.
- **As línguas**: onze documentos trazem `## Português` e `## English` no mesmo arquivo (`configuration.md`, `llm-providers.md`, `vcs-providers.md`, `cycles.md`, `runner.md`, `procedures.md`, `memory.md`, `harness.md`, `plugins/README.md`, `updates.md` — e o índice declara as línguas em `docs/README.md:7-19`); quatro não (`i18n.md`, `voice.md`, `verify-commands.md`, `images/README.md`), e `docs/images/README.md` **não** traz o produto no corpo do texto (nenhum acerto de auditoria por isso).
- **A ferramenta de construção**: `package.json` tem `vite ^7.3.6`, `electron-vite ^5.0.0`, `vitest ^5.0.3` e `typescript ^7.0.2` nas dependências de desenvolvimento; `.nvmrc` diz `v26.5.1`. `.gitignore` ignora `node_modules/` (linha 1), `out/` (linha 2) e `dist/` (linha 10); nada ignora uma pasta `site/`.
- **A integração contínua**: `ci.yml` roda em envio e pedido de merge para a ramificação padrão e as ramificações de release, com `contents: read` (linha 10); a etapa `check` termina com `npx electron-vite build` (linha 52). `release.yml` tem gatilho de etiqueta de versão e não compartilha nada com um site. Nenhum fluxo publica hoje.
- **O histórico**: as seções são `## [Unreleased]` (linha 7), `## [0.9.0-beta.15] - 2026-10-10` (linha 9) e `## [0.9.0-beta.14] - 2026-10-09` (linha 23). A primeira versão **estável** com seção é `0.8.0`. O extrator de uma seção existe (`scripts/release-changelog.mjs:59`, `scripts/release-notes.sh`) e **não** é usado por nenhum fluxo do site hoje.
- **Os README**: a linha de status está em `README.md:7` e `README.pt-BR.md:7` (as duas dizem `0.1`); as seções de documentação são `README.md:166` (`## Documentation`) e `README.pt-BR.md:166` (`## Documentação`), cada uma com a linha 168 apontando para o índice. O arquivo de versão diz `0.9.0-beta.15` (`package.json:3`).
- **A cerca do agente que escreve**: `writeRoot` e `writeAllow` só existem quando a execução é do fluxo de documentação (`src/main/runner/executor.ts:1008-1009`); sem eles, o agente escreve em qualquer lugar do *worktree* (`src/main/runner/hooks.ts:69-92`, `src/main/engine/guard.ts`). Um agente com `screen: true` ganha a tela virtual e as ferramentas de navegador do aplicativo, e uma etapa de QA ou de navegador ganha a tela por conta própria (`src/main/runner/executor.ts:449`, `src/main/sandbox/index.ts:320-330`, `src/main/runner/service.ts:1523`).
- **A chegada de uma imagem ao commit**: a peça guardada por uma etapa é copiada para a pasta do ciclo e entra no commit **só** com `runner.evidence: "cycle"` (padrão `'app'`, `src/shared/config/defaults.ts:37`; `src/main/runner/executor.ts:1313-1322`; `src/main/evidence/store.ts:167-176`).
- **A lista de hosts**: o esquema a descreve como nomes exatos em minúsculas, sem curinga e sem porta, no máximo 20 (`src/shared/config/schema.ts:286`), e o tráfego de uma sandbox com lista sai só pelo proxy do aplicativo, para esses nomes (`src/shared/network.ts:29-38`).
- **O que este plano não acrescenta**: nenhum campo de esquema, nenhuma migração (o esquema continua 27, `src/shared/config/types.ts:5`; `STEPS` continua com 26 entradas, `src/shared/config/migrations.ts:406`), nenhuma escrita nova no host.

**Não verificado nesta etapa:** a construção do site, a travessia de `docs/`, a extração do histórico, a checagem de links, a checagem de línguas, a prévia local, a publicação e a lista de hosts do agente não foram exercitadas. Nenhum comando de construção, de prévia ou de publicação foi rodado; os únicos comandos desta etapa foram leituras da árvore (`cat`/`ls` de arquivos de configuração e de documentação) para conferir o que este plano afirma.

**Onde este plano pode errar, e como a implementação descobre:** o nome exato do pacote, da versão e da ação de publicação do gerador (a implementação fixa na versão que instalar); se o gerador aceita a travessia de `docs/` sem uma lista de páginas escrita à mão (a implementação confere construindo o site); e se a checagem de links do gerador dá conta sozinha ou precisa do módulo próprio do commit 4 (a implementação confere provocando um link quebrado). Os quatro primeiros commits são onde isso se decide, antes de o fluxo de publicação existir.
