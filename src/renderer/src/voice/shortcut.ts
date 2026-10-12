// Ctrl+Shift+M (Cmd+Shift+M on a Mac) toggles voice mode. Pure on purpose: the hook passes the key event and whether this is a paired browser, where the
// shortcut is not bound (like the prompt editor's).

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

export function isVoiceShortcut(e: KeyLike, web: boolean): boolean {
  return !web && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && !e.repeat && e.code === 'KeyM';
}
