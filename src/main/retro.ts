import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { squadOf } from '../shared/config/squads';
import { refsOfSquad } from '../shared/squadCards';
import type { Retro } from '../shared/types';
import { listActions } from './actions';
import { askAgent, obj, str } from './agents';
import { answerCeremonyMentions } from './mentions/ceremony';
import { cycle, formatDate, formatTime, language, prompt as cp, text as cycleWord } from './cyclePrompts';
import { joinList } from '../shared/cycles/text';
import { ATAS } from './env';
import { runStore } from './runs';
import { type RetroImprovement, proposeRetroIssues } from './retroIssues';
import { suggestFromRetro } from './suggestionsModule';
import { getConfig, rc } from './workspaceConfig';
import { getHistory, listHistory } from './state';
import { t } from '../shared/i18n';

const DIR = join(ATAS, 'retros');
// A retro is named for its day; one held for a squad has the squad after the day.
const ID = /^\d{4}-\d{2}-\d{2}(?:-[a-z0-9][a-z0-9_-]{0,47})?$/;
const WHOLE = /^\d{4}-\d{2}-\d{2}\.json$/;

function now(): string {
  return formatTime(new Date());
}

function write(r: Retro): Retro {
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `${r.id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(r, null, 1));
  renameSync(`${file}.tmp`, file);
  return r;
}

function read(id: string): Retro | null {
  if (!ID.test(id)) return null;
  try {
    return JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')) as Retro;
  } catch {
    return null;
  }
}

/** Reads and writes one stored retro; the retro's conversation adds to it after reading. */
export const readRetro = read;
export const writeRetro = write;

/** The latest retro of the whole workspace, or, with a squad, the latest one held for it. */
export function latestRetro(squad: string | null = null): Retro | null {
  if (!existsSync(DIR)) return null;
  // A retro for a squad is named "<day>-<squad>"; the whole workspace's is named for its day alone. `ID` bounds the name, not the day.
  const mine = (f: string): boolean => (squad ? f.endsWith(`-${squad}.json`) : WHOLE.test(f));
  const last = readdirSync(DIR).filter(mine).sort().pop();
  return last ? read(last.slice(0, -'.json'.length)) : null;
}

// The names of the digest's fields, in the language the agent answers in (the digest is JSON the prompt carries).
const k = (name: string): string => t(`main.retro.digest.${name}`);

// What happened in the last days, from the files the app and the card source already keep. No model involved.
function weekDigest(since: Date, squad: string | null = null): Record<string, unknown> {
  const inWeek = (iso: string | number | null | undefined) => !!iso && new Date(iso) >= since;
  // A retro held for a squad looks at the ceremonies held for it, and at the issues its runs work (the release actions, the gates and the changes of those).
  const refs = squad ? refsOfSquad(squad, { runs: runStore().list() }) : null;
  const iids = refs ? new Set([...refs].map((r) => Number(r.split('#').pop()))) : null;

  const ceremonies = listHistory()
    .filter((e) => !squad || e.squad === squad)
    .filter((e) => inWeek(e.startedAt ?? e.date))
    .map((e) => {
      const s = getHistory(e.id);
      return {
        [k('dia')]: e.date,
        [k('atividades')]: e.activities,
        [k('decisoes')]: s?.decisions.map((d) => `${d.ref}: ${d.text}`) ?? [],
        [k('efeitos')]: s?.effects.map((x) => `${x.ref}: ${x.text}`) ?? [],
        [k('sem_resposta')]: e.unanswered,
        [k('desbloqueios')]: Object.keys(s?.deep ?? {}).filter((key) => s?.deep[key].msgs.length),
      };
    });

  const actions = listActions()
    .filter((a) => inWeek(a.createdAt) && (!iids || iids.has(a.issue)))
    .map((a) => ({ [k('tipo')]: a.kind, issue: a.issue, [k('estado')]: a.state, release: a.release, [k('reteste')]: a.retest, [k('arquivos')]: a.files.length }));

  const gatesDir = join(ATAS, 'gates');
  const gates = existsSync(gatesDir)
    ? readdirSync(gatesDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(gatesDir, f), 'utf8')))
        .filter((g) => inWeek(g.createdAt) && (!refs || refs.has(g.ref)))
        .map((g) => ({
          issue: g.ref,
          gate: g.gate,
          [k('rodadas')]: g.rounds.length,
          [k('erros')]: g.rounds.flatMap((r: { questions: { text: string; section: string }[]; answers: ({ correct: boolean } | null)[] }) =>
            r.questions.filter((_, i) => r.answers[i] && !r.answers[i]?.correct).map((q) => q.section),
          ),
        }))
    : [];

  const historyFile = rc().cardSource?.historyFile ?? null;
  const changes = historyFile && existsSync(historyFile)
    ? readFileSync(historyFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { at: string; ref: string; field: string; from: unknown; to: unknown })
        .filter((c) => inWeek(c.at) && ['stage', 'has_conflicts', 'pipeline', 'estado', 'approved'].includes(c.field) && (!refs || refs.has(c.ref)))
        .map((c) => `${c.at.slice(0, 10)} ${c.ref} ${c.field}: ${String(c.from)} → ${String(c.to)}`)
    : [];

  const named = squad ? squadOf(getConfig(), squad) : null;
  return { ...(named ? { [k('squad')]: cycleWord(named.name || named.id) } : {}), [k('cerimonias')]: ceremonies, [k('acoes_de_release')]: actions, gates, [k('mudancas_gitlab')]: changes.slice(-200) };
}

// What the retro is based on, in words: only what this cycle has (release actions, gate quizzes, the card source's change history).
function baseOf(): string {
  const c = cycle().ceremonies;
  const parts = [
    cp('retro.base.ceremonies'),
    cp('retro.base.decisions'),
    c.releaseConflicts ? cp('retro.base.release') : '',
    c.gate ? cp('retro.base.gates') : '',
    rc().cardSource?.historyFile ? cp('retro.base.changes') : '',
  ];
  return joinList(parts, language());
}

export async function prepareRetro(squad: string | null = null): Promise<Retro> {
  if (squad && !squadOf(getConfig(), squad)) throw new Error(t('main.squad.unknown', { id: squad }));
  const to = new Date();
  const params = cycle().ceremonyParams.retro;
  const from = new Date(to.getTime() - params.windowDays * 86_400_000);
  const digest = weekDigest(from, squad);
  const item = obj({ titulo: str, evidencia: str });
  const r = await askAgent<{
    fala: string;
    numeros: { rotulo: string; valor: string }[];
    funcionou: { titulo: string; evidencia: string }[];
    travou: { titulo: string; evidencia: string }[];
    retrabalho: { titulo: string; evidencia: string }[];
  }>(
    'deep',
    cp('retro.main', {
      from: formatDate(from),
      to: formatDate(to),
      base: baseOf(),
      docsRef: cp('retro.docsRef'),
      focus: cp('retro.focus'),
      words: params.speechWords,
      digest: JSON.stringify(digest).slice(0, 24000),
    }),
    obj({
      fala: str,
      numeros: { type: 'array', items: obj({ rotulo: str, valor: str }) },
      funcionou: { type: 'array', items: item },
      travou: { type: 'array', items: item },
      retrabalho: { type: 'array', items: item },
    }),
    { maxTurns: 16 },
  );
  const map = (xs: { titulo: string; evidencia: string }[]) => xs.map((x) => ({ title: x.titulo, evidence: x.evidencia }));
  return write({
    id: squad ? `${to.toLocaleDateString('sv-SE')}-${squad}` : to.toLocaleDateString('sv-SE'),
    ...(squad ? { squad } : {}),
    from: from.toISOString(),
    to: to.toISOString(),
    sessionId: r.sessionId || null,
    speech: r.data.fala,
    numbers: r.data.numeros.map((n) => ({ label: n.rotulo, value: n.valor })),
    worked: map(r.data.funcionou),
    stuck: map(r.data.travou),
    rework: map(r.data.retrabalho),
    talk: [],
    createdAt: to.toISOString(),
  });
}

export async function askRetro(id: string, question: string): Promise<Retro> {
  const retro = read(id);
  if (!retro) throw new Error(t('main.retro.notFound'));
  const mentioned = await answerCeremonyMentions(question, { thread: retro.id, ref: retro.id, title: retro.id, msgs: retro.talk.map((m) => ({ who: m.me ? 'me' : (m.agent ?? 'app'), text: m.text })) });
  const r = await askAgent<{ fala: string; texto: string; melhorias?: RetroImprovement[] }>(
    'deep',
    cp('retro.ask', { question }),
    obj({ fala: str, texto: str, melhorias: { type: 'array', items: obj({ titulo: str, dimensao: str, problema: str, proposta: str }) } }),
    { maxTurns: 10, ...(retro.sessionId ? { resume: retro.sessionId } : {}) },
  );
  retro.sessionId = r.sessionId || retro.sessionId;
  retro.talk.push(
    { me: true, text: question, at: now() },
    ...mentioned.map((m) => ({ me: false, agent: m.agent, text: m.text, speech: m.speech, at: now() })),
    { me: false, text: r.data.texto || r.data.fala, speech: r.data.fala, at: now(), ...(r.partial ? { partial: true } : {}) },
  );
  await proposeRetroIssues(retro, r.data.melhorias ?? []);
  // The retro is stored before the suggestions are raised: the reading looks at the retro that was just answered (its minute among the ceremonies),
  // so a suggestion whose evidence changed with this retro is compared against the state as it is now, not the one from before it.
  const stored = write(retro);
  // The end of the retro may raise at most two suggestions from what the history shows (no improvement of the conversation becomes one: that is #16's).
  await suggestFromRetro().catch((e) => console.error('[retro] suggestions', e instanceof Error ? e.message : e));
  return stored;
}
