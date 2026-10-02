// Chat text parsing for RichText: pure and DOM-free so it can be tested.

export type Part = { kind: 'text' | 'diagram'; value: string };
export type Block = { kind: 'p' | 'ul' | 'ol' | 'h' | 'pre'; lines: string[]; start?: number };
export type Span = { kind: 'text' | 'code' | 'bold'; value: string };

const FENCE = /```mermaid[ \t]*\n([\s\S]*?)```/g;
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
const ITEM = /^\s*(?:[-*•]|(\d+)[.)])\s+/;
const HEADING = /^#{1,6}\s+/;

const normalize = (text: string) => text.replace(/\r\n?/g, '\n');

// Splits chat text around complete ```mermaid fences; an unterminated fence stays text.
export function splitDiagrams(text: string): Part[] {
  const src = normalize(text);
  const parts: Part[] = [];
  let last = 0;
  for (const m of src.matchAll(FENCE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ kind: 'text', value: src.slice(last, at) });
    parts.push({ kind: 'diagram', value: m[1] });
    last = at + m[0].length;
  }
  if (last < src.length) parts.push({ kind: 'text', value: src.slice(last) });
  return parts;
}

// Paragraphs, lists, headings and fenced code, line by line. A blank line ends a paragraph but not a list.
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let code: string[] | null = null;
  let afterBlank = false;
  for (const line of normalize(text).split('\n')) {
    if (line.trim().startsWith('```')) {
      if (code) {
        blocks.push({ kind: 'pre', lines: code });
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      afterBlank = true;
      continue;
    }
    const last = blocks[blocks.length - 1];
    const item = ITEM.exec(line);
    if (item) {
      const kind = item[1] ? 'ol' : 'ul';
      const body = line.replace(ITEM, '');
      if (last?.kind === kind) last.lines.push(body);
      else blocks.push({ kind, lines: [body], ...(kind === 'ol' ? { start: Number(item[1]) } : {}) });
    } else if (HEADING.test(trimmed)) {
      blocks.push({ kind: 'h', lines: [trimmed.replace(HEADING, '')] });
    } else if (last?.kind === 'p' && !afterBlank) last.lines.push(trimmed);
    else blocks.push({ kind: 'p', lines: [trimmed] });
    afterBlank = false;
  }
  if (code) blocks.push({ kind: 'pre', lines: code });
  return blocks.filter((b) => b.lines.length);
}

// `code` and **bold**; code wins when it starts first, so ** inside backticks stays literal.
export function parseInline(text: string): Span[] {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((part): Span => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return { kind: 'code', value: part.slice(1, -1) };
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return { kind: 'bold', value: part.slice(2, -2) };
      return { kind: 'text', value: part };
    });
}
