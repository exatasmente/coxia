import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The screens are not drawn by any test, so what the layout leans on is kept by reading the sources.
const src = join(import.meta.dirname, '../src/renderer/src');
const read = (file: string): string => readFileSync(join(src, file), 'utf8');

describe('the ceremony bar on a phone', () => {
  const css = read('screens/persona/chat.css');
  const phone = css.slice(css.indexOf('@media (max-width: 600px)'));

  it('keeps the progress, announces it, and gives the cut text a title', () => {
    const screen = read('screens/persona/ChatScreen.tsx');
    expect(screen).toMatch(/className="chat-cer-progress" aria-live="polite"/);
    for (const part of ['chat-cer-title', 'chat-cer-progress', 'chat-cer-detail']) expect(screen, part).toMatch(new RegExp(`className="${part}"[^>]*title=`));
    expect(phone).toMatch(/\.chat-cer-detail \{ display: none; \}/);
    expect(phone).not.toMatch(/\.chat-cer-progress \{[^}]*display: none/);
  });
});

describe('the sidebar of the computer', () => {
  const shell = read('screens/persona/HomeShell.tsx');

  it('toggles by aria-expanded under a label that does not change, and names its landmark', () => {
    expect(shell).toMatch(/aria-expanded=\{!folded\}/);
    expect(shell).not.toMatch(/aria-pressed/);
    expect(shell).toMatch(/aria-label=\{t\('ui\.chat\.nav\.toggle'\)\}/);
    expect(shell).toMatch(/<aside className="home-side" aria-label=\{t\('ui\.chat\.nav\.sidebar'\)\}/);
  });

  it('writes the choice from the handler, not from inside a state updater', () => {
    expect(shell).not.toMatch(/setFolded\(\(/);
    expect(shell).toMatch(/const next = !folded;\s+setFolded\(next\);\s+writeFolded\(next\);/);
  });
});

describe('the hint of the inline box', () => {
  it('is in the box\'s tooltip and shown to sighted people while the box has the focus, still read by a screen reader', () => {
    const composer = read('screens/cycle/Composer.tsx');
    expect(composer).toMatch(/title=\{inline \? \(hint \?\? t\('ui\.forum\.sendHint'\)\) : undefined\}/);
    expect(composer).toMatch(/<span id=\{hintId\} className="cy-inline-hint">/);
    expect(composer).not.toMatch(/id=\{hintId\} className="sr-only"/);
    const css = read('screens/persona/chat.css');
    expect(css).toMatch(/\.cy-composer:focus-within \.cy-inline-hint \{[^}]*position: static/);
    // the persona's chat gives the line that names Enter and Shift+Enter, in both catalogs
    expect(read('screens/persona/ChatThread.tsx')).toMatch(/ui\.chat\.hint\.desktop/);
  });
});

describe('where the navigation is mounted', () => {
  it('puts the chat and the Overview inside the sidebar frame', () => {
    expect(read('screens/persona/ChatScreen.tsx')).toContain('<HomeShell ');
    expect(read('screens/Overview.tsx')).toContain('<HomeShell ');
  });

  it('gives the phone the same navigation as a sheet of the header, and draws it in no other place', () => {
    expect(read('screens/persona/ChatHeader.tsx')).toContain('<HomeNav ');
    expect(read('screens/persona/HomeShell.tsx')).toContain('<HomeNav ');
  });
});
