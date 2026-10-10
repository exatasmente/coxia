// The reference section of the site: the walk of `docs/`, the split of a bilingual document into its blocks, and the
// address a document gets. These are the functions the site builds from, so a document that lands in `docs/` becomes
// a page without a list anywhere being edited.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module, no declaration file
import { blocksOf, langOf, pageFor, pagePath, referencePages, titleOf } from '../site/scripts/docs-pages.mjs';

const docs = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'site-docs-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
};

const BILINGUAL = '# Configuração / Configuration\n\n[Português](#português) | [English](#english)\n\n---\n\n## Português\n\nO texto em português.\n\n## English\n\nThe text in English.\n';

describe('the walk of the documentation folder', () => {
  it('lists every reference document, keeps a folder of documents as its index, and leaves the cycle records out', () => {
    const dir = docs({
      'README.md': '# Documentation\n',
      'runner.md': BILINGUAL,
      'plugins/README.md': BILINGUAL,
      'plugins/example-web-search/index.md': BILINGUAL,
      'cycles/30-something/2_PLAN.md': '# A plan\n',
      'images/README.md': '# Screenshots\n',
    });
    expect(referencePages(dir).map((p: string) => pagePath(p, 'en'))).toEqual(['/reference/images/index', '/reference/index', '/reference/plugins/example-web-search/index', '/reference/plugins/index', '/reference/runner']);
  });

  it('gives each document an address from its own path, so a document added to the folder has one without a list', () => {
    expect(pagePath('runner.md', 'en')).toBe('/reference/runner');
    expect(pagePath('runner.md', 'pt-BR')).toBe('/reference/runner.pt-br');
    expect(pagePath('README.md', 'en')).toBe('/reference/index');
    expect(pagePath('plugins/README.md', 'pt-BR')).toBe('/reference/plugins/index.pt-br');
    expect(pagePath('plugins/example-web-search/index.md', 'en')).toBe('/reference/plugins/example-web-search/index');
  });
});

describe('the languages of a document', () => {
  it('splits a document that carries both languages into one block per language, in the order it writes them', () => {
    expect(blocksOf(BILINGUAL)).toEqual([
      { lang: 'pt-BR', body: 'O texto em português.' },
      { lang: 'en', body: 'The text in English.' },
    ]);
  });

  it('leaves a document written in one language as one block, in English', () => {
    expect(blocksOf('# Voice\n\nVoice is optional.\n')).toEqual([{ lang: 'en', body: '# Voice\n\nVoice is optional.' }]);
  });

  it('reads the title of each half of a bilingual document, and the whole one of a single-language document', () => {
    const dir = docs({ 'configuration.md': BILINGUAL, 'voice.md': '# Voice is optional\n\nText.\n' });
    expect(pageFor(dir, 'configuration.md').single).toBe(false);
    expect(pageFor(dir, 'voice.md')).toMatchObject({ single: true, lang: 'en' });
    expect(titleOf('configuration.md', BILINGUAL, 'pt-BR')).toBe('Configuração');
    expect(titleOf('configuration.md', BILINGUAL, 'en')).toBe('Configuration');
    expect(titleOf('voice.md', '# Voice is optional\n', 'en')).toBe('Voice is optional');
    expect(pageFor(dir, 'voice.md').title).toBe('Voice is optional');
  });

  it('splits a document written in one title per half, the whole text before the second title keeping its own language', () => {
    // The shape of a document the repository writes in Portuguese then turns to English under a second title: it is
    // not two half pages of the `## Português`/`## English` shape, and the text before the second title is what the
    // check looks at; without it the page would be served as the English half of a pair the document does not have.
    const half = `# Comandos de verificação\n\nUm comando por projeto.\n\n## De quem é\n\nDo workspace.\n\n# Conflict verification commands (English)\n\nA command per project.\n\n## Whose it is\n\nThe workspace's.\n`;
    expect(blocksOf(half)).toEqual([
      { lang: 'pt-BR', body: '# Comandos de verificação\n\nUm comando por projeto.\n\n## De quem é\n\nDo workspace.' },
      { lang: 'en', body: 'A command per project.\n\n## Whose it is\n\nThe workspace\'s.' },
    ]);
    expect(langOf('verify-commands.md', half)).toBe('pt-BR');
    expect(titleOf('verify-commands.md', half, 'pt-BR')).toBe('Comandos de verificação');
    expect(titleOf('verify-commands.md', half, 'en')).toBe('Conflict verification commands');
  });

  it('gives each document a page with its title and its own text, and keeps the file where it is', () => {
    const dir = docs({ 'configuration.md': BILINGUAL, 'plain.md': '# Plain\n\nOnly English.\n' });
    const page = pageFor(dir, 'configuration.md');
    // The title of a bilingual document is the half of the language the site shows first, which is the one it is written in.
    expect(page.lang).toBe('pt-BR');
    expect(page.title).toBe('Configuração');
    expect(page.body.en).toBe('The text in English.');
    expect(page.body['pt-BR']).toBe('O texto em português.');
    const plain = pageFor(dir, 'plain.md');
    expect(plain.title).toBe('Plain');
    expect(plain.body.en).toBe('# Plain\n\nOnly English.');
    expect(plain.body['pt-BR']).toBeNull();
  });

  it('a document whose two languages carry the same text is not a bilingual one', () => {
    const dir = docs({ 'plain.md': '# Title\n\nText.\n' });
    expect(pageFor(dir, 'plain.md')).toMatchObject({ single: true, lang: 'en' });
  });
});
