// JSON wire format of the HTTP RPC: binary values travel as { $bytes: base64 }, undefined array items as { $undefined: true }.
const BYTES = '$bytes';
const UNDEFINED = '$undefined';

interface NodeBuffer {
  from(b: ArrayBufferLike, offset?: number, length?: number): { toString(encoding: string): string };
  from(s: string, encoding: string): Uint8Array;
}

const nodeBuffer = (): NodeBuffer | undefined => (globalThis as unknown as { Buffer?: NodeBuffer }).Buffer;

export function bytesToBase64(bytes: Uint8Array): string {
  const B = nodeBuffer();
  if (B) return B.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const B = nodeBuffer();
  const bytes = B ? B.from(b64, 'base64') : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function encodeWire(value: unknown): unknown {
  if (value === undefined) return { [UNDEFINED]: true };
  if (value instanceof ArrayBuffer) return { [BYTES]: bytesToBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { [BYTES]: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (Array.isArray(value)) return value.map(encodeWire);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encodeWire(v)]));
  }
  return value;
}

export function decodeWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeWire);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === BYTES && typeof o[BYTES] === 'string') return base64ToArrayBuffer(o[BYTES]);
    if (keys.length === 1 && keys[0] === UNDEFINED) return undefined;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, decodeWire(v)]));
  }
  return value;
}
