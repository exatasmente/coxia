// The picture types every model provider takes (PNG, JPEG, GIF, WebP), told by a file's first bytes, never by its name: a file the agent or a process inside a sandbox
// made can be called anything.

/** The media type of an image from its first bytes (12 are enough); null for anything else. */
export function imageMediaType(head: Buffer): string | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 6 && /^GIF8[79]a$/.test(head.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** The most an image may weigh for a model: what the providers take for one, with room to spare (the base64 of 4 MiB is about 5.3 MiB). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
