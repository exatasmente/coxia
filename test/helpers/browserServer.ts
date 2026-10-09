import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROBE_FOCUS_FN } from '../../src/main/browser/probe';
import { McpError } from '../../src/main/browser/mcpClient';

// A scripted Playwright MCP server for the tests of the intermediary: it answers from the recording of a page (test/fixtures/browser), so what the app reads of the page is
// what the pinned server really said. No browser, no network.

const DIR = join(import.meta.dirname, '..', 'fixtures', 'browser');
export const formSnapshot = readFileSync(join(DIR, 'form.snapshot.txt'), 'utf8');
export const recorded = JSON.parse(readFileSync(join(DIR, 'probes.json'), 'utf8')) as { probes: Record<string, string>; focused: Record<string, { snapshot: string; probe: string }> };

export interface Call {
  name: string;
  args: Record<string, unknown>;
}

/** A server that answers from the recorded page. `acts` are the calls that reached the browser as something other than a read. */
export function fakeServer() {
  const calls: Call[] = [];
  const state = {
    snapshot: formSnapshot,
    focus: 'name',
    actText: '### Page\n- Page URL: https://example.com/\n- Page Title: Account settings',
    fail: null as null | 'timeout' | 'throw' | 'isError',
    image: null as null | string,
    onAct: null as null | (() => void),
    probes: recorded.probes,
  };
  const client = {
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const text = (t: string, isError?: boolean) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
      if (name === 'browser_snapshot') return text(state.snapshot);
      if (name === 'browser_evaluate') {
        if (args.function === PROBE_FOCUS_FN) return text(recorded.focused[state.focus].probe);
        const raw = Object.entries(state.probes).find(([k]) => k.startsWith(`${String(args.target)} `))?.[1];
        return raw ? text(raw) : text('### Error\nnot found', true);
      }
      if (state.fail === 'timeout') throw new McpError('timeout', 'slow');
      if (state.fail === 'throw') throw new Error('boom');
      if (state.fail === 'isError') return text('### Error\nElement is not visible', true);
      state.onAct?.();
      if (name === 'browser_take_screenshot') return { content: [{ type: 'text', text: '[Screenshot of viewport](/data/sandbox/abc/out/page-1.png)' }, { type: 'image', data: state.image ?? 'aGVsbG8=', mimeType: 'image/png' }] };
      if (name === 'browser_find') return text('### Matches\n- button "Send" [ref=e15]');
      return text(state.actText);
    },
  };
  const acts = (): Call[] => calls.filter((c) => c.name !== 'browser_snapshot' && c.name !== 'browser_evaluate');
  return { client, calls, state, acts };
}

