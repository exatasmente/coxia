# Project instructions for agents / Instruções do projeto para agentes

[Português](#português) | [English](#english)

---

## Português

Cada repositório pode manter um arquivo **`AGENTS.md` na raiz** com instruções de projeto em Markdown comum. Esse é o formato universal reconhecido pelo app: sem pastas próprias, cabeçalho YAML, evidências ou metadados de revisão. O app lê apenas esse arquivo; links Markdown nele servem para orientar o agente, mas o app não os segue nem carrega outros `AGENTS.md` aninhados.

### Leitura e segurança

- Agentes de etapas, menções e conversas recebem o `AGENTS.md` dos repositórios envolvidos como texto de contexto. O conteúdo é limitado ao orçamento da chamada (até 24.000 caracteres, ajustado à janela de contexto) e pode ser lido por inteiro no worktree.
- Um arquivo ausente não acrescenta texto à chamada. Um destino que não seja arquivo regular ou exceda 256 KiB aparece como indisponível; o app não segue links simbólicos.
- Fontes extras configuradas pela pessoa continuam sendo independentes. Os arquivos do Claude Code não são carregados automaticamente pelos agentes do time; cerimônias e fontes explicitamente configuradas preservam seu comportamento próprio.
- A execução de documentação pode criar ou atualizar o `AGENTS.md`. Ela lê o código e as fontes candidatas, pede aprovação da pessoa antes de publicar e só permite ao agente de documentação gravar no `AGENTS.md` da raiz. O app mascara caminhos locais e credenciais antes de registrar alterações.
- Os registros privados dessa execução permanecem em `.coxia/.run/`, ignorados pelo Git. Essa pasta e seu `.gitignore` são estado interno do app, não um formato de documentação do projeto.
- Uma execução comum que altera `AGENTS.md` também passa pela sanitização antes do commit. A revisão e a aprovação continuam sendo feitas no fluxo normal da execução.

### Criar ou atualizar

Em **Configurações › Documentação**, a pessoa pode iniciar uma execução de criação ou atualização por repositório. O fluxo para num gate para revisar o rascunho; somente depois da aprovação o push e o pull request são propostos. A atualização revisa as instruções existentes contra o código e a documentação oficial, sem carimbos automáticos ou alegações de validade baseadas em evidências declaradas.

O documento deve ser conciso, explicar as convenções que um agente precisa seguir e apontar para fontes detalhadas mantidas pelo projeto. Para este repositório, comece por [CONTRIBUTING.md](../CONTRIBUTING.md), [índice de documentação](README.md) e [RELEASING.md](../RELEASING.md).

---

## English

Each repository can keep a root **`AGENTS.md`** with project instructions in plain Markdown. This is the universal format recognized by the app: no app-specific folders, YAML headers, evidence lists, or review metadata. The app reads only this file; Markdown links guide the agent but are not followed by the app, and nested `AGENTS.md` files are not loaded.

### Reading and safety

- Agents in stages, mentions, and conversations receive the `AGENTS.md` files of the repositories involved as context text. Content is bounded by the call budget (up to 24,000 characters, adjusted to the context window) and can be read in the worktree.
- A missing file adds no text to the call. A target that is not a regular file or exceeds 256 KiB is reported as unavailable; symbolic links are not followed.
- Extra sources configured by the person remain independent. Team agents do not automatically load Claude Code files; ceremonies and explicitly configured sources retain their own behavior.
- A documentation run can create or update `AGENTS.md`. It reads code and candidate sources, asks the person to approve before publishing, and lets its writer modify only the root `AGENTS.md`. The app masks local paths and credentials before committing changes.
- Private state for that run remains under `.coxia/.run/`, ignored by Git. This folder and its `.gitignore` are internal app state, not a project documentation format.
- A regular run that changes `AGENTS.md` also sanitizes it before commit. Review and approval remain part of the regular run flow.

### Creating or updating

In **Settings › Documentation**, a person can start a create or update run for each repository. The flow pauses at a gate to review the draft; only after approval are the push and pull request proposed. An update checks existing instructions against the code and authoritative documentation, without automatic stamps or claims of validity based on declared evidence.

Keep the file concise, explain conventions an agent needs to follow, and link to detailed project-maintained sources. For this repository, start with [CONTRIBUTING.md](../CONTRIBUTING.md), the [documentation index](README.md), and [RELEASING.md](../RELEASING.md).
