// What the thread screen says: the call label only for what a person wrote and only for the agents really called, the ones over the limit named as not called,
// and no note saying that a channel does not call an agent.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const screen = readFileSync(join(__dirname, '..', 'src/renderer/src/screens/cycle/Thread.tsx'), 'utf8');
const catalogs = ['en', 'pt-BR'].map((l) => readFileSync(join(__dirname, '..', `src/shared/i18n/ui-cycle.${l}.json`), 'utf8'));

describe('the thread screen and its words', () => {
  it('shows the call label only for a person post, and names the ones over the limit apart', () => {
    expect(screen).toContain("m.author.type === 'person' && m.mentions.length > 0");
    expect(screen).toContain('ui.forum.mentionsOverLimit');
    expect(screen).toContain('MAX_MENTIONS');
  });

  it('no longer decides the note by a channel, and the channel note is gone from both catalogs', () => {
    expect(screen).not.toContain('noteChannel');
    expect(screen).not.toContain('channel ?');
    for (const catalog of catalogs) expect(catalog).not.toContain('ui.forum.noteChannel');
    for (const catalog of catalogs) expect(catalog).toContain('ui.forum.mentionsOverLimit');
  });
});
