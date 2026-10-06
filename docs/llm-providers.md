# Provedores de modelo / Model providers

[Português](#português) | [English](#english)

---

## Português

O Coxia tem **dois motores de agente**. O motor decide como a chamada roda; o provedor decide para onde ela vai.

| Motor | Roda em | Provedores |
|---|---|---|
| **Claude** (atual) | Claude Agent SDK (binário do Claude Code) | API da Anthropic, Amazon Bedrock, Google Cloud (Vertex), Microsoft Foundry: modelos Claude |
| **Aberto** (`src/main/engine/open/`) | Loop de agente próprio, sobre OpenAI Chat Completions | Qualquer API compatível com OpenAI: Ollama, LM Studio, llama.cpp server, vLLM, OpenAI, Groq, DeepSeek direto, OpenRouter (modelos que não são Claude)… |

Por que dois: a Anthropic não suporta apontar o Claude Code para modelos que não sejam Claude, por gateway nenhum. O motor aberto não passa pelo binário do Claude Code: é o nosso loop (modelo, ferramentas, resposta), com a mesma política de segurança.

### Contrato do motor aberto

`runOpenOnce` (em `engine/open/bridge.ts`) recebe as mesmas opções que `agents.ts` passa ao `query()` do SDK e devolve o mesmo que o `runOnce`:

- **Entrada:** papel, prompt, saída `json_schema`, `maxTurns`, `resume` (id de sessão), `allowedTools`/`disallowedTools`, `hooks`, `additionalDirectories`, `systemPrompt.append`, `tools: []` (sem ferramenta nenhuma).
- **Saída:** `{ data, sessionId, sources }`. Ao estourar `maxTurns` lança o mesmo erro que o caminho Claude, e o `run` do `agents.ts` faz a retomada única sem ferramentas e devolve a resposta parcial.
- **Uso (tokens):** cada resposta do modelo grava `usage` no transcript; `events.onUsage` entrega o mesmo dado em tempo real. Sem `usage` no servidor, a contagem é estimada e marcada `estimated`.
- **Sessões:** `<dados do workspace>/open-sessions/<id>.jsonl` (uma linha `meta`, depois uma por mensagem, `resume` a cada retomada). Uma sessão desconhecida vira sessão nova.

A escolha do motor é configuração. Cada provedor cadastrado em `llm.providers` tem o seu `engine` (Claude ou aberto) e cada papel de `llm.roles` aponta o provedor e o modelo; o app monta a seleção que o motor aberto recebe a partir disso (a chave do provedor, o que o teste de conexão aprendeu sobre ele, o formato da saída estruturada e as fontes de contexto). Não há nada a fazer no ambiente para escolher o motor.

As variáveis de ambiente continuam existindo **só como recurso de teste**: elas forçam o motor aberto contra o servidor que nomeiam, qualquer que seja a configuração, e não valem para quem usa o app.

```bash
COXIA_ENGINE=open \
COXIA_LLM_OPENAI_BASEURL=http://localhost:11434/v1 \
COXIA_LLM_OPENAI_MODEL=qwen3:8b \
COXIA_LLM_OPENAI_KEY=            # vazio para servidores locais
npm run dev
```

Opcionais do gancho de teste: `COXIA_LLM_STRUCTURED=auto|response_format|tool|prompt`, `COXIA_LLM_JSON_SCHEMA=1` (o servidor aceita `response_format`). Com `COXIA_ENGINE=open` a chave do OpenRouter não é lida.

O que a seleção entrega a `runOpenOnce`: `OpenEngineSelection` = `{ provider: { baseUrl, apiKey, model, headers?, maxOutputTokens?, temperature?, timeoutMs? }, capabilities?, structured?, docs? }`. `clientFor(provider)` guarda um cliente por provedor e modelo, e o cliente aprende o que o servidor recusa (parâmetros, `max_tokens`, eco do raciocínio).

### Testar conexão

`probeOpenAIProvider(baseUrl, key, model, { lang })` devolve `{ reachable, ok, models, chat, tools, jsonSchema, capabilities, messages }`:

1. alcança o servidor e lista `GET /models` (inclui a janela de contexto quando o servidor informa: `context_length`, `max_model_len`, `meta.n_ctx_train`…);
2. resposta simples (com SSE; sem SSE, tenta JSON);
3. chamada de ferramenta;
4. `response_format` com `json_schema`;
5. uma imagem numa mensagem (um quadrado vermelho de 16×16): `images` é `true` quando o modelo respondeu, `false` quando o servidor recusou a imagem e fica ausente quando a chamada falhou por outro motivo.

`capabilities` = `{ chat, tools, jsonSchema, streaming, reasoning, contextWindow, images }` alimenta o motor (`Capabilities`). A URL pode ser `http://localhost:11434`, `.../v1` ou `.../v1/chat/completions`.

### Saída estruturada

O app depende de uma resposta JSON validada. Ordem de preferência (`structured: 'auto'`):

1. **`response_format: json_schema`**, quando o teste de conexão confirmou. O agente trabalha com as ferramentas sem forçar nada; ao terminar, uma chamada final sem ferramentas pede o JSON com `response_format`. Se a resposta já for um JSON válido, não há chamada extra.
2. **Ferramenta `final_answer`** (parâmetros = o schema) com `tool_choice` forçado quando o modelo responde em texto, ou quando acabam as chamadas.
3. **Prompt** (schema no system prompt) + reparo de JSON (cercas de markdown, vírgulas sobrando, JSON cortado) + uma rodada de correção com os erros de validação.

Nos três casos a resposta é validada contra o schema (`engine/open/schema.ts`); campos que o schema proíbe são podados antes. Um servidor que recusa `response_format` ou `tool_choice` é lembrado e não recebe mais o parâmetro. Um modelo que diz não suportar ferramentas cai sozinho para o modo prompt, sem ferramentas.

### Ferramentas e segurança (mesma política do caminho Claude)

Ferramentas: `Read`, `Grep`, `Glob`, `Bash` (allowlist), `Skill`, `Agent` (sub-agente de leitura), `mcp__<servidor>__<ferramenta>`. Os nomes são os do Claude, então `allowedTools` vale igual.

**Imagens.** O `Read` reconhece PNG, JPEG, GIF e WebP pelos primeiros bytes (nunca pelo nome) e, com as mesmas checagens de caminho e de segredo de um texto, devolve a imagem (até 4 MB). Como uma mensagem de ferramenta só leva texto, o loop manda as imagens lidas numa mensagem `user` logo depois dos resultados. Com `capabilities.images: false` o `Read` diz que o modelo não recebe imagens em vez de anexar. Sem a capacidade conhecida, o motor tenta: um servidor que recusa (400/422 falando de imagem) faz o cliente repetir o pedido com uma linha no lugar de cada imagem e parar de mandá-las (`learned.noImages`). Na estimativa de tokens e na compactação, uma imagem pesa um valor fixo e as antigas viram uma linha.

- Os mesmos hooks de `agents.ts` rodam antes e depois de cada ferramenta (`shellAllowlist`, `noSecrets`, `redactSecretResults`): uma política só para os dois motores. `test/engine-open-tools.test.ts` prova as mesmas recusas.
- Arquivos de segredo (`.env`, `*secret*.json`, chaves, `~/.ssh`…) ficam fora: a regra é a mesma `secretPath`, aplicada antes de ler e durante a busca (`Grep`/`Glob` não percorrem esses arquivos, e o ripgrep recebe `SECRET_GLOBS`).
- O `Bash` roda **sem shell**: o comando é dividido em argumentos e executado direto, então `;`, `&&`, `|`, `$()` e variáveis não fazem nada. Só `2>&1` e `| head -n/-c N` são tratados (pelo código). Os prefixos de `Bash(...)` de `allowedTools` também valem.
- Arquivos só dentro do `cwd`, das `additionalDirectories` e das pastas de documentos (links simbólicos resolvidos). Isso é **mais estrito** que o caminho Claude, onde `Read` liberado vale para qualquer caminho.
- Limite de saída por ferramenta (30 mil caracteres, menos com janela de contexto pequena).

### Contexto

Fontes configuráveis (`DocSources`): `claudeMd` (arquivos ou pastas; `@imports` até 5 níveis, fora de blocos de código), `skillDirs` (`<nome>/SKILL.md`: só a descrição vai no prompt, o corpo vem pela ferramenta `Skill`), `agentDirs` (definições para a ferramenta `Agent`), `docDirs` (rules e knowledge base: índice no prompt, leitura com `Read`) e `mcpConfigs` (`.mcp.json`; só servidores stdio; só sobem os servidores que têm ferramenta liberada).

Padrão (`defaultDocSources`), quando nenhuma fonte é configurada: CLAUDE.md do cwd para cima, `.claude/{skills,agents,rules,knowledge-base}` do cwd e da home, `.mcp.json` do cwd e `~/.claude.json`. **Só as cerimônias e o gancho de teste o usam.** Um agente do time (etapa de execução, menção, pergunta da cadeia, pedido entre squads) leva listas explícitas (as fontes extras de `docs` e o `.mcp.json` dos projetos, vazias quando não há nada), o que impede o padrão de entrar; a documentação dele, a `.coxia/` dos repositórios, vai por **um texto só, com orçamento**, anexado ao texto de sistema (`systemAppend`), igual ao do caminho do Claude. Veja [`harness.md`](harness.md).

No **caminho do Claude Agent SDK** a chamada de um agente do time leva `settingSources: []` e `settings: { autoMemoryEnabled: false }`: o Claude Code não carrega `CLAUDE.md`, `.claude/`, `settings.json` nem a memória automática. Efeito colateral dito: as skills e os subagentes de `~/.claude` e `<projeto>/.claude` **não são achados** pelas ferramentas `Skill` e `Agent` nesses agentes; as `skills/` de `.coxia/` são lidas como texto, e o interruptor `tools.skills` só deixa de achar skills no caminho do SDK. As cerimônias não definem `settingSources` e seguem como antes.

Quando o servidor diz que o contexto estourou, ou a estimativa passa de 80% da janela conhecida, resultados antigos de ferramenta são encurtados e a chamada se repete.

### Provedores: o que foi testado

Importante: **um** modelo real foi testado, em quatro execuções, e só no runner; nenhum outro, e nenhum nas cerimônias. A suíte roda contra um servidor OpenAI falso e roteirizado (`test/helpers/fakeOpenAI.ts`) que reproduz o formato do SSE, chamadas de ferramenta em paralelo (com e sem `index`/`id`), erros com a redação de OpenAI, Ollama, vLLM e DeepSeek, `reasoning`/`reasoning_content` e `<think>`.

**O que rodou de verdade:** DeepSeek v4.1 flash pelo OpenRouter, no motor aberto (saída estruturada em `auto`), no runner, em uma issue pequena de um projeto Node, de ponta a ponta no ciclo de agentes contra um host GitHub falso com memória: duas execuções de cerca de 50 chamadas ao modelo cada (uma terminou, a outra parou no limite de rodadas da revisão), por volta de US$ 0,3 cada. Isso mostra que o loop, a saída estruturada, as ferramentas de leitura e de escrita confinada e o runner funcionam com esse modelo nessa tarefa. Depois das correções, mais duas execuções com o mesmo modelo mediram o que faltava: a mesma issue do endereço do título e uma issue ambígua, que perguntou a quem a abriu e à pessoa e foi retomada depois de o processo ser reiniciado, a US$ 0,08 e a cerca de US$ 0,14 (o custo que o OpenRouter informou). Ainda não se exercitou com um modelo de verdade: os laços de devolução entre a revisão ou a QA e o desenvolvedor, a pergunta do limite de rodadas, a segunda rodada da revisão, os saltos da cadeia de perguntas entre agentes, os limites de passos, um `needsPerson` sem pergunta, os squads, o desfazer, outro modelo ou provedor, o caminho do Claude Agent SDK, um host de código real e um repositório grande. Não mostra nada sobre Ollama ou servidor local. Os detalhes e o que mudou estão em [`runner.md`](runner.md#não-verificado).

| Provedor | Situação |
|---|---|
| Servidor OpenAI falso (testes) | testado |
| Ollama (`http://localhost:11434/v1`) | esperado funcionar; não testado |
| LM Studio (`http://localhost:1234/v1`) | esperado funcionar; não testado |
| llama.cpp `llama-server` (use `--jinja` para chamadas de ferramenta) | esperado funcionar; não testado |
| vLLM (`--enable-auto-tool-choice --tool-call-parser ...`) | esperado funcionar; não testado |
| OpenAI (`max_completion_tokens`, `temperature` fixo em modelos de raciocínio: tratados por fallback) | esperado funcionar; não testado |
| OpenRouter com DeepSeek v4.1 flash | testado no runner (motor aberto, duas issues pequenas em quatro execuções, host falso); só esse modelo |
| Groq, DeepSeek direto, outros modelos do OpenRouter (não Claude) | esperado funcionar; não testado |
| DeepInfra (`https://api.deepinfra.com/v1/openai`, atalho na lista do motor aberto) | esperado funcionar; não testado |

### Limitações conhecidas

- **Modelo pequeno e ferramentas:** modelos locais de poucos bilhões de parâmetros erram argumentos, ignoram ferramentas ou inventam. O loop devolve o erro ao modelo e tenta de novo, mas a qualidade depende do modelo. Use o teste de conexão e prefira modelos treinados para ferramentas.
- **Janela de contexto:** o prompt do agente (CLAUDE.md, skills, definições de ferramentas) passa de 10 mil tokens. Com 4 mil ou 8 mil tokens a cerimônia não cabe. Ollama usa 4096 por padrão: aumente `num_ctx` (ex.: 16384 ou mais). O servidor muitas vezes trunca em silêncio em vez de dar erro, e nesse caso o adaptador não percebe. A documentação de `.coxia/` que um agente do time recebe tem orçamento próprio, reduzido pela janela que o provedor declara (24.000 caracteres no máximo, piso de 3.000).
- Ferramentas: leitura (`Read`, `Grep`, `Glob`), escrita confinada ao worktree da execução (`Write`, `Edit`) quando a chamada tem raiz de escrita, os comandos listados em `runner.commands` quando a permissão os dá, mais as ferramentas MCP permitidas. Sem rede e sem busca na web (`WebFetch`, `WebSearch`).
- Chamadas de ferramenta escritas como texto (alguns modelos sem template adequado) não são interpretadas; o servidor precisa devolver `tool_calls`.
- Entrada de imagem não é usada pelo motor aberto.
- MCP: só stdio, sem OAuth e sem servidores remotos.
- Um raciocínio que vem como `<think>` só é reconhecido no início da resposta; o texto de raciocínio nunca entra na resposta final.
- Os dois motores usam sessões diferentes: uma sessão do Claude não retoma no motor aberto (vira sessão nova).
- O custo em dólar do app é o que o provedor informou: os tokens são gravados (por etapa, no runner) e o custo aparece quando o provedor o informa (o OpenRouter informa). No caminho do SDK do Claude, o número do SDK só vale como o cobrado na API própria da Anthropic (`https://api.anthropic.com`); em qualquer outro provedor (Bedrock, Vertex, Foundry, um endereço próprio) ele é mostrado marcado como estimativa, porque é um preço de lista e não o que foi cobrado.

---

## English

Coxia has **two agent engines**. The engine decides how a call runs; the provider decides where it goes.

| Engine | Runs on | Providers |
|---|---|---|
| **Claude** (current) | Claude Agent SDK (the Claude Code binary) | Anthropic API, Amazon Bedrock, Google Cloud (Vertex), Microsoft Foundry: Claude models |
| **Open** (`src/main/engine/open/`) | Our own agent loop over OpenAI Chat Completions | Any OpenAI-compatible API: Ollama, LM Studio, llama.cpp server, vLLM, OpenAI, Groq, DeepSeek direct, OpenRouter (non-Claude models)… |

Why two: Anthropic does not support pointing Claude Code at non-Claude models through any gateway. The open engine does not go through the Claude Code binary: it is our own loop (model, tools, answer) with the same safety policy.

### Open engine contract

`runOpenOnce` (in `engine/open/bridge.ts`) takes the same options `agents.ts` passes to the SDK's `query()` and returns what `runOnce` returns:

- **In:** role, prompt, `json_schema` output, `maxTurns`, `resume` (session id), `allowedTools`/`disallowedTools`, `hooks`, `additionalDirectories`, `systemPrompt.append`, `tools: []` (no tools at all).
- **Out:** `{ data, sessionId, sources }`. Running out of `maxTurns` throws the same error as the Claude path, and `run` in `agents.ts` does the single tool-less resume and returns the partial answer.
- **Usage (tokens):** every model response writes `usage` to the transcript; `events.onUsage` delivers it live. When the server sends no `usage`, the count is estimated and flagged `estimated`.
- **Sessions:** `<workspace data>/open-sessions/<id>.jsonl` (a `meta` line, then one per message, `resume` on each resume). An unknown session id starts a new session.

The engine choice is configuration. Every provider registered in `llm.providers` carries its `engine` (Claude or open) and every role in `llm.roles` points at a provider and a model; the app builds the selection the open engine receives from that (the provider key, what the connection test learned about it, the structured output format and the context sources). Nothing in the environment is needed to choose the engine.

The environment variables still exist **only as a test aid**: they force the open engine against the server they name, whatever the configuration says, and they are of no use to a person running the app.

```bash
COXIA_ENGINE=open \
COXIA_LLM_OPENAI_BASEURL=http://localhost:11434/v1 \
COXIA_LLM_OPENAI_MODEL=qwen3:8b \
COXIA_LLM_OPENAI_KEY=            # empty for local servers
npm run dev
```

Optional test-hook variables: `COXIA_LLM_STRUCTURED=auto|response_format|tool|prompt`, `COXIA_LLM_JSON_SCHEMA=1` (the server accepts `response_format`). With `COXIA_ENGINE=open` the OpenRouter key is not read.

What the selection hands to `runOpenOnce`: `OpenEngineSelection` = `{ provider: { baseUrl, apiKey, model, headers?, maxOutputTokens?, temperature?, timeoutMs? }, capabilities?, structured?, docs? }`. `clientFor(provider)` keeps one client per provider and model, and the client learns what the server rejects (parameters, `max_tokens`, reasoning echo).

### Test connection

`probeOpenAIProvider(baseUrl, key, model, { lang })` returns `{ reachable, ok, models, chat, tools, jsonSchema, capabilities, messages }`:

1. reaches the server and lists `GET /models` (including the context window when the server reports it: `context_length`, `max_model_len`, `meta.n_ctx_train`…);
2. plain completion (over SSE; without SSE, plain JSON);
3. tool call;
4. `response_format` with `json_schema`;
5. an image in a message (a 16×16 red square): `images` is `true` when the model answered, `false` when the server refused the image, and absent when the call failed for another reason.

`capabilities` = `{ chat, tools, jsonSchema, streaming, reasoning, contextWindow, images }` feeds the engine (`Capabilities`). The URL may be `http://localhost:11434`, `.../v1` or `.../v1/chat/completions`.

### Structured output

The app depends on a validated JSON answer. Order of preference (`structured: 'auto'`):

1. **`response_format: json_schema`**, when the connection test confirmed it. The agent works with tools unforced; when done, a closing call without tools asks for the JSON with `response_format`. If the answer already is valid JSON, there is no extra call.
2. **A `final_answer` tool** (parameters = the schema) with `tool_choice` forced when the model answers in text, or when tool calls run out.
3. **Prompt** (schema in the system prompt) + JSON repair (markdown fences, trailing commas, truncated JSON) + one correction round with the validation errors.

In all three the answer is validated against the schema (`engine/open/schema.ts`); fields the schema forbids are pruned first. A server that rejects `response_format` or `tool_choice` is remembered and no longer gets the parameter. A model that says it does not support tools falls back by itself to prompt mode, without tools.

### Tools and security (same policy as the Claude path)

Tools: `Read`, `Grep`, `Glob`, `Bash` (allowlist), `Skill`, `Agent` (read-only sub-agent), `mcp__<server>__<tool>`. Names are Claude's, so `allowedTools` means the same.

**Images.** `Read` tells PNG, JPEG, GIF and WebP by their first bytes (never the name) and, with the same path and secret checks as text, returns the image (up to 4 MB). Since a tool message carries text only, the loop sends the images read in a `user` message right after the tool results. With `capabilities.images: false`, `Read` says the model takes no images instead of attaching one. When the capability is not known the engine tries: a server that refuses (400/422 about an image) makes the client send the request again with a line in place of each image and stop sending them (`learned.noImages`). In the token estimate and in compaction, an image weighs a fixed amount and older ones become a line.

- The same hooks from `agents.ts` run before and after every tool (`shellAllowlist`, `noSecrets`, `redactSecretResults`): one policy for both engines. `test/engine-open-tools.test.ts` proves the same refusals.
- Secret files (`.env`, `*secret*.json`, keys, `~/.ssh`…) are out of reach: the same `secretPath` rule, applied before reading and while searching (`Grep`/`Glob` never walk those files, and ripgrep gets `SECRET_GLOBS`).
- `Bash` runs **without a shell**: the command is split into arguments and executed directly, so `;`, `&&`, `|`, `$()` and variables do nothing. Only `2>&1` and `| head -n/-c N` are handled (by code). The `Bash(...)` prefixes in `allowedTools` apply too.
- Files only inside the `cwd`, the `additionalDirectories` and the doc folders (symlinks resolved). This is **stricter** than the Claude path, where an allowed `Read` covers any path.
- Output cap per tool (30k characters, less with a small context window).

### Context

Configurable sources (`DocSources`): `claudeMd` (files or folders; `@imports` up to 5 levels, outside code blocks), `skillDirs` (`<name>/SKILL.md`: only the description goes in the prompt, the body comes through the `Skill` tool), `agentDirs` (definitions for the `Agent` tool), `docDirs` (rules and knowledge base: index in the prompt, read with `Read`) and `mcpConfigs` (`.mcp.json`; stdio servers only; only servers with an allowed tool are started).

When no source is configured, the default (`defaultDocSources`) is: CLAUDE.md from the cwd upward, `.claude/{skills,agents,rules,knowledge-base}` of the cwd and the home, `.mcp.json` of the cwd and `~/.claude.json`. **Only the ceremonies and the test hook use it.** An agent of the team (a stage of a run, a mention, a question of the chain, a request between squads) carries explicit lists (the extra sources of `docs` and the `.mcp.json` of the projects, empty when there is nothing), which keeps the default out; its documentation, the `.coxia/` of the repositories, goes as **one text with a budget** appended to the system text (`systemAppend`), the same as on the Claude path. See [`harness.md`](harness.md).

On the **Claude Agent SDK path** the call of an agent of the team carries `settingSources: []` and `settings: { autoMemoryEnabled: false }`: Claude Code does not load `CLAUDE.md`, `.claude/`, `settings.json` or the automatic memory. A side effect, stated: the skills and subagents of `~/.claude` and `<project>/.claude` are **not found** by the `Skill` and `Agent` tools in those agents; the `skills/` of `.coxia/` are read as text, and the `tools.skills` switch only stops finding skills on the SDK path. The ceremonies do not set `settingSources` and stay as before.

When the server says the context overflowed, or the estimate passes 80% of the known window, old tool results are shortened and the call is repeated.

### Providers: what was tested

Important: **one** real model has been tested, in four runs, and only in the runner; no other, and none in the ceremonies. The suite runs against a scripted fake OpenAI server (`test/helpers/fakeOpenAI.ts`) that reproduces SSE framing, parallel tool calls (with and without `index`/`id`), errors worded like OpenAI, Ollama, vLLM and DeepSeek, `reasoning`/`reasoning_content` and `<think>`.

**What really ran:** DeepSeek v4.1 flash through OpenRouter, on the open engine (structured output on `auto`), in the runner, on one small issue of a Node project, end to end through the agent cycle against a fake GitHub host with a memory: two runs of about 50 model calls each (one finished, the other stopped at the review's round limit), around US$ 0.3 each. It shows that the loop, the structured output, the read tools, the confined write tools and the runner work with that model on that task. After the fixes, two more runs with the same model measured what was missing: the same title-address issue again, and an ambiguous issue that asked the reporter and the person and was resumed after a process restart, at US$ 0.08 and about US$ 0.14 (the cost OpenRouter reported). Still not exercised with a real model: the return loops between the review or QA and the developer, the round limit question, review round 2, the hops of the agent-to-agent question chain, the turn caps, a `needsPerson` without a question, squads, undo, another model or provider, the Claude Agent SDK path, a real code host and a large repository. It shows **nothing** about Ollama or a local server. The details and what changed are in [`runner.md`](runner.md#not-verified).

| Provider | Status |
|---|---|
| Fake OpenAI server (tests) | tested |
| Ollama (`http://localhost:11434/v1`) | expected to work; untested |
| LM Studio (`http://localhost:1234/v1`) | expected to work; untested |
| llama.cpp `llama-server` (use `--jinja` for tool calls) | expected to work; untested |
| vLLM (`--enable-auto-tool-choice --tool-call-parser ...`) | expected to work; untested |
| OpenAI (`max_completion_tokens`, fixed `temperature` on reasoning models: handled by fallback) | expected to work; untested |
| OpenRouter with DeepSeek v4.1 flash | tested in the runner (open engine, two small issues in four runs, fake host); that model only |
| Groq, DeepSeek direct, other OpenRouter models (non-Claude) | expected to work; untested |
| DeepInfra (`https://api.deepinfra.com/v1/openai`, a preset in the open engine's list) | expected to work; untested |

### Known limitations

- **Small models and tools:** local models of a few billion parameters get arguments wrong, ignore tools or make things up. The loop returns the error to the model and tries again, but quality depends on the model. Use the connection test and prefer models trained for tool use.
- **Context window:** the agent prompt (CLAUDE.md, skills, tool definitions) is over 10k tokens. With 4k or 8k tokens the ceremony does not fit. Ollama defaults to 4096: raise `num_ctx` (for example 16384 or more). Servers often truncate silently instead of erroring, and the adapter cannot notice that. The `.coxia/` documentation an agent of the team receives has a budget of its own, reduced by the window the provider declares (24,000 characters at most, floor of 3,000).
- Tools: reads (`Read`, `Grep`, `Glob`), writes confined to the run's worktree (`Write`, `Edit`) when the call has a write root, the commands listed in `runner.commands` when the permission grants them, plus the allowed MCP tools. No network and no web search (`WebFetch`, `WebSearch`).
- Tool calls written as plain text (some models without a proper template) are not interpreted; the server must return `tool_calls`.
- Image input is not used by the open engine.
- MCP: stdio only, no OAuth and no remote servers.
- Reasoning that arrives as `<think>` is recognised only at the start of the answer; reasoning text never reaches the final answer.
- The two engines keep separate sessions: a Claude session does not resume on the open engine (it starts a new one).
- The app's dollar cost is what the provider reported: tokens are recorded (per stage, in the runner) and a cost shows when the provider reports one (OpenRouter does). On the Claude SDK path, the SDK's figure counts as the charged cost only on Anthropic's own API (`https://api.anthropic.com`); on any other provider (Bedrock, Vertex, Foundry, a custom endpoint) it is shown marked as an estimate, because it is a list price and not what was charged.
