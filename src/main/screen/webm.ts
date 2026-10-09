// The WebM muxer of the screen recording: pure Node, no dependency. The encoder in the helper window gives VP8 frames with the time each one was fed; this puts them in
// a file a player can seek in: an EBML header, one Segment (a SeekHead, Info with the Duration, Tracks with one V_VP8 track, Clusters of SimpleBlocks, Cues). Every size
// is written exactly, nothing is "unknown", so the Duration holds a still stretch between two frames and the player's timeline is the stage's time.

/** One encoded frame: its time in ms from the start of the recording, whether it is a key frame, and the VP8 bytes. */
export interface WebmChunk {
  ts: number;
  key: boolean;
  data: Uint8Array;
}

export interface WebmOptions {
  width: number;
  height: number;
  /** The recorded time in ms, including the stretch after the last frame. */
  durationMs: number;
}

/** A cluster holds at most this much time: block timecodes are 16-bit, relative to the cluster's. */
export const WEBM_CLUSTER_MS = 30_000;

const ID = {
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  version: [0x42, 0x86],
  readVersion: [0x42, 0xf7],
  maxIdLength: [0x42, 0xf2],
  maxSizeLength: [0x42, 0xf3],
  docType: [0x42, 0x82],
  docTypeVersion: [0x42, 0x87],
  docTypeReadVersion: [0x42, 0x85],
  segment: [0x18, 0x53, 0x80, 0x67],
  seekHead: [0x11, 0x4d, 0x9b, 0x74],
  seek: [0x4d, 0xbb],
  seekId: [0x53, 0xab],
  seekPosition: [0x53, 0xac],
  info: [0x15, 0x49, 0xa9, 0x66],
  timecodeScale: [0x2a, 0xd7, 0xb1],
  muxingApp: [0x4d, 0x80],
  writingApp: [0x57, 0x41],
  duration: [0x44, 0x89],
  tracks: [0x16, 0x54, 0xae, 0x6b],
  trackEntry: [0xae],
  trackNumber: [0xd7],
  trackUid: [0x73, 0xc5],
  trackType: [0x83],
  flagLacing: [0x9c],
  codecId: [0x86],
  video: [0xe0],
  pixelWidth: [0xb0],
  pixelHeight: [0xba],
  cluster: [0x1f, 0x43, 0xb6, 0x75],
  timecode: [0xe7],
  simpleBlock: [0xa3],
  cues: [0x1c, 0x53, 0xbb, 0x6b],
  cuePoint: [0xbb],
  cueTime: [0xb3],
  cueTrackPositions: [0xb7],
  cueTrack: [0xf7],
  cueClusterPosition: [0xf1],
};

/** The size of an element as an EBML variable-length integer, in the fewest bytes (1 to 8). */
export function ebmlSize(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 2 ** 53 - 1) throw new RangeError(`EBML size out of range: ${n}`);
  for (let len = 1; len <= 8; len++) {
    // The all-ones value of each length is reserved for "unknown size".
    if (n <= 2 ** (7 * len) - 2) {
      const out = new Uint8Array(len);
      let rest = n;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = rest % 256;
        rest = Math.floor(rest / 256);
      }
      out[0] |= 0x80 >> (len - 1);
      return out;
    }
  }
  throw new RangeError(`EBML size out of range: ${n}`);
}

/** An unsigned integer in the fewest bytes, or in `width` bytes when given. */
function uint(n: number, width = 0): Uint8Array {
  let len = Math.max(1, width);
  if (!width) while (len < 8 && n >= 2 ** (8 * len)) len++;
  const out = new Uint8Array(len);
  let rest = n;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return out;
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const element = (id: readonly number[], ...payload: Uint8Array[]): Uint8Array => {
  const body = concat(payload);
  return concat([Uint8Array.from(id), ebmlSize(body.length), body]);
};

const uintEl = (id: readonly number[], n: number, width = 0): Uint8Array => element(id, uint(n, width));
const text = (id: readonly number[], s: string): Uint8Array => element(id, Uint8Array.from(Buffer.from(s, 'ascii')));
const float64 = (id: readonly number[], n: number): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n, false);
  return element(id, b);
};

/** A Seek entry with a fixed-width position, so the SeekHead's own size does not depend on where things land. */
const seek = (id: readonly number[], position: number): Uint8Array => element(ID.seek, element(ID.seekId, Uint8Array.from(id)), uintEl(ID.seekPosition, position, 4));

interface Group {
  start: number;
  key: boolean;
  blocks: Uint8Array[];
}

/**
 * The file for a list of encoded frames. Refuses an empty list, a first frame that is not a key frame, times that go backwards and a duration shorter than the last
 * frame's time: those are mistakes of the caller, not something a file could hold.
 */
export function muxWebm(chunks: readonly WebmChunk[], o: WebmOptions): Uint8Array {
  if (chunks.length === 0) throw new RangeError('a recording needs at least one frame');
  if (!chunks[0].key) throw new RangeError('the first frame must be a key frame');
  if (!Number.isInteger(o.width) || !Number.isInteger(o.height) || o.width < 1 || o.height < 1) throw new RangeError('the picture needs a size');
  let previous = -1;
  for (const c of chunks) {
    if (!Number.isInteger(c.ts) || c.ts < 0 || c.ts < previous) throw new RangeError('frame times must not go backwards');
    previous = c.ts;
  }
  if (!Number.isFinite(o.durationMs) || o.durationMs < previous) throw new RangeError('the duration is shorter than the last frame');

  // Clusters: one at each key frame (so every cluster can be sought to), and one more when a stretch of delta frames would overflow the 16-bit block timecode.
  const groups: Group[] = [];
  for (const c of chunks) {
    let g = groups[groups.length - 1];
    if (!g || c.key || c.ts - g.start > WEBM_CLUSTER_MS) {
      g = { start: c.ts, key: c.key, blocks: [] };
      groups.push(g);
    }
    const rel = uint(c.ts - g.start, 2);
    g.blocks.push(element(ID.simpleBlock, Uint8Array.from([0x81]), rel, Uint8Array.from([c.key ? 0x80 : 0x00]), c.data));
  }
  const clusters = groups.map((g) => element(ID.cluster, uintEl(ID.timecode, g.start), ...g.blocks));

  const info = element(ID.info, uintEl(ID.timecodeScale, 1_000_000), text(ID.muxingApp, 'coxia'), text(ID.writingApp, 'coxia'), float64(ID.duration, o.durationMs));
  const tracks = element(
    ID.tracks,
    element(ID.trackEntry, uintEl(ID.trackNumber, 1), uintEl(ID.trackUid, 1), uintEl(ID.trackType, 1), uintEl(ID.flagLacing, 0), text(ID.codecId, 'V_VP8'), element(ID.video, uintEl(ID.pixelWidth, o.width), uintEl(ID.pixelHeight, o.height))),
  );

  // Positions are from the start of the Segment's data. The SeekHead has a fixed size (three entries of fixed width), so it can be laid out first.
  const seekHeadSize = seekHeadOf(0, 0, 0).length;
  const infoAt = seekHeadSize;
  const tracksAt = infoAt + info.length;
  let at = tracksAt + tracks.length;
  const cuePoints: Uint8Array[] = [];
  groups.forEach((g, i) => {
    if (g.key) cuePoints.push(element(ID.cuePoint, uintEl(ID.cueTime, g.start), element(ID.cueTrackPositions, uintEl(ID.cueTrack, 1), uintEl(ID.cueClusterPosition, at))));
    at += clusters[i].length;
  });
  const cuesAt = at;
  const cues = element(ID.cues, ...cuePoints);

  const header = element(ID.ebml, uintEl(ID.version, 1), uintEl(ID.readVersion, 1), uintEl(ID.maxIdLength, 4), uintEl(ID.maxSizeLength, 8), text(ID.docType, 'webm'), uintEl(ID.docTypeVersion, 4), uintEl(ID.docTypeReadVersion, 2));
  const segment = element(ID.segment, seekHeadOf(infoAt, tracksAt, cuesAt), info, tracks, ...clusters, cues);
  return concat([header, segment]);
}

function seekHeadOf(info: number, tracks: number, cues: number): Uint8Array {
  return element(ID.seekHead, seek(ID.info, info), seek(ID.tracks, tracks), seek(ID.cues, cues));
}

/** What the container adds to the frames' bytes, at most: a bound for the recorder's reserve. */
export const webmOverheadOf = (frames: number): number => 1024 + frames * 24;
