// Usage: node scripts/evidence-sheet.mjs <out.png> <image>... [--cols N] [--width PX] [--title TEXT] [--caption "<file>=<text>"]... [--theme light|dark]
//
// Puts a handful of screenshots on one contact sheet, so a pull request carries one picture to look at instead of twenty. The
// page is built by `evidence-sheet-core.mjs` with the pictures inlined, rendered by headless Chromium (the one `playwright-core`
// drives, `npx playwright install chromium`) and screenshotted whole. The page cannot reach the network, and every request it
// tries is aborted anyway.
//
// Exit codes: 0 the sheet is written; 1 wrong arguments or a bad input file (named); 2 the rendering failed.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_HEIGHT, USAGE, UsageError, checkInputs, clipHeight, htmlOf, loadTiles, parseArgs, sheetWidth } from './evidence-sheet-core.mjs';

export async function main(argv) {
  let plan;
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    plan = { opts, ...checkInputs(opts) };
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`evidence-sheet: ${err.message}\n\n${USAGE}`);
    return 1;
  }

  let browser;
  try {
    // Loaded here so that the usage text and the input errors work on a machine that has no browser library at all.
    const { chromium } = await import('playwright-core');
    if (!existsSync(chromium.executablePath())) {
      console.error('evidence-sheet: Chromium is not installed for Playwright. Install it with:\n\n  npx playwright install chromium\n');
      return 1;
    }
    const { opts, cols } = plan;
    const tiles = loadTiles(plan.tiles);
    const html = htmlOf({ title: opts.title, theme: opts.theme, cols, width: opts.width, tiles });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: sheetWidth(cols, opts.width), height: 800 } });
    // The page is built to need nothing from outside; this makes sure of it.
    await page.route('**/*', (route) => route.abort());
    await page.setContent(html, { waitUntil: 'load' });
    const broken = await page.evaluate(async () => {
      const failed = [];
      for (const img of document.images) {
        try {
          await img.decode();
        } catch {
          failed.push(img.alt);
        }
      }
      return failed;
    });
    if (broken.length) throw new Error(`the browser could not decode: ${broken.join(', ')}`);
    const full = await page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
    const { height, cut } = clipHeight(full);
    mkdirSync(dirname(resolve(opts.out)), { recursive: true });
    const png = await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: sheetWidth(cols, opts.width), height }, type: 'png' });
    writeFileSync(opts.out, png);
    if (cut) console.warn(`evidence-sheet: the sheet would be ${full} px tall; it was cut at ${MAX_HEIGHT} px. Use fewer images, more --cols or a smaller --width.`);
    console.log(`evidence-sheet: wrote ${opts.out} (${tiles.length} images, ${cols} columns)`);
    return 0;
  } catch (err) {
    console.error(`evidence-sheet: rendering failed: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  } finally {
    await browser?.close().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
