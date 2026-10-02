import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Retro } from '../shared/types';
import { listActions } from './actions';
import { askAgent, obj, str } from './agents';
import { cycle, formatDate, formatTime, language, prompt as cp } from './cyclePrompts';
import { joinList } from '../shared/cycles/text';
import { ATAS } from './env';
import { rc } from './workspaceConfig';
import { getHistory, listHistory } from './state';
import { t } from '../shared/i18n';

const DIR = join(ATAS, 'retros');
const ID = /^\d{4}-\d{2}-\d{2}$/;

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

export function latestRetro(): Retro | null {
  if (!existsSync(DIR)) return null;
  const last = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().pop();
  return last ? read(last.replace(/\.json$/, '')) : null;
}

// What happened in the last days, from the files the app and daily-report already keep. No model involved.
function weekDigest(since: Date): Record<string, unknown> {
  const inWeek = (iso: string | number | null | undefined) => !!iso && new Date(iso) >= since;

  const ceremonies = listHistory()
    .filter((e) => inWeek(e.startedAt ?? e.date))
    .map((e) => {
      const s = getHistory(e.id);
      return {
        dia: e.date,
        atividades: e.activities,
        decisoes: s?.decisions.map((d) => `${d.ref}: ${d.text}`) ?? [],
        efeitos: s?.effects.map((x) => `${x.ref}: ${x.text}`) ?? [],
        sem_resposta: e.unanswered,
        desbloqueios: Object.keys(s?.deep ?? {}).filter((k) => s?.deep[k].msgs.length),
      };
    });

  const actions = listActions()
    .filter((a) => inWeek(a.createdAt))
    .map((a) => ({ tipo: a.kind, issue: a.issue, estado: a.state, release: a.release, reteste: a.retest, arquivos: a.files.length }));

  const gatesDir = join(ATAS, 'gates');
  const gates = existsSync(gatesDir)
    ? readdirSync(gatesDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(gatesDir, f), 'utf8')))
        .filter((g) => inWeek(g.createdAt))
        .map((g) => ({
          issue: g.ref,
          gate: g.gate,
          rodadas: g.rounds.length,
          erros: g.rounds.flatMap((r: { questions: { text: string; section: string }[]; answers: ({ correct: boolean } | null)[] }) =>
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
        .filter((c) => inWeek(c.at) && ['stage', 'has_conflicts', 'pipeline', 'estado', 'approved'].includes(c.field))
        .map((c) => `${c.at.slice(0, 10)} ${c.ref} ${c.field}: ${String(c.from)} → ${String(c.to)}`)
    : [];

  return { cerimonias: ceremonies, acoes_de_release: actions, gates, mudancas_gitlab: changes.slice(-200) };
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

export async function prepareRetro(): Promise<Retro> {
  const to = new Date();
  const params = cycle().ceremonyParams.retro;
  const from = new Date(to.getTime() - params.windowDays * 86_400_000);
  const digest = weekDigest(from);
  const item = obj({ titulo: str, evidencia: str });
  const r = await askAgent<{
    fala: string;
    numeros: { rotulo: string; valor: string }[];
    funcionou: { titulo: string; evidencia: string }[];
    travou: { titulo: string; evidencia: string }[];
    retrabalho: { titulo: string; evidencia: string }[];
    melhorias: { titulo: string; dimensao: string; problema: string; proposta: string }[];
  }>(
    'deep',
    cp('retro.main', {
      from: formatDate(from),
      to: formatDate(to),
      base: baseOf(),
      docsRef: cp('retro.docsRef'),
      focus: cp('retro.focus'),
      words: params.speechWords,
      improvements: cp('retro.improvementsFormat'),
      digest: JSON.stringify(digest).slice(0, 24000),
    }),
    obj({
      fala: str,
      numeros: { type: 'array', items: obj({ rotulo: str, valor: str }) },
      funcionou: { type: 'array', items: item },
      travou: { type: 'array', items: item },
      retrabalho: { type: 'array', items: item },
      melhorias: { type: 'array', items: obj({ titulo: str, dimensao: str, problema: str, proposta: str }) },
    }),
    { maxTurns: 16 },
  );
  const map = (xs: { titulo: string; evidencia: string }[]) => xs.map((x) => ({ title: x.titulo, evidence: x.evidencia }));
  return write({
    id: to.toLocaleDateString('sv-SE'),
    from: from.toISOString(),
    to: to.toISOString(),
    sessionId: r.sessionId || null,
    speech: r.data.fala,
    numbers: r.data.numeros.map((n) => ({ label: n.rotulo, value: n.valor })),
    worked: map(r.data.funcionou),
    stuck: map(r.data.travou),
    rework: map(r.data.retrabalho),
    improvements: r.data.melhorias.map((m) => ({ title: m.titulo, dimension: m.dimensao, problem: m.problema, proposal: m.proposta })),
    talk: [],
    createdAt: to.toISOString(),
  });
}

export async function askRetro(id: string, question: string): Promise<Retro> {
  const retro = read(id);
  if (!retro) throw new Error(t('main.retro.notFound'));
  const r = await askAgent<{ fala: string; texto: string }>(
    'deep',
    cp('retro.ask', { question }),
    obj({ fala: str, texto: str }),
    { maxTurns: 10, ...(retro.sessionId ? { resume: retro.sessionId } : {}) },
  );
  retro.sessionId = r.sessionId || retro.sessionId;
  retro.talk.push({ me: true, text: question, at: now() }, { me: false, text: r.data.texto || r.data.fala, speech: r.data.fala, at: now(), ...(r.partial ? { partial: true } : {}) });
  return write(retro);
}
