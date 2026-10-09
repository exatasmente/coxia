import { describe, expect, it } from 'vitest';
import { activityOf, allMembers, candidatesFor, eligible, listFor, meetsFloor, pickMember, type MemberFacts, type PoolLists } from '../src/main/engine/open/pool';

const m = (key: string, extra: Partial<MemberFacts> = {}): MemberFacts => ({ key, ...extra });
const A = m('a');
const B = m('b');
const C = m('c');
const need = { activity: 'write' as const, tools: true, tokens: 1000 };

describe('the activity of a turn', () => {
  it('is the most demanding result it answers: screen, then edit, then shell, then explore', () => {
    expect(activityOf(['explore', 'shell'], false)).toBe('shell');
    expect(activityOf(['explore', 'shell', 'edit'], false)).toBe('edit');
    expect(activityOf(['shell', 'edit', 'explore'], false)).toBe('edit');
    expect(activityOf(['explore'], false)).toBe('explore');
    expect(activityOf(['explore', 'screen', 'edit'], false)).toBe('screen');
  });

  it('is screen when any result carried an image, whatever tool made it', () => {
    expect(activityOf(['explore'], true)).toBe('screen');
    expect(activityOf([undefined], true)).toBe('screen');
  });

  it('ignores a tool with no tag, and a turn that answers nothing tagged is write', () => {
    expect(activityOf([undefined, 'explore'], false)).toBe('explore');
    expect(activityOf([undefined], false)).toBe('write');
    expect(activityOf([], false)).toBe('write');
  });
});

describe('the list of an activity', () => {
  const lists: PoolLists<MemberFacts> = { main: [A, B], activities: { shell: [C, A], edit: [] } };

  it('is its own when it has one, else the role\'s', () => {
    expect(listFor(lists, 'shell')).toEqual([C, A]);
    expect(listFor(lists, 'explore')).toEqual([A, B]);
    expect(listFor(lists, 'edit')).toEqual([A, B]);
  });

  it('lists every member once', () => {
    expect(allMembers(lists).map((x) => x.key)).toEqual(['a', 'b', 'c']);
  });
});

describe('who can take a turn', () => {
  it('a screen turn skips a member known not to see, and keeps one that is not known', () => {
    const blind = m('blind', { images: false });
    const sees = m('sees', { images: true });
    const unknown = m('unknown');
    expect(eligible([blind, sees, unknown], { ...need, activity: 'screen' }).map((x) => x.key)).toEqual(['sees', 'unknown']);
    expect(eligible([blind, sees, unknown], { ...need, activity: 'edit' }).map((x) => x.key)).toEqual(['blind', 'sees', 'unknown']);
  });

  it('a session with tools skips a member known not to do them', () => {
    const noTools = m('plain', { tools: false });
    expect(eligible([noTools, A], need).map((x) => x.key)).toEqual(['a']);
    expect(eligible([noTools, A], { ...need, tools: false }).map((x) => x.key)).toEqual(['plain', 'a']);
  });

  it('passes over a window that is known to be too small while another fits, and keeps all when none does', () => {
    const small = m('small', { contextWindow: 8000 });
    const big = m('big', { contextWindow: 128_000 });
    expect(eligible([small, big, A], { ...need, tokens: 20_000 }).map((x) => x.key)).toEqual(['big', 'a']);
    expect(eligible([small], { ...need, tokens: 20_000 }).map((x) => x.key)).toEqual(['small']);
  });

  it('a screen turn in a pool where nobody sees falls back to the role\'s list', () => {
    const lists: PoolLists<MemberFacts> = { main: [m('x', { images: false }), m('y', { images: false })], activities: { screen: [m('z', { images: false })] } };
    expect(candidatesFor(lists, { ...need, activity: 'screen' }).map((x) => x.key)).toEqual(['x', 'y']);
    const seeing: PoolLists<MemberFacts> = { main: [m('x', { images: false })], activities: { screen: [m('z', { images: true })] } };
    expect(candidatesFor(seeing, { ...need, activity: 'screen' }).map((x) => x.key)).toEqual(['z']);
  });
});

describe('who is picked', () => {
  const never = () => false;

  it('stays on the member in use while it is not resting, even when an earlier one is back', () => {
    expect(pickMember([A, B, C], 'b', never)?.key).toBe('b');
  });

  it('starts at the top of the list when nothing is in use', () => {
    expect(pickMember([A, B, C], null, never)?.key).toBe('a');
  });

  it('moves to the first member that is not resting when the one in use rests', () => {
    expect(pickMember([A, B, C], 'b', (k) => k === 'b')?.key).toBe('a');
    expect(pickMember([A, B, C], 'a', (k) => k === 'a' || k === 'b')?.key).toBe('c');
  });

  it('leaves the member in use when the list of the activity does not hold it', () => {
    expect(pickMember([B, C], 'a', never)?.key).toBe('b');
  });

  it('leaves the member in use for the first of the list when it does not fit the turn, and keeps it when it is that first one', () => {
    const fitsNot = (x: MemberFacts) => x.key !== 'b';
    expect(pickMember([A, B, C], 'b', never, fitsNot)?.key).toBe('a');
    expect(pickMember([A, B, C], 'c', never, fitsNot)?.key).toBe('c');
    expect(pickMember([B, A], 'b', never, fitsNot)?.key).toBe('b');
    // The first rests: the next that is not resting, even if the one in use does not fit.
    expect(pickMember([A, B, C], 'b', (k) => k === 'a', fitsNot)?.key).toBe('b');
  });

  it('is null when every member rests', () => {
    expect(pickMember([A, B], 'a', () => true)).toBeNull();
    expect(pickMember([], null, never)).toBeNull();
  });
});

describe('the quality floor of a turn', () => {
  const overrides = { floors: { shell: 90 }, models: { 'model-strong': { shell: 92 }, 'model-weak': { shell: 85 } } };

  it('lets any member keep a turn of an activity without a floor', () => {
    expect(meetsFloor(m('x', { model: 'model-weak' }), 'explore', overrides)).toBe(true);
    expect(meetsFloor(m('x'), 'write')).toBe(true);
  });

  it('asks a score that reaches the floor, from the person or the shipped table; no score is not enough', () => {
    expect(meetsFloor(m('x', { model: 'model-strong' }), 'shell', overrides)).toBe(true);
    expect(meetsFloor(m('x', { model: 'model-weak' }), 'shell', overrides)).toBe(false);
    expect(meetsFloor(m('x', { model: 'model-unknown' }), 'shell', overrides)).toBe(false);
    expect(meetsFloor(m('x'), 'edit')).toBe(false);
    // The shipped table: 90.6 reaches the shipped shell floor of 90, 87.6 does not.
    expect(meetsFloor(m('x', { model: 'deepseek-ai/DeepSeek-V4.1-Flash' }), 'shell')).toBe(true);
    expect(meetsFloor(m('x', { model: 'XiaomiMiMo/MiMo-V2.6-Flash' }), 'shell')).toBe(false);
    expect(meetsFloor(m('x', { model: 'XiaomiMiMo/MiMo-V2.6-Flash' }), 'screen')).toBe(true);
  });
});
