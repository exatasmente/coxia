// Pure translation between the Anthropic Messages API (what the Claude Code binary speaks) and OpenAI Chat Completions.
// No I/O here: the HTTP server lives in openaiAdapter.ts, the streaming state machine in openaiStream.ts.

export type Json = Record<string, unknown>;

export interface AnthropicBlock {
  type: string;
  [key: string]: unknown;
}

export interface AnthropicMessageIn {
  role: string;
  content: string | AnthropicBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: Json;
  type?: string;
}

export interface AnthropicRequest {
  model: string;
  max_tokens?: number;
  system?: string | AnthropicBlock[];
  messages: AnthropicMessageIn[];
  tools?: AnthropicTool[];
  tool_choice?: { type: string; name?: string; disable_parallel_tool_use?: boolean };
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  output_config?: { format?: { type?: string; schema?: Json } };
  [key: string]: unknown;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'refusal';

export interface AnthropicMessageOut {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicBlock[];
  stop_reason: StopReason | null;
  stop_sequence: string | null;
  usage: Usage;
}

export type OpenAIContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  tools?: { type: 'function'; function: { name: string; description?: string; parameters: Json } }[];
  tool_choice?: 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } };
  parallel_tool_calls?: boolean;
  response_format?: Json;
  [key: string]: unknown;
}

export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  prompt_cache_hit_tokens?: number;
}

export interface OpenAIResponse {
  id?: string;
  model?: string;
  choices?: {
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      refusal?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: OpenAIUsage;
  error?: unknown;
}

export const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';
export const ENFORCE_MARKER = '[structured-output-enforce]';
// Anthropic requires a signature on thinking blocks; the upstream has none, this is only a placeholder the binary round-trips.
export const THINKING_SIGNATURE = 'coxia-adapter';

export interface TranslateOptions {
  // The upstream model name: always used, whatever model the binary asked for (it also asks for haiku-class models).
  model: string;
  // Upstream stream flag; defaults to the request's.
  stream?: boolean;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  maxOutputTokens?: number;
  // Send the model's own reasoning back on assistant turns (DeepSeek-style reasoning_content requires it with tool calls).
  echoReasoning?: boolean;
  // Parameters the upstream was seen to reject: never sent again.
  dropParams?: ReadonlySet<string>;
  // Force the StructuredOutput tool when the binary demands the final answer.
  forceStructured?: boolean;
  // Cut tool descriptions to this many characters (small local models drown in 40 long tool descriptions).
  toolDescriptionMax?: number;
}

export interface Translated {
  body: OpenAIRequest;
  // OpenAI tool name -> Anthropic tool name.
  toolNames: Map<string, string>;
  structured: { name: string; schema: Json } | null;
  // The binary asked for the final structured answer: the answer is repaired before it is returned.
  enforce: boolean;
  inputEstimate: number;
}

const NAME_OK = /^[a-zA-Z0-9_-]{1,64}$/;

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// OpenAI function names allow [a-zA-Z0-9_-]{1,64}; MCP tool names can be longer or hold other characters.
export function toOpenAIName(name: string): string {
  if (NAME_OK.test(name)) return name;
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'tool';
  return `${safe.slice(0, 55)}_${fnv(name)}`.slice(0, 64);
}

export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return Math.ceil(text.length / 4);
}

function blockText(block: AnthropicBlock): string {
  return typeof block.text === 'string' ? block.text : '';
}

function blocksOf(content: string | AnthropicBlock[] | undefined): AnthropicBlock[] {
  if (content === undefined || content === null) return [];
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}

export function contentText(content: string | AnthropicBlock[] | undefined): string {
  return blocksOf(content)
    .filter((b) => b.type === 'text')
    .map(blockText)
    .join('\n\n');
}

function imagePart(block: AnthropicBlock): OpenAIContentPart | null {
  const src = block.source as { type?: string; media_type?: string; data?: string; url?: string } | undefined;
  if (!src) return null;
  if (src.type === 'base64' && src.data) return { type: 'image_url', image_url: { url: `data:${src.media_type ?? 'image/png'};base64,${src.data}` } };
  if (src.type === 'url' && src.url) return { type: 'image_url', image_url: { url: src.url } };
  return null;
}

function toolResultParts(block: AnthropicBlock): { text: string; images: OpenAIContentPart[] } {
  const inner = block.content as string | AnthropicBlock[] | undefined;
  const images: OpenAIContentPart[] = [];
  const texts: string[] = [];
  for (const b of blocksOf(inner)) {
    if (b.type === 'text') texts.push(blockText(b));
    else if (b.type === 'image') {
      const part = imagePart(b);
      if (part) images.push(part);
      texts.push('[imagem enviada a seguir]');
    }
  }
  let text = texts.join('\n');
  if (!text.trim()) text = '(sem saída)';
  if (block.is_error === true) text = `[erro da ferramenta] ${text}`;
  return { text, images };
}

function pushUser(out: OpenAIMessage[], parts: OpenAIContentPart[]): void {
  if (!parts.length) return;
  const prev = out[out.length - 1];
  const onlyText = parts.every((p) => p.type === 'text');
  if (prev && prev.role === 'user') {
    const merged = [...asParts(prev.content), ...parts];
    prev.content = merged.every((p) => p.type === 'text') ? textOf(merged) : merged;
    return;
  }
  out.push({ role: 'user', content: onlyText ? textOf(parts) : parts });
}

function asParts(content: OpenAIMessage['content']): OpenAIContentPart[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content ?? [];
}

function textOf(parts: OpenAIContentPart[]): string {
  return parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n\n');
}

function convertUser(m: AnthropicMessageIn, out: OpenAIMessage[]): void {
  const parts: OpenAIContentPart[] = [];
  const lateImages: OpenAIContentPart[] = [];
  for (const b of blocksOf(m.content)) {
    if (b.type === 'tool_result') {
      const r = toolResultParts(b);
      out.push({ role: 'tool', tool_call_id: String(b.tool_use_id ?? ''), content: r.text });
      lateImages.push(...r.images);
    } else if (b.type === 'text') {
      if (blockText(b).length) parts.push({ type: 'text', text: blockText(b) });
    } else if (b.type === 'image') {
      const p = imagePart(b);
      if (p) parts.push(p);
    } else if (b.type === 'document') {
      const src = b.source as { type?: string; data?: string } | undefined;
      parts.push({ type: 'text', text: src?.type === 'text' && src.data ? src.data : '[documento omitido]' });
    }
  }
  pushUser(out, [...parts, ...lateImages]);
}

function convertAssistant(m: AnthropicMessageIn, echoReasoning: boolean): OpenAIMessage {
  const texts: string[] = [];
  const reasoning: string[] = [];
  const calls: OpenAIToolCall[] = [];
  for (const b of blocksOf(m.content)) {
    if (b.type === 'text') texts.push(blockText(b));
    else if (b.type === 'thinking') reasoning.push(String(b.thinking ?? ''));
    else if (b.type === 'tool_use') {
      calls.push({
        id: String(b.id ?? ''),
        type: 'function',
        function: { name: toOpenAIName(String(b.name ?? '')), arguments: JSON.stringify(b.input ?? {}) },
      });
    }
  }
  const msg: OpenAIMessage = { role: 'assistant', content: texts.join('') };
  if (calls.length) msg.tool_calls = calls;
  const think = reasoning.join('');
  if (echoReasoning && think) msg.reasoning_content = think;
  return msg;
}

// OpenAI answers 400 to a tool message with no matching tool_call and to a tool_call with no tool message.
function fixToolPairing(messages: OpenAIMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  let open: string[] = [];
  const closeOpen = () => {
    for (const id of open) out.push({ role: 'tool', tool_call_id: id, content: '(sem resultado)' });
    open = [];
  };
  for (const m of messages) {
    if (m.role === 'tool') {
      const i = open.indexOf(m.tool_call_id ?? '');
      if (i >= 0) {
        open.splice(i, 1);
        out.push(m);
      } else {
        pushUser(out, [{ type: 'text', text: `[resultado de ferramenta ${m.tool_call_id ?? ''}]\n${String(m.content ?? '')}` }]);
      }
      continue;
    }
    closeOpen();
    out.push(m);
    if (m.role === 'assistant' && m.tool_calls) open = m.tool_calls.map((c) => c.id);
  }
  closeOpen();
  return out;
}

function stripSchema(schema: Json | undefined): Json {
  const base: Json = schema && typeof schema === 'object' ? { ...schema } : {};
  delete base.$schema;
  if (base.type === undefined) base.type = 'object';
  if (base.type === 'object' && base.properties === undefined) base.properties = {};
  return base;
}

function cut(text: string | undefined, max: number | undefined): string | undefined {
  if (text === undefined || !max || text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function lastMessageText(req: AnthropicRequest): string {
  const last = req.messages[req.messages.length - 1];
  return last ? contentText(last.content) : '';
}

export function translateRequest(req: AnthropicRequest, opts: TranslateOptions): Translated {
  const drop = opts.dropParams ?? new Set<string>();
  const toolNames = new Map<string, string>();
  const tools: NonNullable<OpenAIRequest['tools']> = [];
  for (const t of req.tools ?? []) {
    if (!t || typeof t.name !== 'string') continue;
    // Server-side tools (web_search_20250305 and friends) have no schema and cannot run on another provider.
    if (t.type && t.type !== 'custom' && !t.input_schema) continue;
    const name = toOpenAIName(t.name);
    toolNames.set(name, t.name);
    tools.push({ type: 'function', function: { name, description: cut(t.description, opts.toolDescriptionMax), parameters: stripSchema(t.input_schema) } });
  }

  const systemParts: string[] = [];
  if (typeof req.system === 'string') systemParts.push(req.system);
  else {
    for (const b of req.system ?? []) {
      const text = blockText(b);
      // The binary prefixes a billing header block that means nothing outside Anthropic and breaks prompt-prefix caches.
      if (b.type === 'text' && text && !text.startsWith('x-anthropic-billing-header')) systemParts.push(text);
    }
  }

  // The binary also sends role "system" messages inside the list. Before the first assistant turn they are context for the whole
  // conversation and join the system prompt; later ones become user text, since many chat templates reject a system turn there.
  const converted: OpenAIMessage[] = [];
  let sawAssistant = false;
  for (const m of req.messages ?? []) {
    if (m.role === 'system') {
      const text = contentText(m.content);
      if (!text) continue;
      if (sawAssistant) pushUser(converted, [{ type: 'text', text }]);
      else systemParts.push(text);
    } else if (m.role === 'assistant') {
      sawAssistant = true;
      converted.push(convertAssistant(m, opts.echoReasoning === true));
    } else {
      convertUser(m, converted);
    }
  }
  const messages = fixToolPairing(converted);
  const system = systemParts.join('\n\n').trim();
  if (system) messages.unshift({ role: 'system', content: system });

  const stream = opts.stream ?? req.stream === true;
  const body: OpenAIRequest = { model: opts.model, messages };
  if (stream) {
    body.stream = true;
    if (!drop.has('stream_options')) body.stream_options = { include_usage: true };
  }
  const maxTokens = opts.maxOutputTokens && req.max_tokens ? Math.min(req.max_tokens, opts.maxOutputTokens) : req.max_tokens ?? opts.maxOutputTokens;
  if (maxTokens) body[opts.maxTokensField ?? 'max_tokens'] = maxTokens;
  if (typeof req.temperature === 'number' && !drop.has('temperature')) body.temperature = req.temperature;
  if (typeof req.top_p === 'number' && !drop.has('top_p')) body.top_p = req.top_p;
  if (req.stop_sequences?.length && !drop.has('stop')) body.stop = req.stop_sequences.slice(0, 4);

  const structuredTool = (req.tools ?? []).find((t) => t.name === STRUCTURED_OUTPUT_TOOL && t.input_schema);
  const structured = structuredTool ? { name: toOpenAIName(STRUCTURED_OUTPUT_TOOL), schema: stripSchema(structuredTool.input_schema) } : null;
  const enforce = !!structured && lastMessageText(req).includes(ENFORCE_MARKER);

  if (tools.length) {
    body.tools = tools;
    const choice = req.tool_choice;
    if (!drop.has('tool_choice')) {
      if (enforce && opts.forceStructured !== false && structured) body.tool_choice = { type: 'function', function: { name: structured.name } };
      else if (choice?.type === 'any') body.tool_choice = 'required';
      else if (choice?.type === 'none') body.tool_choice = 'none';
      else if (choice?.type === 'tool' && choice.name) body.tool_choice = { type: 'function', function: { name: toOpenAIName(choice.name) } };
      else if (choice?.type === 'auto') body.tool_choice = 'auto';
    }
    if ((choice?.disable_parallel_tool_use === true || enforce) && !drop.has('parallel_tool_calls')) body.parallel_tool_calls = false;
  }

  // Native Anthropic structured outputs (output_config.format), when the caller uses them instead of the StructuredOutput tool.
  const format = req.output_config?.format;
  if (format?.type === 'json_schema' && format.schema && !drop.has('response_format')) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'response', schema: stripSchema(format.schema), strict: false } };
  }

  return { body, toolNames, structured, enforce, inputEstimate: estimateTokens(messages) + estimateTokens(tools) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Response side

// Reasoning models behind llama.cpp, Ollama and LM Studio often write <think>…</think> into the content. The tag only counts at the
// very start of the answer.
export class ThinkSplitter {
  private state: 'start' | 'in' | 'out' = 'start';
  private buf = '';

  feed(chunk: string): { kind: 'text' | 'thinking'; text: string }[] {
    this.buf += chunk;
    const out: { kind: 'text' | 'thinking'; text: string }[] = [];
    for (;;) {
      if (this.state === 'start') {
        const t = this.buf.trimStart();
        if (t.startsWith('<think>')) {
          this.buf = t.slice(7);
          this.state = 'in';
          continue;
        }
        if ('<think>'.startsWith(t) && t.length < 7) return out;
        this.state = 'out';
        continue;
      }
      if (this.state === 'in') {
        const i = this.buf.indexOf('</think>');
        if (i >= 0) {
          if (i > 0) out.push({ kind: 'thinking', text: this.buf.slice(0, i) });
          this.buf = this.buf.slice(i + 8).replace(/^\s*\n/, '');
          this.state = 'out';
          continue;
        }
        let keep = 0;
        for (let k = Math.min(7, this.buf.length); k > 0; k--) {
          if ('</think>'.startsWith(this.buf.slice(this.buf.length - k))) {
            keep = k;
            break;
          }
        }
        const emit = this.buf.slice(0, this.buf.length - keep);
        if (emit) out.push({ kind: 'thinking', text: emit });
        this.buf = this.buf.slice(this.buf.length - keep);
        return out;
      }
      if (this.buf) out.push({ kind: 'text', text: this.buf });
      this.buf = '';
      return out;
    }
  }

  flush(): { kind: 'text' | 'thinking'; text: string }[] {
    const rest = this.buf;
    this.buf = '';
    if (!rest) return [];
    return [{ kind: this.state === 'in' ? 'thinking' : 'text', text: rest }];
  }
}

export function splitThink(text: string): { kind: 'text' | 'thinking'; text: string }[] {
  const s = new ThinkSplitter();
  return [...s.feed(text), ...s.flush()];
}

function closeJson(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = text;
  if (inString) out += '"';
  out = out.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
  return out + stack.reverse().join('');
}

// Syntax repair for what weak models put in JSON: code fences, text around the object, trailing commas, truncation.
export function repairJson(text: string): unknown | undefined {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1];
  const tries = [t];
  const first = t.search(/[{[]/);
  if (first > 0) tries.push(t.slice(first));
  const lastObj = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (first >= 0 && lastObj > first) tries.push(t.slice(first, lastObj + 1));
  for (const candidate of tries) {
    for (const variant of [candidate, candidate.replace(/,(\s*[}\]])/g, '$1'), closeJson(candidate.replace(/,(\s*[}\]])/g, '$1'))]) {
      try {
        return JSON.parse(variant);
      } catch {
        // next variant
      }
    }
  }
  return undefined;
}

export function parseToolArguments(raw: unknown): Json {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Json;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  let value = repairJson(raw);
  // Some servers encode the arguments twice.
  if (typeof value === 'string') value = repairJson(value);
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

export function newId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 24; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}_${id}`;
}

export function mapFinishReason(reason: string | null | undefined, hasToolCalls: boolean): StopReason {
  if (hasToolCalls) return 'tool_use';
  switch (reason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

export function mapUsage(u: OpenAIUsage | undefined, fallbackIn: number, fallbackOut: number): Usage {
  if (!u || (u.prompt_tokens === undefined && u.completion_tokens === undefined)) return { input_tokens: fallbackIn, output_tokens: fallbackOut };
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0;
  const prompt = u.prompt_tokens ?? fallbackIn;
  return {
    input_tokens: Math.max(0, prompt - cached),
    output_tokens: u.completion_tokens ?? fallbackOut,
    ...(cached ? { cache_read_input_tokens: cached } : {}),
  };
}

export interface ResponseContext {
  model: string;
  toolNames: Map<string, string>;
  inputEstimate: number;
  // Set when the binary demanded the final structured answer: plain JSON text becomes the tool call.
  structured?: { name: string; schema: Json } | null;
  enforce?: boolean;
}

export class UpstreamFormatError extends Error {}

export function translateResponse(res: OpenAIResponse, ctx: ResponseContext): AnthropicMessageOut {
  const choice = res.choices?.[0];
  if (!choice || !choice.message) throw new UpstreamFormatError('sem choices na resposta');
  const m = choice.message;
  let content: AnthropicBlock[] = [];
  const reasoning = m.reasoning_content ?? m.reasoning;
  if (reasoning) content.push({ type: 'thinking', thinking: reasoning, signature: THINKING_SIGNATURE });
  let produced = 0;
  for (const piece of splitThink(m.content ?? '')) {
    if (!piece.text) continue;
    produced += piece.text.length;
    content.push(piece.kind === 'thinking' ? { type: 'thinking', thinking: piece.text, signature: THINKING_SIGNATURE } : { type: 'text', text: piece.text });
  }
  if (m.refusal) content.push({ type: 'text', text: m.refusal });
  for (const tc of m.tool_calls ?? []) {
    const name = tc.function?.name ?? '';
    content.push({
      type: 'tool_use',
      id: tc.id || newId('toolu'),
      name: ctx.toolNames.get(name) ?? name,
      input: parseToolArguments(tc.function?.arguments),
    });
  }
  content = mergeAdjacentText(content);
  if (ctx.enforce && ctx.structured) content = repairStructured(content, ctx.structured, ctx.toolNames);
  if (!content.some((b) => b.type !== 'thinking')) content.push({ type: 'text', text: '' });
  const hasTools = content.some((b) => b.type === 'tool_use');
  return {
    id: newId('msg'),
    type: 'message',
    role: 'assistant',
    model: ctx.model,
    content,
    stop_reason: mapFinishReason(choice.finish_reason, hasTools),
    stop_sequence: null,
    usage: mapUsage(res.usage, ctx.inputEstimate, Math.ceil((produced + JSON.stringify(m.tool_calls ?? []).length) / 4)),
  };
}

function mergeAdjacentText(blocks: AnthropicBlock[]): AnthropicBlock[] {
  const out: AnthropicBlock[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text' && b.type === 'text') prev.text = `${blockText(prev)}${blockText(b)}`;
    else out.push({ ...b });
  }
  return out;
}

function schemaFits(value: unknown, schema: Json): value is Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Json;
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  if (!required.every((k) => k in obj)) return false;
  const props = Object.keys((schema.properties as Json | undefined) ?? {});
  return props.length === 0 || Object.keys(obj).some((k) => props.includes(k));
}

// The final structured answer is the one thing the app cannot do without. A weak model sometimes writes the JSON as plain text
// instead of calling the tool; when it parses and has the schema's required keys, it is the tool call.
export function repairStructured(content: AnthropicBlock[], structured: { name: string; schema: Json }, toolNames: Map<string, string>): AnthropicBlock[] {
  const anthropicName = toolNames.get(structured.name) ?? STRUCTURED_OUTPUT_TOOL;
  if (content.some((b) => b.type === 'tool_use' && b.name === anthropicName)) return content;
  const text = content.filter((b) => b.type === 'text').map(blockText).join('');
  const value = text.trim() ? repairJson(text) : undefined;
  if (!schemaFits(value, structured.schema)) return content;
  return [...content.filter((b) => b.type === 'thinking'), { type: 'tool_use', id: newId('toolu'), name: anthropicName, input: value }];
}
