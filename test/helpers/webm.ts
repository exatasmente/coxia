// The smallest bytes that read as a WebM file to the app's check: the EBML magic and a DocType of `webm`. A test that needs a playable file builds it with the muxer.
export function webmHead(extra = 0): Uint8Array {
  const head = [0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d];
  // Allocated at once: a recording near its ceiling is tens of megabytes, too many for an array spread.
  const bytes = new Uint8Array(head.length + extra);
  bytes.set(head);
  return bytes;
}
