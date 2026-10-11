// The command line the repository's scripts call. It writes what the site cannot hold as files — one page per
// language of every reference document, the posts of the blog and the history page, all from the repository's own
// files — and builds and checks the site. VitePress asks for its pages while it resolves its configuration, before
// any hook of the build, so the generation happens while this module and its imports are evaluated.
//
//   node site/scripts/cli.mjs build      generate the sources and build the site
//   node site/scripts/cli.mjs check      the links of the built site and the languages of its pages
//
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSite } from './check.mjs';
import { writeSources } from '../.vitepress/build-sources.mjs';

const site = resolve(fileURLToPath(new URL('..', import.meta.url)));
const built = join(site, '.vitepress', 'dist');

async function build() {
  const { build: buildSite } = await import('vitepress');
  writeSources();
  await buildSite(site);
  return 0;
}

function check() {
  if (!existsSync(built)) {
    process.stderr.write(`site: nothing built at ${built}; run the site build first\n`);
    return 1;
  }
  const { links, languages, ok } = checkSite(site, built);
  for (const b of links) process.stderr.write(`site: ${b.page} links ${b.href}, and the site has no ${b.missing}\n`);
  for (const m of languages) process.stderr.write(`site: ${m.page} has no ${m.missing}\n`);
  if (!ok) return 1;
  process.stdout.write('site: every link resolves and every page carries its two languages\n');
  return 0;
}

async function main(argv) {
  const [command] = argv;
  if (command === 'build') return build();
  if (command === 'check') return check();
  process.stderr.write('usage: node site/scripts/cli.mjs build|check\n');
  return 2;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`site: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
