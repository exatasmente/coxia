import { describe, expect, it } from 'vitest';
import { WEBM_CLUSTER_MS, ebmlSize, muxWebm, type WebmChunk } from '../src/main/screen/webm';
import { all, child, floatOf, readEbml, textOf, uintOf, type EbmlNode } from './helpers/ebml';

// The muxer's own output read back by a reader that is not the muxer's: the header, the Info with the Duration, the track, the clusters with their block times and the Cues
// with the offsets of the clusters.

const frame = (ts: number, key: boolean, n = 5): WebmChunk => ({ ts, key, data: Uint8Array.from({ length: n }, (_, i) => (ts + i) & 0xff) });
const O = { width: 1280, height: 800, durationMs: 10_000 };

function parse(bytes: Uint8Array): { header: EbmlNode; segment: EbmlNode } {
  const [header, segment, ...rest] = readEbml(bytes);
  expect(rest).toEqual([]);
  return { header, segment };
}

describe('the size of an element', () => {
  it('uses the fewest bytes, 1 to 8, and never the reserved all-ones value', () => {
    expect([...ebmlSize(0)]).toEqual([0x80]);
    expect([...ebmlSize(126)]).toEqual([0xfe]);
    // 127 would be all ones in one byte: it takes two.
    expect([...ebmlSize(127)]).toEqual([0x40, 0x7f]);
    expect([...ebmlSize(16_382)]).toEqual([0x7f, 0xfe]);
    expect([...ebmlSize(16_383)]).toEqual([0x20, 0x3f, 0xff]);
    expect(ebmlSize(2 ** 21).length).toBe(4);
    expect(ebmlSize(2 ** 28).length).toBe(5);
    expect(ebmlSize(2 ** 35).length).toBe(6);
    expect(ebmlSize(2 ** 42).length).toBe(7);
    expect(ebmlSize(2 ** 49).length).toBe(8);
    expect(() => ebmlSize(-1)).toThrow(RangeError);
    expect(() => ebmlSize(1.5)).toThrow(RangeError);
  });
});

describe('the file', () => {
  it('opens with an EBML header that says webm, then one Segment that holds the rest exactly', () => {
    const bytes = muxWebm([frame(0, true)], O);
    const { header, segment } = parse(bytes);
    expect(header.id).toBe('1a45dfa3');
    expect(textOf(child(header, '4282') ?? header)).toBe('webm');
    expect(segment.id).toBe('18538067');
    expect(segment.end).toBe(bytes.length);
    expect(segment.children.map((c) => c.id)).toEqual(['114d9b74', '1549a966', '1654ae6b', '1f43b675', '1c53bb6b']);
  });

  it('writes the Duration as the stop time, also after a long still stretch past the last frame', () => {
    const { segment } = parse(muxWebm([frame(0, true), frame(2000, false)], { ...O, durationMs: 600_000 }));
    const info = child(segment, '1549a966') as EbmlNode;
    expect(uintOf(child(info, '2ad7b1') as EbmlNode)).toBe(1_000_000);
    expect(floatOf(child(info, '4489') as EbmlNode)).toBe(600_000);
  });

  it('declares one VP8 video track of the picture size', () => {
    const { segment } = parse(muxWebm([frame(0, true)], { width: 1000, height: 700, durationMs: 1000 }));
    const track = child(child(segment, '1654ae6b') as EbmlNode, 'ae') as EbmlNode;
    expect(textOf(child(track, '86') as EbmlNode)).toBe('V_VP8');
    expect(uintOf(child(track, '83') as EbmlNode)).toBe(1);
    const video = child(track, 'e0') as EbmlNode;
    expect([uintOf(child(video, 'b0') as EbmlNode), uintOf(child(video, 'ba') as EbmlNode)]).toEqual([1000, 700]);
  });

  it('starts a cluster at each key frame and carries every frame as a block with its time relative to the cluster', () => {
    const chunks = [frame(0, true), frame(1000, false), frame(4000, false), frame(10_000, true), frame(10_500, false)];
    const { segment } = parse(muxWebm(chunks, { ...O, durationMs: 11_000 }));
    const clusters = all(segment, '1f43b675');
    expect(clusters.map((c) => uintOf(child(c, 'e7') as EbmlNode))).toEqual([0, 10_000]);
    const blocks = clusters.flatMap((c) => all(c, 'a3').map((b) => ({ cluster: uintOf(child(c, 'e7') as EbmlNode), b })));
    expect(blocks).toHaveLength(5);
    const read = blocks.map(({ cluster, b }) => {
      const view = new DataView(b.bytes.buffer, b.bytes.byteOffset, b.bytes.length);
      expect(b.bytes[0]).toBe(0x81);
      return { ts: cluster + view.getInt16(1, false), key: !!(b.bytes[3] & 0x80), data: [...b.bytes.subarray(4)] };
    });
    expect(read).toEqual(chunks.map((c) => ({ ts: c.ts, key: c.key, data: [...c.data] })));
  });

  it('starts a new cluster after 30 s of delta frames, so a block time stays inside 16 bits', () => {
    const chunks = [frame(0, true), frame(20_000, false), frame(35_000, false), frame(36_000, false), frame(70_000, false)];
    const { segment } = parse(muxWebm(chunks, { ...O, durationMs: 80_000 }));
    const clusters = all(segment, '1f43b675');
    expect(clusters.map((c) => uintOf(child(c, 'e7') as EbmlNode))).toEqual([0, 35_000, 70_000]);
    for (const c of clusters) for (const b of all(c, 'a3')) expect(new DataView(b.bytes.buffer, b.bytes.byteOffset, b.bytes.length).getInt16(1, false)).toBeLessThanOrEqual(WEBM_CLUSTER_MS);
  });

  it('writes one cue per key-frame cluster, at the exact offset of its cluster from the start of the Segment data', () => {
    const chunks = [frame(0, true), frame(5000, false), frame(40_000, false), frame(50_000, true), frame(52_000, false), frame(60_000, true)];
    const { segment } = parse(muxWebm(chunks, { ...O, durationMs: 61_000 }));
    const cues = all(child(segment, '1c53bb6b') as EbmlNode, 'bb').map((p) => ({ time: uintOf(child(p, 'b3') as EbmlNode), pos: uintOf(child(child(p, 'b7') as EbmlNode, 'f1') as EbmlNode) }));
    // The cluster that began only because of the 30 s rule (at 40 s, a delta frame) has no cue: a seek to it could not decode.
    expect(cues.map((c) => c.time)).toEqual([0, 50_000, 60_000]);
    const clusters = all(segment, '1f43b675');
    const byTime = new Map(clusters.map((c) => [uintOf(child(c, 'e7') as EbmlNode), c.at - segment.start]));
    for (const c of cues) expect(c.pos).toBe(byTime.get(c.time));
  });

  it('points the SeekHead at Info, Tracks and Cues by their offsets', () => {
    const { segment } = parse(muxWebm([frame(0, true), frame(1500, false)], O));
    const seeks = all(child(segment, '114d9b74') as EbmlNode, '4dbb').map((s) => ({ id: Buffer.from((child(s, '53ab') as EbmlNode).bytes).toString('hex'), pos: uintOf(child(s, '53ac') as EbmlNode) }));
    expect(seeks.map((s) => s.id)).toEqual(['1549a966', '1654ae6b', '1c53bb6b']);
    for (const s of seeks) expect(segment.children.find((c) => c.id === s.id)?.at).toBe(segment.start + s.pos);
  });

  it('refuses what a file could not hold: no frames, a first frame that is not a key frame, times that go backwards and a duration before the last frame', () => {
    expect(() => muxWebm([], O)).toThrow(/at least one frame/);
    expect(() => muxWebm([frame(0, false)], O)).toThrow(/key frame/);
    expect(() => muxWebm([frame(0, true), frame(2000, false), frame(1000, false)], O)).toThrow(/backwards/);
    expect(() => muxWebm([frame(0, true), frame(5000, false)], { ...O, durationMs: 4000 })).toThrow(/duration/);
    expect(() => muxWebm([frame(0, true)], { ...O, width: 0 })).toThrow(/size/);
  });

  it('holds frames of any size, from one byte to hundreds of kilobytes, in the sizes it declares', () => {
    const big = frame(0, true, 300_000);
    const small = frame(1000, false, 1);
    const { segment } = parse(muxWebm([big, small], O));
    const blocks = all(child(segment, '1f43b675') as EbmlNode, 'a3');
    expect(blocks.map((b) => b.bytes.length - 4)).toEqual([300_000, 1]);
  });
});
