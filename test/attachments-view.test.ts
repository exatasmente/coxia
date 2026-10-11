// What the thread screen shows about the files a person attached: the box takes them, the message shows them in every conversation, and the
// warning that what an agent reads leaves the computer is there once. The checks read the source and the catalogs, because the app cannot be
// mounted in a test.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatBytes, kindLabelKey } from '../src/shared/attachments';

const root = join(__dirname, '..');
const thread = readFileSync(join(root, 'src/renderer/src/screens/cycle/Thread.tsx'), 'utf8');
// The box a person writes in lives in its own file, shared by the run thread, the conversations and the persona's chat.
const composer = readFileSync(join(root, 'src/renderer/src/screens/cycle/Composer.tsx'), 'utf8');
const view = readFileSync(join(root, 'src/renderer/src/screens/cycle/Attachments.tsx'), 'utf8');
const catalogs = ['en', 'pt-BR'].map((l) => readFileSync(join(root, `src/shared/i18n/ui-cycle.${l}.json`), 'utf8'));

describe('the box a person writes in', () => {
  it('takes files by a button, by drag and drop and by paste', () => {
    expect(composer).toContain('ui.forum.file.attach');
    expect(composer).toContain('onDrop');
    expect(composer).toContain('onDragOver');
    expect(composer).toContain('onPaste');
    expect(composer).toContain('type="file"');
  });

  it('shows each file with its name and size before sending, and lets it be removed', () => {
    expect(composer).toContain('PendingFiles');
    expect(composer).toContain('formatBytes');
    expect(composer).toContain('ui.forum.file.remove');
    expect(composer).toContain('ui.forum.file.pending');
  });

  it('sends the bytes first, then the message, and keeps nothing of a file it removed', () => {
    // the files wait in the box and are uploaded only when the message is sent: a file taken out was never stored
    expect(composer).toContain('forumApi.attachmentPut');
    expect(composer).toContain('forumApi.attachmentPost');
    expect(composer).toContain('forumApi.post');
    expect(composer).toContain('removeFile');
  });

  it('warns once that what an agent reads leaves the computer', () => {
    expect(composer).toContain('main.attachment.notice');
  });

  it('is the one box of the thread, and of the persona\'s chat', () => {
    expect(thread).toContain("from './Composer'");
    expect(thread).not.toContain('forumApi.attachmentPut');
    expect(readFileSync(join(root, 'src/renderer/src/screens/persona/ChatThread.tsx'), 'utf8')).toContain("from '../cycle/Composer'");
  });
});

describe('the files of a message', () => {
  it('are shown in every conversation, not only a run thread', () => {
    // the documents of a run keep their guard; the attachments of a person do not
    expect(thread).toContain('MessageAttachments');
    expect(thread).toMatch(/MessageAttachments[\s\S]*m\.attachments/);
    expect(thread).not.toMatch(/m\.attachments[\s\S]{0,80}ctx\.runId/);
  });

  it('show an image as a thumbnail and any other file as a card that opens or saves', () => {
    expect(view).toContain('ImageThumb');
    expect(view).toContain('ui.forum.file.open');
    expect(view).toContain('ui.forum.file.save');
    expect(view).toContain('ui.forum.file.kind');
  });
});

describe('the words and the values the screen uses', () => {
  it('defines every new key in both catalogs', () => {
    const keys = [
      'ui.forum.file.attach',
      'ui.forum.file.pending',
      'ui.forum.file.remove',
      'ui.forum.file.removeLabel',
      'ui.forum.file.open',
      'ui.forum.file.save',
      'ui.forum.file.image',
      'ui.forum.file.list',
      'ui.forum.file.openImage',
      'ui.forum.file.kind.image',
      'ui.forum.file.kind.text',
      'ui.forum.file.kind.pdf',
      'ui.forum.file.kind.json',
      'ui.forum.file.kind.csv',
    ];
    for (const catalog of catalogs) for (const key of keys) expect(catalog, key).toContain(`"${key}"`);
  });

  it('labels a kind through a key that exists', () => {
    for (const kind of ['image', 'text', 'pdf', 'json', 'csv'] as const) {
      const key = kindLabelKey(kind);
      expect(key).toBe(`main.attachment.kind.${kind}`);
    }
  });

  it('shows a size a person reads', () => {
    expect(formatBytes(2048)).toBe('2.0 kB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
