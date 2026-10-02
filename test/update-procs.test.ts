import { describe, expect, it } from 'vitest';
import { ownedDescendants, parseStat } from '../src/main/update-core';

describe('parseStat', () => {
  it('reads pid and parent', () => {
    expect(parseStat('4321 (cerimonias) S 4300 4321 4321 0 -1 4194560')).toEqual({ pid: 4321, ppid: 4300 });
  });

  it('survives a command name with spaces and parentheses', () => {
    expect(parseStat('77 (Web (Content) x) R 12 77 77 0 -1 0')).toEqual({ pid: 77, ppid: 12 });
  });

  it('is null for anything else', () => {
    expect(parseStat('')).toBeNull();
    expect(parseStat('not a stat line')).toBeNull();
  });
});

describe('ownedDescendants', () => {
  const procs = [
    { pid: 100, ppid: 1, cmd: '/tmp/.mount_x/cerimonias --user-data-dir=/d' },
    { pid: 101, ppid: 100, cmd: '/tmp/.mount_x/cerimonias --type=zygote' },
    { pid: 102, ppid: 101, cmd: '/tmp/.mount_x/cerimonias --type=renderer' },
    { pid: 103, ppid: 100, cmd: '/tmp/.mount_x/cerimonias --type=gpu-process --ozone-platform=x11' },
    { pid: 110, ppid: 100, cmd: 'python3 /home/u/.local/bin/daily-report report --format json --dry-run' },
    { pid: 111, ppid: 100, cmd: 'fetch --quiet origin' },
    { pid: 112, ppid: 111, cmd: 'remote-https origin https://example/x.git' },
    { pid: 120, ppid: 100, cmd: '/home/u/.config/cerimonias/voice-venv/bin/python /tmp/.mount_x/resources/sidecar/voice_sidecar.py' },
    { pid: 200, ppid: 1, cmd: 'bash unrelated' },
    { pid: 201, ppid: 200, cmd: 'sleep 1' },
  ];

  it('picks what the app started, with everything they started, and not Chromium helpers', () => {
    expect(ownedDescendants(procs, 100).sort((a, b) => a - b)).toEqual([110, 111, 112, 120]);
  });

  it('is empty when the app has no children of its own', () => {
    expect(ownedDescendants(procs.slice(0, 4), 100)).toEqual([]);
    expect(ownedDescendants(procs, 999)).toEqual([]);
  });
});
