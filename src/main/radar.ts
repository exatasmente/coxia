import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { RadarFinding, RadarKind, RadarRegion, RadarResult, RadarSide } from '../shared/radar';
import { stageRank } from '../shared/config/stages';
import type { Card } from '../shared/types';
import { loadCards } from './cards';
import { getSettings } from './config';
import { ATAS } from './env';
import { rc } from './workspaceConfig';
import { vcsProvider } from './vcs';
import type { Module, ModuleContext } from './module';
import { fetchRepos, worktreeHealth } from './worktrees';

const FILE = join(ATAS, 'radar.json');
// related-work-radar collide uses 40 lines (about one method) as "same place".
const WINDOW = 40;

interface MrChanges {
  project: string;
  iid: number;
  branch: string;
  target: string;
  url: string;
  state: string;
  files: Map<string, FileChange>;
}

interface FileChange {
  ranges: [number, number][];
  added: Set<string>;
}

interface Unit {
  card: Card;
  weight: number;
  mrs: MrChanges[];
}

// The stage of a card is coarse; the weight follows its rank (more advanced = costlier to touch).
export function stageWeight(stage: string | null): number {
  return stageRank(rc().stages, stage);
}

// Files that every parallel change touches (locales, lockfiles, env samples, spec index): a collision there is mechanical.
const NOISE = [
  /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|CHANGELOG[^/]*)$/,
  /(^|\/)\.env(\.[\w-]+)?$/,
  /(^|\/)(locales?|i18n)\//,
  /(^|\/)(translate\.ts|schema\.gql|jest\.config\.json|\.gitlab-ci\.yml)$/,
  /^\.specs\//,
  /(^|\/)lang\//,
];
const TEST_FILE = /(^|\/)(tests?|__tests__|__mocks__)\/|\.(spec|test)\.[jt]sx?$|_test\.dart$|Test\.php$/;
const GENERIC_DIR = new Set([
  'app', 'src', 'lib', 'resources', 'assets', 'js', 'config', 'components', 'pages', 'utils', 'helpers', 'common', 'shared',
  'Services', 'Controllers', 'Http', 'Model', 'Models', 'Listeners', 'Events', 'Repositories', 'Actions', 'Middleware', 'Traits',
  'Exceptions', 'API', 'V1', 'V2', 'V4', 'admin', 'agent', 'Agent', 'Client', 'master', 'presentation', 'application',
]);

// The folder of issue specs is in the repo it lives in (".specs/" at the root, for the SDD layout): a collision there is mechanical too.
const specsNoise = (): RegExp | null => {
  const dir = rc().specsDir;
  return dir ? new RegExp(`^${basename(dir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`) : null;
};
const isNoise = (file: string) => NOISE.some((r) => r.test(file)) || !!specsNoise()?.test(file);

// "Same module": the first two meaningful directory names ("Reports/V2" is dropped to "Reports" by GENERIC_DIR).
function scopeOf(file: string): string | null {
  if (isNoise(file) || TEST_FILE.test(file)) return null;
  const dirs = file.split('/').slice(0, -1).filter((d) => !GENERIC_DIR.has(d) && !d.startsWith('.'));
  return dirs.length ? dirs.slice(0, 2).join('/') : null;
}

export function parseDiff(diff: string): FileChange {
  const marks: number[] = [];
  const added = new Set<string>();
  let line = 0;
  for (const l of diff.split('\n')) {
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (h) {
      line = Number(h[1]);
    } else if (l.startsWith('+')) {
      marks.push(line++);
      const text = l.slice(1).trim();
      if (text.length >= 8) added.add(text);
    } else if (l.startsWith('-')) {
      marks.push(line);
    } else if (!l.startsWith('\\')) {
      line++;
    }
  }
  const ranges: [number, number][] = [];
  for (const m of marks) {
    const last = ranges[ranges.length - 1];
    if (last && m <= last[1] + 1) last[1] = Math.max(last[1], m);
    else ranges.push([m, m]);
  }
  return { ranges, added };
}

function distance(a: [number, number], b: [number, number]): number {
  return a[0] <= b[1] && b[0] <= a[1] ? 0 : Math.min(Math.abs(a[0] - b[1]), Math.abs(b[0] - a[1]));
}

const repoName = (project: string) => project.split('/').pop() ?? project;

function side(u: Unit, mr: MrChanges): RadarSide {
  return { ref: u.card.ref, iid: u.card.iid, title: u.card.title, stage: u.card.stage, mr: `${repoName(mr.project)}!${mr.iid}`, branch: mr.branch, target: mr.target, url: mr.url };
}

const RECOMMENDATION: Record<RadarKind, string> = {
  'same-fix':
    'Leia os dois trechos antes de mergear e comente nas duas MRs no mesmo dia: é o único achado com prazo, porque depois do merge quem perdeu volta ao QA de graça. Se for a mesma correção, fique com uma só.',
  dependency: 'Sequencie: a atividade mais atrás entra depois. Não branche da branch dela nem duplique o código que ela traz.',
  file: 'Combine quem mexe no que antes de as duas avançarem. Depois do merge da primeira, atualize a outra com a main e confira de novo.',
  scope: 'Só alinhe o escopo e confira se as duas dependem da mesma decisão (mesma config, mesma regra de negócio). Não bloqueia nada.',
};

interface PairEvidence {
  files: Set<string>;
  regions: RadarRegion[];
  nearCode: boolean;
  overlap: boolean;
  identical: number;
  scopes: Set<string>;
  stacked: { ahead: 'a' | 'b'; mrA: MrChanges; mrB: MrChanges } | null;
  firstMr: [MrChanges, MrChanges] | null;
}

function evidence(a: Unit, b: Unit): PairEvidence {
  const ev: PairEvidence = { files: new Set(), regions: [], nearCode: false, overlap: false, identical: 0, scopes: new Set(), stacked: null, firstMr: null };
  for (const ma of a.mrs) {
    for (const mb of b.mrs) {
      if (ma.project !== mb.project || ma.iid === mb.iid) continue;
      const stacked = mb.target === ma.branch ? 'a' : ma.target === mb.branch ? 'b' : null;
      if (stacked && !ev.stacked) ev.stacked = { ahead: stacked, mrA: ma, mrB: mb };
      const repo = repoName(ma.project);
      for (const [file, ca] of ma.files) {
        const cb = mb.files.get(file);
        if (isNoise(file)) continue;
        if (!cb) {
          const sa = scopeOf(file);
          if (sa && [...mb.files.keys()].some((f) => scopeOf(f) === sa)) ev.scopes.add(`${repo}:${sa}`);
          continue;
        }
        ev.files.add(`${repo}:${file}`);
        ev.firstMr ??= [ma, mb];
        const near: RadarRegion[] = [];
        for (const ra of ca.ranges) for (const rb of cb.ranges) {
          const d = distance(ra, rb);
          if (d <= WINDOW) near.push({ file: `${repo}:${file}`, a: ra, b: rb, distance: d });
        }
        if (near.length) {
          ev.regions.push(...near);
          if (!TEST_FILE.test(file)) {
            ev.nearCode = true;
            if (near.some((r) => r.distance === 0)) ev.overlap = true;
            for (const line of ca.added) if (cb.added.has(line)) ev.identical++;
          }
        }
      }
    }
  }
  ev.regions.sort((x, y) => x.distance - y.distance);
  ev.regions = ev.regions.slice(0, 6);
  return ev;
}

function describe(kind: RadarKind, ev: PairEvidence, ahead: Unit, behind: Unit): string {
  const files = [...ev.files];
  const list = files.slice(0, 2).map((f) => `\`${f}\``).join(', ') + (files.length > 2 ? ` e mais ${files.length - 2}` : '');
  if (kind === 'same-fix') {
    const closest = ev.regions[0];
    const where = closest?.distance === 0 ? 'no mesmo trecho' : `a ${closest?.distance} linhas de distância`;
    const parts = [`Mexem ${where} em ${list}.`];
    parts.push(ev.overlap ? 'O git deve acusar conflito.' : 'O merge sai limpo e nada avisa.');
    if (ev.identical >= 3) parts.push(`${ev.identical} linhas adicionadas são iguais: parece a mesma correção feita duas vezes.`);
    return parts.join(' ');
  }
  if (kind === 'dependency') {
    const why = ev.stacked ? 'Uma MR parte da branch da outra.' : `Mexem em ${list}.`;
    return `${why} #${ahead.card.iid} já está em ${ahead.card.stage ?? 'etapa avançada'}; #${behind.card.iid} depende de código não mergeado.`;
  }
  if (kind === 'file') return `Mexem no mesmo arquivo, em trechos distantes: ${list}.`;
  return `Mesmo módulo, sem arquivo em comum: ${[...ev.scopes].slice(0, 3).join(', ')}.`;
}

export function analyze(units: Unit[], seen: Map<string, string>, now: string): RadarFinding[] {
  const findings: RadarFinding[] = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const x = units[i];
      const y = units[j];
      const ev = evidence(x, y);
      let kind: RadarKind | null = null;
      let ahead = x.weight >= y.weight ? x : y;
      let behind = ahead === x ? y : x;
      if (ev.nearCode) kind = 'same-fix';
      else if (ev.stacked) {
        kind = 'dependency';
        ahead = ev.stacked.ahead === 'a' ? x : y;
        behind = ahead === x ? y : x;
      } else if (ev.files.size) kind = ahead.weight >= 4 && ahead.weight > behind.weight ? 'dependency' : 'file';
      else if (ev.scopes.size) kind = 'scope';
      if (!kind) continue;

      const pair = ev.firstMr ?? [x.mrs[0], y.mrs[0]];
      const mrOf = (u: Unit) => (u === x ? pair[0] : pair[1]) ?? u.mrs[0];
      const key = `${kind}|${[x.card.iid, y.card.iid].sort().join('+')}`;
      const [first, second] = kind === 'dependency' || kind === 'file' ? [ahead, behind] : [x, y];
      const mA = mrOf(first);
      const mB = mrOf(second);
      const repo = mA.project === mB.project ? repoName(mA.project) : null;
      const repoPath = repo ? rc().repos.find((r) => r.id === repo)?.path : undefined;
      findings.push({
        key,
        kind,
        a: side(first, mA),
        b: side(second, mB),
        files: [...ev.files],
        scopes: [...ev.scopes],
        regions: ev.regions,
        identicalLines: ev.identical,
        silent: kind === 'same-fix' && !ev.overlap,
        summary: describe(kind, ev, ahead, behind),
        recommendation: RECOMMENDATION[kind],
        collideCommand: kind === 'same-fix' && repoPath ? `git -C ${repoPath} merge-tree --write-tree origin/${mA.branch} origin/${mB.branch}` : null,
        firstSeen: seen.get(key) ?? now,
      });
    }
  }
  const order: Record<RadarKind, number> = { 'same-fix': 0, dependency: 1, file: 2, scope: 3 };
  return findings.sort((p, q) => order[p.kind] - order[q.kind] || p.key.localeCompare(q.key));
}

async function fetchChanges(project: string, iid: number): Promise<MrChanges | null> {
  const prov = vcsProvider();
  const mr = await prov.getMr(project, iid);
  if (mr.state !== 'open') return null;
  const changes = await prov.listMrChanges(project, iid);
  const files = new Map<string, FileChange>();
  // A collapsed (too large) diff arrives empty: the file still counts, only the region is unknown.
  for (const c of changes) files.set(c.path, parseDiff(c.diff));
  return { project, iid, branch: mr.sourceBranch, target: mr.targetBranch, url: mr.webUrl, state: 'opened', files };
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

interface Stored extends RadarResult {
  seen: string[];
}

export function readRadar(): Stored | null {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')) as Stored;
  } catch {}
  return null;
}

function writeRadar(s: Stored): void {
  mkdirSync(ATAS, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(s, null, 2));
  renameSync(`${FILE}.tmp`, FILE);
}

let running: Promise<{ result: RadarResult; fresh: RadarFinding[]; first: boolean }> | null = null;

export function runRadar(): ReturnType<typeof runRadarOnce> {
  running ??= runRadarOnce().finally(() => {
    running = null;
  });
  return running;
}

async function runRadarOnce() {
  const previous = readRadar();
  const now = new Date().toISOString();
  const { cards } = await loadCards(100);
  const failed: string[] = [];
  const targets = cards.flatMap((card) => card.mrPaths.map((p) => ({ card, ...p })));
  const fetched = await pool(targets, 4, async (t) => {
    try {
      return { t, mr: await fetchChanges(t.project, t.iid) };
    } catch (e) {
      failed.push(`${t.ref}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
      return { t, mr: null };
    }
  });
  const units: Unit[] = cards
    .map((card) => ({ card, weight: stageWeight(card.stage), mrs: fetched.filter((f) => f.t.card === card && f.mr).map((f) => f.mr as MrChanges) }))
    .filter((u) => u.mrs.length);

  const seen = new Map((previous?.findings ?? []).map((f) => [f.key, f.firstSeen]));
  const findings = analyze(units, seen, now);
  const known = new Set(previous?.seen ?? []);
  const fresh = findings.filter((f) => !known.has(f.key));
  const result: RadarResult = { checkedAt: now, mrsChecked: fetched.filter((f) => f.mr).length, findings, failed };
  writeRadar({ ...result, seen: findings.map((f) => f.key) });
  return { result, fresh, first: !previous };
}

const KIND_LABEL: Record<RadarKind, string> = { 'same-fix': 'Mesma correção', dependency: 'Dependência', file: 'Colisão de arquivo', scope: 'Mesmo escopo' };

function announce(ctx: ModuleContext, fresh: RadarFinding[], first: boolean): void {
  if (!getSettings().notifications) return;
  // The first run would list the whole backlog of known overlaps; only the urgent kind is worth a notification then.
  const list = first ? fresh.filter((f) => f.kind === 'same-fix') : fresh;
  if (!list.length) return;
  const onClick = { type: 'open', screen: { name: 'radar' } } as const;
  if (list.length === 1) {
    const f = list[0];
    ctx.notify({ title: `Radar: ${KIND_LABEL[f.kind].toLowerCase()} entre #${f.a.iid} e #${f.b.iid}`, body: `${f.summary.replace(/`/g, '')}\nClique para abrir o radar.`, onClick });
    return;
  }
  const refs = list.map((f) => `#${f.a.iid} × #${f.b.iid} (${KIND_LABEL[f.kind].toLowerCase()})`).join('\n');
  ctx.notify({ title: `Radar: ${list.length} achados novos`, body: refs, onClick });
}

export const register: Module = (ctx) => {
  const check = async (): Promise<RadarResult> => {
    const { result, fresh, first } = await runRadar();
    ctx.emit({ type: 'module', name: 'radar', payload: result });
    announce(ctx, fresh, first);
    return result;
  };
  ctx.handle('radar:run', async () => {
    await fetchRepos();
    return check();
  });
  ctx.handle('radar:latest', () => readRadar());
  ctx.handle('worktrees:health', () => worktreeHealth());
  ctx.job({ name: 'radar', everyMin: 120, workHoursOnly: true, enabled: () => rc().repos.length > 0, run: async () => {
    await fetchRepos();
    await check();
  } });
};
