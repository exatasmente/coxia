import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../src/shared/i18n';
import { ACTIVITIES, CARD_SCOPES, CEREMONY_IDS, LANGUAGES, LLM_ROLES, PROVIDER_KINDS, STAGE_KINDS, VCS_KINDS, VOICE_ENGINES } from '../src/shared/config/types';
import { SECRET_SOURCE_TYPES } from '../src/shared/secrets';
import { TEMPLATE_NEEDS } from '../src/shared/cycles/types';
import { DOCS_KEYS, OPEN_PRESETS, WIZARD_STEPS } from '../src/shared/wizard';

const ROOT = join(import.meta.dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

const FILES = [...walk(join(ROOT, 'src/renderer/src/wizard')), join(ROOT, 'src/renderer/src/screens/ConfigWorkspacesSection.tsx')];

// The values a ${...} can take in each dynamic key family.
const FAMILIES: [string, string[]][] = [
  ['wizard.activity.', [...ACTIVITIES]],
  ['wizard.pool.origin.', ['self-reported', 'third-party']],
  ['wizard.pool.problem.', ['empty', 'provider', 'duplicate', 'max']],
  ['wizard.pool.unverified.', ['tools', 'structured']],
  ['wizard.cer.', [...CEREMONY_IDS]],
  ['wizard.cycle.need.', [...TEMPLATE_NEEDS]],
  ['wizard.cycle.tpl.', ['none', 'scrum', 'kanban', 'sdd']],
  ['wizard.docs.', [...DOCS_KEYS]],
  ['wizard.kind.', [...PROVIDER_KINDS]],
  ['wizard.preset.', OPEN_PRESETS.map((p) => p.id)],
  ['wizard.review.sdk.', ['local', 'bundled', 'missing']],
  ['wizard.review.status.', ['ok', 'warn', 'skip']],
  ['wizard.role.', [...LLM_ROLES]],
  ['wizard.secret.source.', [...SECRET_SOURCE_TYPES]],
  ['wizard.secret.problem.', ['empty', 'bad-ref', 'too-long', 'bad-env-name']],
  ['wizard.stageKind.', [...STAGE_KINDS]],
  ['wizard.status.', ['done', 'skipped']],
  ['wizard.step.', [...WIZARD_STEPS]],
  ['wizard.vcs.issuesScope.', [...CARD_SCOPES]],
  ['wizard.vcs.issuesScopeNote.', ['noProject', 'noLabels', 'noLabelSupport']],
  ['wizard.vcs.scopes.', [...VCS_KINDS]],
  ['wizard.vcs.', [...VCS_KINDS]],
  ['wizard.voice.engine.', [...VOICE_ENGINES]],
  ['wizard.voice.', ['check', 'install', 'test']],
  ['wizard.warn.', ['no-chat', 'no-tools', 'small-context', 'tiny-context', 'no-json-schema', 'untested']],
  ['wizard.models.testFail.', ['sdk-missing', 'no-key', 'failed', 'unreachable', 'unknown-provider']],
  ['settings.language.', [...LANGUAGES]],
];

function keysIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/['"`]((?:wizard|settings)\.[\w.\-${}]*[\w}])['"`]/g)) {
    const raw = m[1];
    if (!raw.includes('${')) {
      out.add(raw);
      continue;
    }
    const family = FAMILIES.find(([prefix]) => raw.startsWith(`${prefix}$`));
    if (!family) throw new Error(`no expansion known for the dynamic key ${raw}`);
    const tail = raw.slice(raw.indexOf('}') + 1);
    for (const v of family[1]) out.add(`${family[0]}${v}${tail}`);
  }
  return [...out];
}

describe('the wizard strings', () => {
  const used = [...new Set(FILES.flatMap((f) => keysIn(readFileSync(f, 'utf8'))))];

  it('finds a good number of keys to check', () => {
    expect(used.length).toBeGreaterThan(250);
  });

  it('every key a wizard screen uses is defined in both languages', () => {
    const missing = (lang: 'pt-BR' | 'en') => used.filter((k) => CATALOGS[lang][k] === undefined && !/^settings\.language\.(pt-BR|en)$/.test(k));
    expect(missing('pt-BR')).toEqual([]);
    expect(missing('en')).toEqual([]);
  });

  it('English and Portuguese carry the same placeholders, and no value is empty', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(CATALOGS['pt-BR']).filter((k) => k.startsWith('wizard.') || k.startsWith('settings.wizard') || k.startsWith('settings.configWorkspaces'))) {
      expect(CATALOGS.en[key], key).toBeTruthy();
      expect(CATALOGS['pt-BR'][key], key).toBeTruthy();
      expect(holes(CATALOGS.en[key]), key).toEqual(holes(CATALOGS['pt-BR'][key]));
    }
  });
});
