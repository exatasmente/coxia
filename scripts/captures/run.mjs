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
import { FIXED_DAY, seedDocsWorkspace } from '../seed-docs-workspace.mjs';
import { settle } from './shared.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const IMAGES = join(ROOT, 'docs', 'images');
const WINDOW = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

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
 */
export async function captureFeature(feature, lang, { dataDir, only } = {}) {
  if (only && feature.id !== only) return null;
  const entry = mainEntry();
  if (!existsSync(entry)) throw new Error(`the app is not built (${entry} is missing): run \`npx electron-vite build\` first`);
  const seeded = dataDir ?? (await workspaceFor(lang, feature.id === 'wizard'));
  const app = await electron.launch({
    args: [entry, '--no-sandbox', ...(feature.id === 'phone' ? [] : [`--window-size=${WINDOW.width},${WINDOW.height}`])],
    env: { ...process.env, CERIMONIAS_DATA_DIR: seeded, CERIMONIAS_SPECS_DIR: seeded },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize(feature.id === 'phone' ? PHONE : WINDOW);
    await fixWindow(page);
    const mod = await import(new URL(feature.script, import.meta.url).href);
    await mod.capture({ app, page, lang, out: IMAGES });
    await settle(page);
    const name = lang === 'en' ? `${feature.id}-en.png` : `${feature.id}.png`;
    mkdirSync(IMAGES, { recursive: true });
    await page.screenshot({ path: join(IMAGES, name) });
    return join(IMAGES, name);
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
