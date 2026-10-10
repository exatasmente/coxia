import { describe, expect, it } from 'vitest';
import { mentionCall, type MentionInput } from '../src/main/mentions/call';
import { refsInMessage } from '../src/main/mentions/module';
import { neutralConfig } from '../src/shared/config';
import { applyTemplate, agentFlowEngineering } from '../src/shared/cycles';
import type { ForumMessage } from '../src/shared/forum';

// What a call reads of the record of the activities: it is text of the prompt, it names the activity the message asked about, and it never opens the file
// to a tool of the call. The call is built here whole: no model, no code host, no network.

const config = () => applyTemplate(neutralConfig(), agentFlowEngineering);

const message = (text: string): ForumMessage =>
  ({ seq: 1, thread: 'general-1', kind: 'post', author: { type: 'person' }, text, mentions: ['qa'], attachments: [], waitsForAnswer: false, public: true, anchor: null, at: '2026-10-03T10:00:00.000Z' }) as unknown as ForumMessage;

function input(over: Partial<MentionInput> = {}): MentionInput {
  return {
    agent: config().agents.team.find((a) => a.id === 'qa')!,
    config: config(),
    message: message('What is happening with #101?'),
    thread: [],
    files: [],
    cwd: '/tmp/coxia-test',
    place: 'general',
    repos: [],
    ...over,
  };
}

describe('what a mention is told', () => {
  it('puts the record of the activities in a section of its own, marked as material and not instruction', () => {
    const call = mentionCall(input({ memory: 'app#101 Add the thing\nStage: Refinement' }));
    expect(call.prompt).toContain('app#101 Add the thing');
    expect(call.prompt).toContain('<data>');
    expect(call.prompt).toMatch(/material/);
  });

  it('leaves the call without the section when the record has nothing to say', () => {
    expect(mentionCall(input({ memory: '' })).prompt).not.toContain('app#101');
  });

  it('never offers the record as a tool or as a folder: the section is text and the call keeps the tools of today', () => {
    const call = mentionCall(input({ memory: 'app#101 Add the thing' }));
    expect(call.runnerTools).toBeUndefined();
    expect(call.confine).toBeUndefined();
    expect(call.docs).toBeUndefined();
  });
});

describe('the takes of an activity a message carries', () => {
  it('reads the number a person writes, with or without its reference, and nothing else', () => {
    expect(refsInMessage(message('What is happening with #101?'))).toEqual(['101']);
    expect(refsInMessage(message('see group/project#202 and #303'))).toEqual(['group/project#202', '303']);
    expect(refsInMessage(message('no reference here'))).toEqual([]);
  });
});
