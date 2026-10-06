// Small pure helpers: tool names, ids, token estimates, <think> splitting, JSON repair, SSE parsing.
import type { Json } from './types';

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
export function toApiName(name: string): string {
  if (NAME_OK.test(name)) return name;
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'tool';
  return `${safe.slice(0, 55)}_${fnv(name)}`.slice(0, 64);
}

export function newId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 20; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}_${id}`;
}

// What one image costs a model, roughly: a picture is billed by its size, not by its base64, which would count as tens of thousands of tokens of text.
const IMAGE_TOKENS = 1600;

export function estimateTokens(value: unknown): number {
  let images = 0;
  const text = typeof value === 'string' ? value : (JSON.stringify(value, (_k, v) => (typeof v === 'string' && v.startsWith('data:image/') ? (images++, '') : v)) ?? '');
  return Math.ceil(text.length / 4) + images * IMAGE_TOKENS;
}

// Reasoning models behind llama.cpp, Ollama and LM Studio often write <think>…</think> into the content. The tag only counts at the
// very start of the answer.
export type Piece = { kind: 'text' | 'thinking'; text: string };

export class ThinkSplitter {
  private state: 'start' | 'in' | 'out' = 'start';
  private buf = '';

  feed(chunk: string): Piece[] {
    this.buf += chunk;
    const out: Piece[] = [];
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

  flush(): Piece[] {
    const rest = this.buf;
    this.buf = '';
    if (!rest) return [];
    return [{ kind: this.state === 'in' ? 'thinking' : 'text', text: rest }];
  }
}

export function splitThink(text: string): Piece[] {
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
    const noCommas = candidate.replace(/,(\s*[}\]])/g, '$1');
    for (const variant of [candidate, noCommas, closeJson(noCommas)]) {
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
