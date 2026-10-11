// What every capture script gets and returns. Not a script of its own: the capture runner (`run.mjs`) imports the
// feature scripts of `index.json`, each of which exports `capture({ app, page, lang, out })`.

/**
 * A feature capture: walks to its screen and writes the image. `app` is the launched Electron application (Playwright's
 * `ElectronApplication`), `page` is the first window, `lang` is the language of this capture and `out` is where the PNG
 * goes. A script may keep a marked-up version as well; the plain image is always written by the runner.
 */
export const CAPTURE_SHAPE = 'capture({ app, page, lang, out, drop })';

/**
 * What keeps a picture still: the turn clock hidden, no animation or transition left running and no blinking caret, so the
 * frame the capture takes does not depend on the instant it is taken.
 */
export const STILL = '.timer { visibility: hidden; } *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';

/**
 * The switches that make the browser draw the same pixels twice: rasterized on the processor in sRGB, with no GPU and no
 * subpixel text, which otherwise moves a few pixels of text by one shade from one run to the next.
 */
export const SAME_PIXELS = ['--disable-gpu', '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none', '--num-raster-threads=1', '--disable-partial-raster', '--disable-skia-runtime-opts'];

/** Waits for the app to settle: two animation frames and a short quiet period, so a screen is drawn before the picture. */
export async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.waitForTimeout(250);
}

/** The first visible element holding one of the texts, waiting for it to appear; null when none does in the time given. */
export async function waitForText(page, texts, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const text of texts) {
      const found = page.getByText(text, { exact: false }).first();
      if (await found.isVisible().catch(() => false)) return found;
    }
    await page.waitForTimeout(150);
  }
  return null;
}
