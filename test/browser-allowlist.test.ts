import { describe, expect, it } from 'vitest';
import { EXPOSED_TOOLS, checkArguments, exposedTool, isRef, jsonSchemaOf, toolsFor } from '../src/main/browser/allowlist';

describe('what the app checks of a call before the browser sees it', () => {
  it('takes a ref and nothing else as a target', () => {
    for (const ok of ['e7', 'e123', 'f1e3', 'f12e9']) expect(isRef(ok), ok).toBe(true);
    for (const bad of ['button:has-text("Delete")', '#id', 'e', 'E7', 'e7 ', 'f1', '', 'e7; drop', 7, null]) expect(isRef(bad), String(bad)).toBe(false);
    expect(checkArguments('browser_click', { target: 'button:has-text("Delete")' })).toEqual({ ok: false, problem: { code: 'not-a-ref', name: 'target' } });
    expect(checkArguments('browser_click', { target: 'e7' })).toEqual({ ok: true, forward: { target: 'e7' } });
    expect(checkArguments('browser_drag', { startTarget: 'e1', endTarget: '.drop' })).toMatchObject({ ok: false, problem: { code: 'not-a-ref', name: 'endTarget' } });
    expect(checkArguments('browser_fill_form', { fields: [{ target: 'input', name: 'a', type: 'textbox', value: 'x' }] })).toMatchObject({ ok: false, problem: { code: 'not-a-ref' } });
  });

  it('refuses a property the schema does not have, and one that is missing, mistyped or too big', () => {
    expect(checkArguments('browser_navigate', { url: 'https://example.com/', filename: 'x' })).toEqual({ ok: false, problem: { code: 'unknown-property', name: 'filename' } });
    expect(checkArguments('browser_navigate', {})).toEqual({ ok: false, problem: { code: 'missing', name: 'url' } });
    expect(checkArguments('browser_navigate', { url: 5 })).toEqual({ ok: false, problem: { code: 'type', name: 'url' } });
    expect(checkArguments('browser_navigate', { url: `https://example.com/${'a'.repeat(3000)}` })).toEqual({ ok: false, problem: { code: 'size', name: 'url' } });
    expect(checkArguments('browser_wait_for', { time: 31 })).toEqual({ ok: false, problem: { code: 'range', name: 'time' } });
    expect(checkArguments('browser_tabs', { action: 'drop' })).toEqual({ ok: false, problem: { code: 'enum', name: 'action' } });
    expect(checkArguments('browser_tabs', { action: 'select', index: 1.5 })).toEqual({ ok: false, problem: { code: 'type', name: 'index' } });
    expect(checkArguments('browser_fill_form', { fields: [{ target: 'e1', name: 'a', type: 'textbox', value: 'x', extra: 1 }] })).toEqual({ ok: false, problem: { code: 'unknown-property', name: 'fields[0].extra' } });
    expect(checkArguments('browser_fill_form', { fields: [{ target: 'e1', name: 'a', type: 'textbox' }] })).toEqual({ ok: false, problem: { code: 'missing', name: 'fields[0].value' } });
    expect(checkArguments('browser_evaluate', { function: 'x' })).toEqual({ ok: false, problem: { code: 'unknown-tool' } });
    expect(checkArguments('browser_snapshot', 'text')).toEqual({ ok: false, problem: { code: 'not-object' } });
    expect(checkArguments('browser_snapshot', undefined)).toEqual({ ok: true, forward: {} });
  });

  it('keeps the reason for itself: it is read, never forwarded', () => {
    expect(checkArguments('browser_click', { target: 'e2', element: 'Next', reason: 'to see the next page' })).toEqual({ ok: true, forward: { target: 'e2', element: 'Next' }, reason: 'to see the next page' });
    expect(checkArguments('browser_click', { target: 'e2', reason: 'x'.repeat(201) })).toEqual({ ok: false, problem: { code: 'size', name: 'reason' } });
    // Only the tools that change something carry one.
    expect(checkArguments('browser_snapshot', { reason: 'why' })).toEqual({ ok: false, problem: { code: 'unknown-property', name: 'reason' } });
    expect(exposedTool('browser_click')?.kind).toBe('act');
    expect(exposedTool('browser_snapshot')?.kind).toBe('read');
  });

  it('writes the schema a model reads without the app\'s own markers, and offers a picture tool only where pictures are taken', () => {
    const schema = jsonSchemaOf(exposedTool('browser_click') as never);
    expect(schema.required).toEqual(['target']);
    expect(schema.additionalProperties).toBe(false);
    expect(JSON.stringify(schema)).not.toContain('appOnly');
    expect(schema.properties.reason).toBeDefined();
    expect(toolsFor(false).map((t) => t.name)).not.toContain('browser_take_screenshot');
    expect(toolsFor(true).map((t) => t.name)).toContain('browser_take_screenshot');
    expect(toolsFor(true)).toHaveLength(EXPOSED_TOOLS.length);
  });
});
