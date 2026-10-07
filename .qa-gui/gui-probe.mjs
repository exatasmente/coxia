import { _electron } from 'playwright-core';
const app = await _electron.launch({
  args: ['.', '--no-sandbox'],
  env: { ...process.env, CERIMONIAS_DATA_DIR: '/tmp/cerimonias-gui-probe' },
  cwd: process.cwd(),
});
try {
  const win = await app.firstWindow({ timeout: 20000 });
  await win.waitForLoadState('domcontentloaded');
  await win.screenshot({ path: '.qa-gui/probe-1.png' });
} catch (e) { console.log('ERR', e.message); }
await app.close();
