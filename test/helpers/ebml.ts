// A small EBML reader for tests: it walks the bytes of a WebM file the way a demuxer does, so a round trip checks the muxer's own output and not its own idea of it.
export interface EbmlNode {
  /** The element id as hex, marker bits kept (`1a45dfa3`). */
  id: string;
  /** Where the element starts, and where its payload starts and ends. */
  at: number;
  start: number;
  end: number;
  children: EbmlNode[];
  bytes: Uint8Array;
}

// The master elements the reader goes into.
const MASTERS = new Set(['1a45dfa3', '18538067', '114d9b74', '4dbb', '1549a966', '1654ae6b', 'ae', 'e0', '1f43b675', '1c53bb6b', 'bb', 'b7']);

function vint(b: Uint8Array, at: number, keepMarker: boolean): { value: number; length: number } {
  const first = b[at];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8) throw new Error(`bad EBML integer at ${at}`);
  let value = keepMarker ? first : first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + b[at + i];
  return { value, length };
}

export function readEbml(bytes: Uint8Array, from = 0, to = bytes.length): EbmlNode[] {
  const out: EbmlNode[] = [];
  let at = from;
  while (at < to) {
    const id = vint(bytes, at, true);
    const size = vint(bytes, at + id.length, false);
    const start = at + id.length + size.length;
    const end = start + size.value;
    if (end > to) throw new Error(`element at ${at} runs past its parent (${end} > ${to})`);
    const hex = Buffer.from(bytes.subarray(at, at + id.length)).toString('hex');
    out.push({ id: hex, at, start, end, bytes: bytes.subarray(start, end), children: MASTERS.has(hex) ? readEbml(bytes, start, end) : [] });
    at = end;
  }
  return out;
}

export const child = (n: EbmlNode, id: string): EbmlNode | undefined => n.children.find((c) => c.id === id);
export const all = (n: EbmlNode, id: string): EbmlNode[] => n.children.filter((c) => c.id === id);
export const uintOf = (n: EbmlNode): number => n.bytes.reduce((v, b) => v * 256 + b, 0);
export const floatOf = (n: EbmlNode): number => new DataView(n.bytes.buffer, n.bytes.byteOffset, n.bytes.length).getFloat64(0, false);
export const textOf = (n: EbmlNode): string => Buffer.from(n.bytes).toString('ascii');
