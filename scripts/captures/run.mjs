// Usage: node scripts/captures/run.mjs [--data <folder>] [--only <id>] [--lang <pt-BR|en>]
//
// Writes every image of scripts/captures/index.json from the built app running over a seeded workspace. The app must have
// been built first (`npx electron-vite build`): the capture opens out/main/index.js, never the sources. Nothing of the
// person's data is touched: the app is pointed at a throwaway folder seeded by scripts/seed-docs-workspace.mjs.
//
// The window size, the theme, the language and the clock are fixed, and the animations are off, so two runs over the same
// seed write the same files. The `wizard` feature is captured over an empty data folder: an empty folder opens exactly in
// the setup wizard, which is what its image shows.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { FIXED_DAY, PHONE_DATA_DIR, seedDocsWorkspace } from '../seed-docs-workspace.mjs';
import { settle, waitForText } from './shared.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const IMAGES = join(ROOT, 'docs', 'images');
const WINDOW = { width: 1280, height: 800 };

/** The entry the built app starts from; the capture refuses to guess when it is not there. */
const mainEntry = () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return join(ROOT, pkg.main ?? 'out/main/index.js');
};

/** Makes the clock of the window stand at the seed's fixed day and asks for no animation, before the app draws. */
const fixWindow = async (page) => {
  await page.addInitScript((iso) => {
    const fixed = Date.parse(iso);
    const RealDate = Date;
    const shifted = new Proxy(RealDate, {
      construct: (target, args) => (args.length ? new target(...args) : new target(fixed + (RealDate.now() - performance.timeOrigin))),
      apply: () => new RealDate(fixed + (RealDate.now() - performance.timeOrigin)),
    });
    Object.defineProperty(shifted, 'now', { value: () => fixed + (RealDate.now() - performance.timeOrigin) });
    // @ts-ignore the window is the app's own
    window.Date = shifted;
  }, FIXED_DAY);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  // The running clock of a ceremony and the activity line of a turn nobody prepared are drawn by JavaScript on a timer: the
  // app reaches into the page to move them, which freezes the window the moment the capture is over. Both are hidden with a
  // stylesheet, which changes nothing that is drawn. The line also names where the model would come from, which a public
  // picture must not carry (a capture runs no model and the app has no provider configured).
  await page.addStyleTag({ content: '.timer, .act { visibility: hidden; }' }).catch(() => undefined);
};

/** Seeds a throwaway workspace for one language, or an empty folder for the features that show a first run. */
export async function workspaceFor(lang, empty = false) {
  const dir = mkdtempSync(join(tmpdir(), 'coxia-capture-'));
  if (empty) return dir;
  await seedDocsWorkspace(dir);
  const config = join(dir, 'workspaces', 'principal', 'config.json');
  const doc = JSON.parse(readFileSync(config, 'utf8'));
  doc.language = lang;
  writeFileSync(config, `${JSON.stringify(doc, null, 2)}\n`);
  return dir;
}

/**
 * Captures one feature in one language and writes its image. Returns the file written. `dataDir` may be given when the
 * caller has already seeded a workspace (the release stage does that); otherwise one is made for this capture.
 *
 * `phone` is the companion the app serves in its web mode: the built app is started on the throwaway copy named by the
 * seed's `web.json` (whose folder carries the paired session) and the companion is driven in a browser at 390 px. Changing
 * the page size of the desktop window would draw the day, not the phone. Its turn clock is frozen by a stylesheet and the
 * pauses of the window come from the person's own settings: nothing of the capture reaches into the page to take a clock.
 */
export async function captureFeature(feature, lang, { dataDir, only } = {}) {
  if (only && feature.id !== only) return null;
  const entry = mainEntry();
  if (!existsSync(entry)) throw new Error(`the app is not built (${entry} is missing): run \`npx electron-vite build\` first`);
  const seeded = dataDir ?? (await workspaceFor(lang, feature.id === 'wizard'));
  const mod = await import(new URL(feature.script, import.meta.url).href);
  mkdirSync(IMAGES, { recursive: true });
  if (feature.id === 'phone') return await capturePhone(mod, { dataDir, lang, seeded });
  const app = await electron.launch({
    args: [entry, '--no-sandbox', `--window-size=${WINDOW.width},${WINDOW.height}`],
    env: { ...process.env, CERIMONIAS_DATA_DIR: seeded, CERIMONIAS_SPECS_DIR: seeded },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize(WINDOW);
    await fixWindow(page);
    await mod.capture({ app, page, lang, out: IMAGES, dataDir: seeded, root: ROOT });
    await settle(page);
    const name = lang === 'en' ? `${feature.id}-en.png` : `${feature.id}.png`;
    await page.screenshot({ path: join(IMAGES, name) });
    return join(IMAGES, name);
  } finally {
    await app.close().catch(() => undefined);
    if (!dataDir) rmSync(seeded, { recursive: true, force: true });
  }
}

/** The phone companion: the app up in its web mode over the throwaway copy of the seed, driven by a browser at 390 px. */
async function capturePhone(mod, { dataDir, lang, seeded }) {
  const app = await electron.launch({
    args: [mainEntry(), '--no-sandbox'],
    env: { ...process.env, CERIMONIAS_DATA_DIR: dataDir ?? join(seeded, PHONE_DATA_DIR), CERIMONIAS_SPECS_DIR: dataDir ?? join(seeded, PHONE_DATA_DIR) },
  });
  try {
    const page = await app.firstWindow();
    await waitForText(page, ['Hoje', 'Today']);
    // The web mode listens a moment after the window opens; asking for it too early answers nothing and the capture waits.
    const housed = page.getByText(/Acesso pelo navegador|Browser access/i).first();
    if (await housed.isVisible().catch(() => false)) await housed.click().catch(() => undefined);
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      up = await page.request.get('http://127.0.0.1:4330/cerimonias/').then((r) => r.ok()).catch(() => false);
      if (!up) await page.waitForTimeout(500);
    }
    if (!up) throw new Error('the app\'s web mode is not listening on 127.0.0.1:4330: the phone capture needs it up');
    const written = await mod.capture({ app, page, lang, out: IMAGES, dataDir: dataDir ?? join(seeded, PHONE_DATA_DIR), root: ROOT });
    return join(IMAGES, written.name);
  } finally {
    await app.close().catch(() => undefined);
    if (!dataDir) rmSync(seeded, { recursive: true, force: true });
  }
}

/** Every feature of the list, in every language it names. */
export async function runAll({ dataDir, only, lang } = {}) {
  const index = JSON.parse(readFileSync(join(HERE, 'index.json'), 'utf8'));
  const features = Array.isArray(index) ? index : index.features;
  const written = [];
  for (const feature of features) {
    for (const l of feature.langs ?? ['pt-BR', 'en']) {
      if (lang && l !== lang) continue;
      const file = await captureFeature(feature, l, { dataDir, only });
      if (file) written.push(file);
    }
  }
  return written;
}

async function main(argv) {
  const value = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  try {
    const written = await runAll({ dataDir: value('--data'), only: value('--only'), lang: value('--lang') });
    console.log(`captures: wrote ${written.length} image(s) into docs/images/`);
    return 0;
  } catch (e) {
    console.error(`captures: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
