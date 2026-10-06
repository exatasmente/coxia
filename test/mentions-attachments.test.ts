// What an agent called in a conversation is told about the files the message carries: id, name, kind and size (never a path), and the ref the read-only
// tool takes. The tool itself is exercised in attachments-tool.test.ts; here it is the warning in the call that is checked.
import { describe, expect, it } from 'vitest';
import { attachmentsSection, mentionCall } from '../src/main/mentions/call';
import type { AttachmentRef } from '../src/shared/attachments';
import { type ForumMessage } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import { hostConfig } from './helpers/config';

const refs: AttachmentRef[] = [
  { id: 'aaaaaaaaaaaaaaaa', name: 'shot.png', kind: 'image', bytes: 2048 },
  { id: 'bbbbbbbbbbbbbbbb', name: 'trace.log', kind: 'text', bytes: 300 },
];

const message = (extra: Partial<ForumMessage> = {}): ForumMessage => ({
  v: 1,
  type: 'message',
  seq: 3,
  thread: 'run-r-one',
  at: '2026-10-03T10:00:00.000Z',
  kind: 'post',
  author: { type: 'person' },
  text: '@turn look at this',
  code: null,
  params: {},
  mentions: ['turn'],
  refs: [],
  attachments: refs,
  stage: null,
  to: null,
  replyTo: null,
  public: false,
  published: null,
  ...extra,
});

describe('the files a message carries, as the calling agent reads them', () => {
  it('names each file by id, name, kind and size, and never a path', () => {
    setLanguage('en');
    const section = attachmentsSection(refs);
    expect(section).toContain('aaaaaaaaaaaaaaaa');
    expect(section).toContain('shot.png');
    expect(section).toContain('2.0 kB');
    expect(section).toContain('bbbbbbbbbbbbbbbb');
    expect(section).toContain('trace.log');
    expect(section).not.toMatch(/\/tmp\/|\\|\/home\//);
  });

  it('is empty when the message carries nothing', () => {
    expect(attachmentsSection([])).toBe('');
  });

  it('enters the prompt of the call, with the tool the agent opens them with', () => {
    setLanguage('en');
    const config = hostConfig(null);
    const call = mentionCall({ agent: config.agents.team[0], config, message: message(), thread: [message()], files: [], cwd: '/tmp', place: 'run', attachments: { thread: 'run-r-one', refs } });
    expect(call.prompt).toContain('ConversationAttachment');
    expect(call.prompt).toContain('shot.png');
    expect(call.attachments).toEqual({ thread: 'run-r-one', refs });
  });

  it('leaves the tool out of a call whose message carries no files', () => {
    setLanguage('en');
    const config = hostConfig(null);
    const call = mentionCall({ agent: config.agents.team[0], config, message: message({ attachments: [] }), thread: [], files: [], cwd: '/tmp', place: 'general' });
    expect(call.prompt).not.toContain('ConversationAttachment');
    expect(call.attachments).toBeUndefined();
  });
});
