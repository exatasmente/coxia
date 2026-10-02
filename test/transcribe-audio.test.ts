import { describe, expect, it, vi } from 'vitest';

const transcribe = vi.fn(async () => 'o merdi passou');
vi.mock('../src/renderer/src/api', () => ({ api: { transcribe } }));

describe('transcribeAudio', () => {
  it('asks the main process once and returns its text', async () => {
    const { transcribeAudio } = await import('../src/renderer/src/audio');
    await expect(transcribeAudio(new ArrayBuffer(4))).resolves.toBe('o merdi passou');
    expect(transcribe).toHaveBeenCalledTimes(1);
  });
});

describe('recordingExtension', () => {
  const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

  it('names the file after the container the browser recorded', async () => {
    const { recordingExtension } = await import('../src/main/voice');
    expect(recordingExtension(bytes('\u0000\u0000\u0000\u0018ftypmp42'))).toBe('mp4');
    expect(recordingExtension(bytes('OggS\u0000\u0002'))).toBe('ogg');
    expect(recordingExtension(bytes('\u001aEß£webm'))).toBe('webm');
    expect(recordingExtension(new ArrayBuffer(0))).toBe('webm');
  });
});
