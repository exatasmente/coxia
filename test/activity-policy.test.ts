import { describe, expect, it, vi } from 'vitest';
import { ACTIVITY_EVENT, ACTIVITY_GET } from '../src/shared/activity';
import { WEB_EDITABLE } from '../src/main/configScope';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess } from '../src/main/webPolicy';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {} }));

// The paired phone shows the same activity as the window, from the same stream: what it may see is decided in the main log (masking, the reasoning switch), not here.

describe('the activity on a paired phone', () => {
  it('reads the backfill like the window does, and the channel is neither desktop-only nor an external effect', () => {
    expect(webAccess(ACTIVITY_GET)).toBe('allow');
    expect(DESKTOP_ONLY.has(ACTIVITY_GET)).toBe(false);
    expect(EXTERNAL_EFFECT.has(ACTIVITY_GET)).toBe(false);
    expect(ACTIVITY_EVENT).toBe('agent:activity');
  });

  it('may change the reasoning switch (the path is in the list of what a paired browser edits)', () => {
    expect(WEB_EDITABLE).toContain('runner.showReasoning');
  });
});
