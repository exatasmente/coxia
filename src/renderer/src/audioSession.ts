// WebKit's audio session (Safari 17+). 'playback' keeps speech audible with the iPhone on silent, but forbids
// capture; the microphone needs 'play-and-record' while it is open.
type SessionType = 'playback' | 'play-and-record';

function session(): { type: string } | undefined {
  return (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
}

export function hasAudioSession(): boolean {
  return !!session();
}

export function setAudioSession(type: SessionType): void {
  const s = session();
  if (s && s.type !== type) s.type = type;
}

export function isIos(): boolean {
  // i18n-ignore-next-line: user agent token
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
}
