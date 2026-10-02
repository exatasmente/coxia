import { describe, expect, it } from 'vitest';
import { desktopEntry, launchCommandFor } from '../src/main/autostart-core';

describe('launchCommandFor', () => {
  const base = { execPath: '/home/u/.local/opt/cerimonias/cerimonias', appPath: '/home/u/projects/cerimonias' };

  it('points the packaged app at the AppImage that is running', () => {
    expect(launchCommandFor({ ...base, packaged: true, appImage: '/home/u/.local/opt/cerimonias/Cerimonias.AppImage' })).toEqual([
      '/home/u/.local/opt/cerimonias/Cerimonias.AppImage',
      '--hidden',
    ]);
  });

  it('points the packaged app at the installed binary when it is not an AppImage', () => {
    expect(launchCommandFor({ ...base, packaged: true })).toEqual(['/home/u/.local/opt/cerimonias/cerimonias', '--hidden']);
  });

  it('never leaks the dev tree into a packaged entry', () => {
    const entry = desktopEntry(launchCommandFor({ ...base, packaged: true, appPath: '/home/u/projects/cerimonias/dev' }));
    expect(entry).not.toContain('projects/cerimonias');
    expect(entry).toContain('Exec=/home/u/.local/opt/cerimonias/cerimonias --hidden');
  });

  it('runs electron on the repository in dev', () => {
    expect(launchCommandFor({ ...base, packaged: false, execPath: '/repo/node_modules/electron/dist/electron', appPath: '/repo' })).toEqual([
      '/repo/node_modules/electron/dist/electron',
      '/repo',
      '--hidden',
    ]);
  });
});
