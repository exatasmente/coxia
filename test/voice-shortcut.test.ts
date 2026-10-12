// The voice mode shortcut: Ctrl+Shift+M (Cmd+Shift+M on a Mac), not held down, not with Alt, and not bound in a paired browser.
import { describe, expect, it } from 'vitest';
import { type KeyLike, isVoiceShortcut } from '../src/renderer/src/voice/shortcut';

const key = (over: Partial<KeyLike> = {}): KeyLike => ({ code: 'KeyM', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, repeat: false, ...over });

describe('isVoiceShortcut', () => {
  it('takes Ctrl+Shift+M and Cmd+Shift+M', () => {
    expect(isVoiceShortcut(key(), false)).toBe(true);
    expect(isVoiceShortcut(key({ ctrlKey: false, metaKey: true }), false)).toBe(true);
  });

  it('ignores a held key, Alt, a missing modifier and another key', () => {
    expect(isVoiceShortcut(key({ repeat: true }), false)).toBe(false);
    expect(isVoiceShortcut(key({ altKey: true }), false)).toBe(false);
    expect(isVoiceShortcut(key({ shiftKey: false }), false)).toBe(false);
    expect(isVoiceShortcut(key({ ctrlKey: false }), false)).toBe(false);
    expect(isVoiceShortcut(key({ code: 'KeyI' }), false)).toBe(false);
  });

  it('is not bound in a paired browser', () => {
    expect(isVoiceShortcut(key(), true)).toBe(false);
  });
});
