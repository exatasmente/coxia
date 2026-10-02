// Streaming side of the translation: OpenAI chat.completion.chunk events in, Anthropic SSE frames out.
import {
  type AnthropicBlock,
  type AnthropicMessageOut,
  type Json,
  type OpenAIUsage,
  type ResponseContext,
  THINKING_SIGNATURE,
  ThinkSplitter,
  mapFinishReason,
  mapUsage,
  newId,
  parseToolArguments,
  repairStructured,
} from './openaiCore';

export function sseFrame(event: string, data: Json): string {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
}

export const PING_FRAME = sseFrame('ping', {});

// Parses a text/event-stream body into the `data:` payloads of its events.
export class SseParser {
  private buf = '';

  push(text: string): string[] {
    this.buf += text;
    const events = this.buf.split(/\r?\n\r?\n/);
    this.buf = events.pop() ?? '';
    return events.flatMap((e) => this.dataOf(e));
  }

  flush(): string[] {
    const rest = this.buf;
    this.buf = '';
    return rest.trim() ? this.dataOf(rest) : [];
  }

  private dataOf(event: string): string[] {
    const lines = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''));
    return lines.length ? [lines.join('\n')] : [];
  }
}

export interface OpenAIChunk {
  choices?: {
    index?: number;
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      refusal?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: OpenAIUsage | null;
  error?: unknown;
}

export interface StreamOptions extends ResponseContext {
  // Hold every event back and replay the finished message (after the structured-output repair) when the stream ends.
  buffer?: boolean;
}

interface TextAcc {
  kind: 'text' | 'thinking';
  text: string;
  index: number;
}

interface ToolAcc {
  kind: 'tool';
  id: string;
  idKnown: boolean;
  name?: string;
  args: string;
  started: boolean;
  openaiIndex?: number;
  index: number;
}

type Acc = TextAcc | ToolAcc;

function completeJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export class StreamTranslator {
  // Which reasoning field the upstream used, so the adapter can echo it back when that upstream needs it.
  reasoningField: 'reasoning_content' | 'reasoning' | null = null;

  private out: string[] = [];
  private started = false;
  private done = false;
  private failed = false;
  private accs: Acc[] = [];
  private open: Acc | null = null;
  private curTool: ToolAcc | null = null;
  private nextIndex = 0;
  private split = new ThinkSplitter();
  private finishReason: string | null | undefined;
  private usage: OpenAIUsage | undefined;
  private chars = 0;
  private id = newId('msg');

  constructor(private ctx: StreamOptions) {}

  get hasFailed(): boolean {
    return this.failed;
  }

  start(): string[] {
    if (this.started) return [];
    this.started = true;
    const message: AnthropicMessageOut = {
      id: this.id,
      type: 'message',
      role: 'assistant',
      model: this.ctx.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: this.ctx.inputEstimate, output_tokens: 0 },
    };
    return [sseFrame('message_start', { message })];
  }

  push(chunk: OpenAIChunk): string[] {
    if (this.done) return [];
    this.out = this.begin();
    if (chunk.error !== undefined && chunk.error !== null) return [...this.out, ...this.fail(errorText(chunk.error))];
    if (chunk.usage) this.usage = chunk.usage;
    const choice = chunk.choices?.find((c) => (c.index ?? 0) === 0);
    if (choice) {
      const d = choice.delta ?? {};
      const reasoning = d.reasoning_content ?? d.reasoning;
      if (d.reasoning_content) this.reasoningField = 'reasoning_content';
      else if (d.reasoning) this.reasoningField = this.reasoningField ?? 'reasoning';
      if (reasoning) this.text('thinking', reasoning);
      if (d.content) for (const piece of this.split.feed(d.content)) this.text(piece.kind, piece.text);
      if (d.refusal) this.text('text', d.refusal);
      for (const tc of d.tool_calls ?? []) this.tool(tc);
      if (choice.finish_reason) this.finishReason = choice.finish_reason;
    }
    return this.out;
  }

  // Closes the message. Call it when the upstream stream ends, with or without [DONE].
  end(): string[] {
    if (this.done) return [];
    this.out = this.begin();
    for (const piece of this.split.flush()) this.text(piece.kind, piece.text);
    if (this.ctx.buffer) {
      const blocks = this.finalBlocks();
      this.accs = [];
      this.open = null;
      this.emitBlocks(blocks);
      return this.finish(blocks.some((b) => b.type === 'tool_use'));
    }
    this.closeBlock();
    const sawTool = this.accs.some((a) => a.kind === 'tool' && a.started);
    if (!this.accs.some((a) => a.kind === 'text' || (a.kind === 'tool' && a.started))) this.emptyText();
    return this.finish(sawTool);
  }

  // The stream broke after the headers went out: the only way left to say so is an error event.
  fail(message: string, type = 'api_error'): string[] {
    if (this.done) return [];
    this.done = true;
    this.failed = true;
    return [...this.begin(), sseFrame('error', { error: { type, message } })];
  }

  private begin(): string[] {
    return this.start();
  }

  private emit(event: string, data: Json): void {
    if (!this.ctx.buffer) this.out.push(sseFrame(event, data));
  }

  private text(kind: 'text' | 'thinking', text: string): void {
    if (!text) return;
    this.chars += text.length;
    let acc = this.open && this.open.kind === kind ? this.open : null;
    if (!acc) {
      if (this.ctx.buffer) {
        const last = this.accs[this.accs.length - 1];
        if (last && last.kind === kind) acc = last;
      }
      if (!acc) {
        this.closeBlock();
        acc = { kind, text: '', index: this.nextIndex++ };
        this.accs.push(acc);
        this.open = acc;
        this.emit('content_block_start', {
          index: acc.index,
          content_block: kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '', signature: '' },
        });
      }
    }
    if (this.ctx.buffer) this.open = acc;
    acc.text += text;
    this.emit('content_block_delta', {
      index: acc.index,
      delta: kind === 'text' ? { type: 'text_delta', text } : { type: 'thinking_delta', thinking: text },
    });
  }

  private tool(tc: NonNullable<NonNullable<NonNullable<OpenAIChunk['choices']>[number]['delta']>['tool_calls']>[number]): void {
    const idx = typeof tc.index === 'number' ? tc.index : undefined;
    const id = tc.id || undefined;
    const name = tc.function?.name || undefined;
    const args = tc.function?.arguments ?? '';
    const cur = this.curTool;
    let startsNew = !cur;
    if (cur) {
      if (id && cur.idKnown && id !== cur.id) startsNew = true;
      else if (idx !== undefined && cur.openaiIndex !== undefined && idx !== cur.openaiIndex) startsNew = true;
      // Servers that number every parallel call 0 and omit the id: a call that already holds complete JSON is finished.
      else if (!id && name && cur.name && cur.args && completeJson(cur.args)) startsNew = true;
    }
    let acc: ToolAcc;
    if (startsNew || !cur) {
      this.closeBlock();
      acc = { kind: 'tool', id: id ?? newId('toolu'), idKnown: !!id, name, args: '', started: false, openaiIndex: idx, index: -1 };
      this.accs.push(acc);
      this.curTool = acc;
    } else {
      acc = cur;
      if (id && !acc.idKnown) {
        acc.id = id;
        acc.idKnown = true;
      }
      if (name && !acc.name) acc.name = name;
    }
    acc.args += args;
    if (this.ctx.buffer) {
      acc.started = !!acc.name;
      return;
    }
    if (!acc.started && acc.name) {
      acc.started = true;
      acc.index = this.nextIndex++;
      this.open = acc;
      this.emit('content_block_start', {
        index: acc.index,
        content_block: { type: 'tool_use', id: acc.id, name: this.ctx.toolNames.get(acc.name) ?? acc.name, input: {} },
      });
      if (acc.args) this.emit('content_block_delta', { index: acc.index, delta: { type: 'input_json_delta', partial_json: acc.args } });
      return;
    }
    if (acc.started && args && this.open === acc) {
      this.emit('content_block_delta', { index: acc.index, delta: { type: 'input_json_delta', partial_json: args } });
    }
  }

  private closeBlock(): void {
    const acc = this.open;
    if (!acc) return;
    this.open = null;
    if (acc.kind === 'thinking') this.emit('content_block_delta', { index: acc.index, delta: { type: 'signature_delta', signature: THINKING_SIGNATURE } });
    if (acc.kind === 'tool' && !acc.args) this.emit('content_block_delta', { index: acc.index, delta: { type: 'input_json_delta', partial_json: '{}' } });
    this.emit('content_block_stop', { index: acc.index });
  }

  private emptyText(): void {
    const index = this.nextIndex++;
    this.out.push(sseFrame('content_block_start', { index, content_block: { type: 'text', text: '' } }));
    this.out.push(sseFrame('content_block_stop', { index }));
  }

  private finalBlocks(): AnthropicBlock[] {
    let blocks: AnthropicBlock[] = [];
    for (const a of this.accs) {
      if (a.kind === 'tool') {
        if (!a.started || !a.name) continue;
        blocks.push({ type: 'tool_use', id: a.id, name: this.ctx.toolNames.get(a.name) ?? a.name, input: parseToolArguments(a.args) });
      } else if (a.kind === 'thinking') blocks.push({ type: 'thinking', thinking: a.text, signature: THINKING_SIGNATURE });
      else blocks.push({ type: 'text', text: a.text });
    }
    if (this.ctx.enforce && this.ctx.structured) blocks = repairStructured(blocks, this.ctx.structured, this.ctx.toolNames);
    return blocks;
  }

  private emitBlocks(blocks: AnthropicBlock[]): void {
    this.out.push(...blocksToFrames(blocks));
  }

  private finish(sawTool: boolean): string[] {
    this.done = true;
    const usage = mapUsage(this.usage, this.ctx.inputEstimate, Math.ceil(this.chars / 4));
    this.out.push(
      sseFrame('message_delta', {
        delta: { stop_reason: mapFinishReason(this.finishReason, sawTool), stop_sequence: null },
        usage,
      }),
    );
    this.out.push(sseFrame('message_stop', {}));
    return this.out;
  }
}

export function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; error?: unknown };
    if (typeof e.message === 'string') return e.message;
    if (e.error) return errorText(e.error);
    return JSON.stringify(error).slice(0, 300);
  }
  return String(error);
}

// Content blocks as the Anthropic block events; a message made only of thinking gets an empty text block, the binary needs one.
export function blocksToFrames(blocks: AnthropicBlock[]): string[] {
  const all = blocks.some((b) => b.type !== 'thinking') ? blocks : [...blocks, { type: 'text', text: '' }];
  const out: string[] = [];
  all.forEach((b, index) => {
    if (b.type === 'thinking') {
      out.push(sseFrame('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } }));
      out.push(sseFrame('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: b.thinking } }));
      out.push(sseFrame('content_block_delta', { index, delta: { type: 'signature_delta', signature: THINKING_SIGNATURE } }));
    } else if (b.type === 'tool_use') {
      out.push(sseFrame('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }));
      out.push(sseFrame('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input ?? {}) } }));
    } else {
      out.push(sseFrame('content_block_start', { index, content_block: { type: 'text', text: '' } }));
      if (b.text) out.push(sseFrame('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } }));
    }
    out.push(sseFrame('content_block_stop', { index }));
  });
  return out;
}

// A complete Anthropic message as the SSE sequence, for upstreams that ignore stream:true and answer with plain JSON.
export function messageToFrames(message: AnthropicMessageOut): string[] {
  return [
    sseFrame('message_start', { message: { ...message, content: [], stop_reason: null } }),
    ...blocksToFrames(message.content),
    sseFrame('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: message.usage }),
    sseFrame('message_stop', {}),
  ];
}
