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

Por enquanto a seleção é um gancho de teste (variáveis de ambiente). A camada de configuração vai trocar `openEngineFromEnv()` pela escolha provedor → motor:

```bash
COXIA_ENGINE=open \
COXIA_LLM_OPENAI_BASEURL=http://localhost:11434/v1 \
COXIA_LLM_OPENAI_MODEL=qwen3:8b \
COXIA_LLM_OPENAI_KEY=            # vazio para servidores locais
npm run dev
```

Opcionais do gancho: `COXIA_LLM_STRUCTURED=auto|response_format|tool|prompt`, `COXIA_LLM_JSON_SCHEMA=1` (o servidor aceita `response_format`). Com `COXIA_ENGINE=open` a chave do OpenRouter não é lida.

O que a camada de configuração precisa entregar a `runOpenOnce`: `OpenEngineSelection` = `{ provider: { baseUrl, apiKey, model, headers?, maxOutputTokens?, temperature?, timeoutMs? }, capabilities?, structured?, docs? }`. `clientFor(provider)` guarda um cliente por provedor e modelo, e o cliente aprende o que o servidor recusa (parâmetros, `max_tokens`, eco do raciocínio).

### Testar conexão

`probeOpenAIProvider(baseUrl, key, model, { lang })` devolve `{ reachable, ok, models, chat, tools, jsonSchema, capabilities, messages }`:

1. alcança o servidor e lista `GET /models` (inclui a janela de contexto quando o servidor informa: `context_length`, `max_model_len`, `meta.n_ctx_train`…);
2. resposta simples (com SSE; sem SSE, tenta JSON);
3. chamada de ferramenta;
4. `response_format` com `json_schema`.

`capabilities` = `{ chat, tools, jsonSchema, streaming, reasoning, contextWindow }` alimenta o motor (`Capabilities`). A URL pode ser `http://localhost:11434`, `.../v1` ou `.../v1/chat/completions`.

### Saída estruturada

O app depende de uma resposta JSON validada. Ordem de preferência (`structured: 'auto'`):

1. **`response_format: json_schema`**, quando o teste de conexão confirmou. O agente trabalha com as ferramentas sem forçar nada; ao terminar, uma chamada final sem ferramentas pede o JSON com `response_format`. Se a resposta já for um JSON válido, não há chamada extra.
2. **Ferramenta `final_answer`** (parâmetros = o schema) com `tool_choice` forçado quando o modelo responde em texto, ou quando acabam as chamadas.
3. **Prompt** (schema no system prompt) + reparo de JSON (cercas de markdown, vírgulas sobrando, JSON cortado) + uma rodada de correção com os erros de validação.

Nos três casos a resposta é validada contra o schema (`engine/open/schema.ts`); campos que o schema proíbe são podados antes. Um servidor que recusa `response_format` ou `tool_choice` é lembrado e não recebe mais o parâmetro. Um modelo que diz não suportar ferramentas cai sozinho para o modo prompt, sem ferramentas.

### Ferramentas e segurança (mesma política do caminho Claude)

Ferramentas: `Read`, `Grep`, `Glob`, `Bash` (allowlist), `Skill`, `Agent` (sub-agente de leitura), `mcp__<servidor>__<ferramenta>`. Os nomes são os do Claude, então `allowedTools` vale igual.

- Os mesmos hooks de `agents.ts` rodam antes e depois de cada ferramenta (`shellAllowlist`, `noSecrets`, `redactSecretResults`): uma política só para os dois motores. `test/engine-open-tools.test.ts` prova as mesmas recusas.
- Arquivos de segredo (`.env`, `*secret*.json`, chaves, `~/.ssh`…) ficam fora: a regra é a mesma `secretPath`, aplicada antes de ler e durante a busca (`Grep`/`Glob` não percorrem esses arquivos, e o ripgrep recebe `SECRET_GLOBS`).
- O `Bash` roda **sem shell**: o comando é dividido em argumentos e executado direto, então `;`, `&&`, `|`, `$()` e variáveis não fazem nada. Só `2>&1` e `| head -n/-c N` são tratados (pelo código). Os prefixos de `Bash(...)` de `allowedTools` também valem.
- Arquivos só dentro do `cwd`, das `additionalDirectories` e das pastas de documentos (links simbólicos resolvidos). Isso é **mais estrito** que o caminho Claude, onde `Read` liberado vale para qualquer caminho.
- Limite de saída por ferramenta (30 mil caracteres, menos com janela de contexto pequena).

### Contexto

Fontes configuráveis (`DocSources`): `claudeMd` (arquivos ou pastas; `@imports` até 5 níveis, fora de blocos de código), `skillDirs` (`<nome>/SKILL.md`: só a descrição vai no prompt, o corpo vem pela ferramenta `Skill`), `agentDirs` (definições para a ferramenta `Agent`), `docDirs` (rules e knowledge base: índice no prompt, leitura com `Read`) e `mcpConfigs` (`.mcp.json`; só servidores stdio; só sobem os servidores que têm ferramenta liberada).

Padrão do gancho de teste (`defaultDocSources`): CLAUDE.md do cwd para cima, `.claude/{skills,agents,rules,knowledge-base}` do cwd e da home, `.mcp.json` do cwd e `~/.claude.json`.

Quando o servidor diz que o contexto estourou, ou a estimativa passa de 80% da janela conhecida, resultados antigos de ferramenta são encurtados e a chamada se repete.

### Provedores: o que foi testado

Importante: **nenhum modelo real foi testado ainda.** Não havia Ollama nem outro servidor nesta máquina. A suíte roda contra um servidor OpenAI falso e roteirizado (`test/helpers/fakeOpenAI.ts`) que reproduz o formato do SSE, chamadas de ferramenta em paralelo (com e sem `index`/`id`), erros com a redação de OpenAI, Ollama, vLLM e DeepSeek, `reasoning`/`reasoning_content` e `<think>`.

| Provedor | Situação |
|---|---|
| Servidor OpenAI falso (testes) | testado |
| Ollama (`http://localhost:11434/v1`) | esperado funcionar; não testado |
| LM Studio (`http://localhost:1234/v1`) | esperado funcionar; não testado |
| llama.cpp `llama-server` (use `--jinja` para chamadas de ferramenta) | esperado funcionar; não testado |
| vLLM (`--enable-auto-tool-choice --tool-call-parser ...`) | esperado funcionar; não testado |
| OpenAI (`max_completion_tokens`, `temperature` fixo em modelos de raciocínio: tratados por fallback) | esperado funcionar; não testado |
| Groq, DeepSeek direto, OpenRouter (modelos não Claude) | esperado funcionar; não testado |

### Limitações conhecidas

- **Modelo pequeno e ferramentas:** modelos locais de poucos bilhões de parâmetros erram argumentos, ignoram ferramentas ou inventam. O loop devolve o erro ao modelo e tenta de novo, mas a qualidade depende do modelo. Use o teste de conexão e prefira modelos treinados para ferramentas.
- **Janela de contexto:** o prompt do agente (CLAUDE.md, skills, definições de ferramentas) passa de 10 mil tokens. Com 4 mil ou 8 mil tokens a cerimônia não cabe. Ollama usa 4096 por padrão: aumente `num_ctx` (ex.: 16384 ou mais). O servidor muitas vezes trunca em silêncio em vez de dar erro, e nesse caso o adaptador não percebe.
- Ferramentas só de leitura; sem `Edit`/`Write`, sem `WebFetch`/`WebSearch`.
- Chamadas de ferramenta escritas como texto (alguns modelos sem template adequado) não são interpretadas; o servidor precisa devolver `tool_calls`.
- Entrada de imagem não é usada pelo motor aberto.
- MCP: só stdio, sem OAuth e sem servidores remotos.
- Um raciocínio que vem como `<think>` só é reconhecido no início da resposta; o texto de raciocínio nunca entra na resposta final.
- Os dois motores usam sessões diferentes: uma sessão do Claude não retoma no motor aberto (vira sessão nova).
- O custo em dólar não é calculado; só os tokens são gravados.

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

For now selection is a test hook (environment variables). The configuration layer will replace `openEngineFromEnv()` with provider → engine selection:

```bash
COXIA_ENGINE=open \
COXIA_LLM_OPENAI_BASEURL=http://localhost:11434/v1 \
COXIA_LLM_OPENAI_MODEL=qwen3:8b \
COXIA_LLM_OPENAI_KEY=            # empty for local servers
npm run dev
```

Optional hook variables: `COXIA_LLM_STRUCTURED=auto|response_format|tool|prompt`, `COXIA_LLM_JSON_SCHEMA=1` (the server accepts `response_format`). With `COXIA_ENGINE=open` the OpenRouter key is not read.

What the configuration layer hands to `runOpenOnce`: `OpenEngineSelection` = `{ provider: { baseUrl, apiKey, model, headers?, maxOutputTokens?, temperature?, timeoutMs? }, capabilities?, structured?, docs? }`. `clientFor(provider)` keeps one client per provider and model, and the client learns what the server rejects (parameters, `max_tokens`, reasoning echo).

### Test connection

`probeOpenAIProvider(baseUrl, key, model, { lang })` returns `{ reachable, ok, models, chat, tools, jsonSchema, capabilities, messages }`:

1. reaches the server and lists `GET /models` (including the context window when the server reports it: `context_length`, `max_model_len`, `meta.n_ctx_train`…);
2. plain completion (over SSE; without SSE, plain JSON);
3. tool call;
4. `response_format` with `json_schema`.

`capabilities` = `{ chat, tools, jsonSchema, streaming, reasoning, contextWindow }` feeds the engine (`Capabilities`). The URL may be `http://localhost:11434`, `.../v1` or `.../v1/chat/completions`.

### Structured output

The app depends on a validated JSON answer. Order of preference (`structured: 'auto'`):

1. **`response_format: json_schema`**, when the connection test confirmed it. The agent works with tools unforced; when done, a closing call without tools asks for the JSON with `response_format`. If the answer already is valid JSON, there is no extra call.
2. **A `final_answer` tool** (parameters = the schema) with `tool_choice` forced when the model answers in text, or when tool calls run out.
3. **Prompt** (schema in the system prompt) + JSON repair (markdown fences, trailing commas, truncated JSON) + one correction round with the validation errors.

In all three the answer is validated against the schema (`engine/open/schema.ts`); fields the schema forbids are pruned first. A server that rejects `response_format` or `tool_choice` is remembered and no longer gets the parameter. A model that says it does not support tools falls back by itself to prompt mode, without tools.

### Tools and security (same policy as the Claude path)

Tools: `Read`, `Grep`, `Glob`, `Bash` (allowlist), `Skill`, `Agent` (read-only sub-agent), `mcp__<server>__<tool>`. Names are Claude's, so `allowedTools` means the same.

- The same hooks from `agents.ts` run before and after every tool (`shellAllowlist`, `noSecrets`, `redactSecretResults`): one policy for both engines. `test/engine-open-tools.test.ts` proves the same refusals.
- Secret files (`.env`, `*secret*.json`, keys, `~/.ssh`…) are out of reach: the same `secretPath` rule, applied before reading and while searching (`Grep`/`Glob` never walk those files, and ripgrep gets `SECRET_GLOBS`).
- `Bash` runs **without a shell**: the command is split into arguments and executed directly, so `;`, `&&`, `|`, `$()` and variables do nothing. Only `2>&1` and `| head -n/-c N` are handled (by code). The `Bash(...)` prefixes in `allowedTools` apply too.
- Files only inside the `cwd`, the `additionalDirectories` and the doc folders (symlinks resolved). This is **stricter** than the Claude path, where an allowed `Read` covers any path.
- Output cap per tool (30k characters, less with a small context window).

### Context

Configurable sources (`DocSources`): `claudeMd` (files or folders; `@imports` up to 5 levels, outside code blocks), `skillDirs` (`<name>/SKILL.md`: only the description goes in the prompt, the body comes through the `Skill` tool), `agentDirs` (definitions for the `Agent` tool), `docDirs` (rules and knowledge base: index in the prompt, read with `Read`) and `mcpConfigs` (`.mcp.json`; stdio servers only; only servers with an allowed tool are started).

Test hook default (`defaultDocSources`): CLAUDE.md from the cwd upward, `.claude/{skills,agents,rules,knowledge-base}` of the cwd and the home, `.mcp.json` of the cwd and `~/.claude.json`.

When the server says the context overflowed, or the estimate passes 80% of the known window, old tool results are shortened and the call is repeated.

### Providers: what was tested

Important: **no real model has been tested yet.** There was no Ollama or other server on the development machine. The suite runs against a scripted fake OpenAI server (`test/helpers/fakeOpenAI.ts`) that reproduces SSE framing, parallel tool calls (with and without `index`/`id`), errors worded like OpenAI, Ollama, vLLM and DeepSeek, `reasoning`/`reasoning_content` and `<think>`.

| Provider | Status |
|---|---|
| Fake OpenAI server (tests) | tested |
| Ollama (`http://localhost:11434/v1`) | expected to work; untested |
| LM Studio (`http://localhost:1234/v1`) | expected to work; untested |
| llama.cpp `llama-server` (use `--jinja` for tool calls) | expected to work; untested |
| vLLM (`--enable-auto-tool-choice --tool-call-parser ...`) | expected to work; untested |
| OpenAI (`max_completion_tokens`, fixed `temperature` on reasoning models: handled by fallback) | expected to work; untested |
| Groq, DeepSeek direct, OpenRouter (non-Claude models) | expected to work; untested |

### Known limitations

- **Small models and tools:** local models of a few billion parameters get arguments wrong, ignore tools or make things up. The loop returns the error to the model and tries again, but quality depends on the model. Use the connection test and prefer models trained for tool use.
- **Context window:** the agent prompt (CLAUDE.md, skills, tool definitions) is over 10k tokens. With 4k or 8k tokens the ceremony does not fit. Ollama defaults to 4096: raise `num_ctx` (for example 16384 or more). Servers often truncate silently instead of erroring, and the adapter cannot notice that.
- Read-only tools; no `Edit`/`Write`, no `WebFetch`/`WebSearch`.
- Tool calls written as plain text (some models without a proper template) are not interpreted; the server must return `tool_calls`.
- Image input is not used by the open engine.
- MCP: stdio only, no OAuth and no remote servers.
- Reasoning that arrives as `<think>` is recognised only at the start of the answer; reasoning text never reaches the final answer.
- The two engines keep separate sessions: a Claude session does not resume on the open engine (it starts a new one).
- Dollar cost is not computed; only tokens are recorded.
