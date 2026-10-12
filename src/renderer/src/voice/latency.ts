// The delay of a spoken turn, from the end of the person's speech to the first word of the answer, split by step. Pure on purpose: the hook stamps the marks
// (performance.now) and logs the result; a step whose mark is missing has no duration instead of a NaN.

export interface TurnMarks {
  speechEnd?: number;
  transcribed?: number;
  posted?: number;
  firstText?: number;
  firstAudio?: number;
}

export interface TurnLatency {
  transcribe: number | null;
  post: number | null;
  firstText: number | null;
  firstAudio: number | null;
  /** End of speech to the first word played: what the 3 s target is about. */
  total: number | null;
}

const span = (from: number | undefined, to: number | undefined): number | null =>
  from === undefined || to === undefined || !Number.isFinite(from) || !Number.isFinite(to) ? null : Math.max(0, Math.round(to - from));

export function turnLatency(m: TurnMarks): TurnLatency {
  return {
    transcribe: span(m.speechEnd, m.transcribed),
    post: span(m.transcribed, m.posted),
    firstText: span(m.posted, m.firstText),
    firstAudio: span(m.firstText, m.firstAudio),
    total: span(m.speechEnd, m.firstAudio),
  };
}

/** One line for the log: every step in milliseconds, "-" for a missing one. */
export function latencyLine(l: TurnLatency): string {
  const v = (n: number | null) => (n === null ? '-' : String(n));
  // i18n-ignore-next-line: developer log line, read in the console, not by the person
  return `voice turn latency ms: total=${v(l.total)} transcribe=${v(l.transcribe)} post=${v(l.post)} firstText=${v(l.firstText)} firstAudio=${v(l.firstAudio)}`;
}
