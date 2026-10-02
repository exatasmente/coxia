import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Retro } from '../shared/types';
import { listActions } from './actions';
import { CHAT_RULES, SPEECH_RULES, askAgent, obj, str } from './agents';
import { ATAS } from './env';
import { rc } from './workspaceConfig';
import { getHistory, listHistory } from './state';

const DIR = join(ATAS, 'retros');
const DAYS = 7;
const ID = /^\d{4}-\d{2}-\d{2}$/;

function now(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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

export async function prepareRetro(): Promise<Retro> {
  const to = new Date();
  const from = new Date(to.getTime() - DAYS * 86_400_000);
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
    [
      `Retro semanal do Luiz, por voz, de ${from.toLocaleDateString('pt-BR')} a ${to.toLocaleDateString('pt-BR')}. Você conduz.`,
      'Base: o resumo abaixo (cerimônias, decisões, ações de release, quizzes de gate e mudanças no GitLab). Pode ler specs e o playbook para entender um ponto; não invente fato que não esteja no resumo ou no que você ler.',
      'Olhe processo, não pessoas: Failed testing e reprovações, bloqueios que duraram, conflitos pós-release, gates com mais de uma rodada (o material não ensinou), perguntas que ficaram sem resposta.',
      '"fala": abertura de até 150 palavras. "numeros": de 3 a 6 contagens da semana; "valor" é só o número (ex.: "2", "4") e o contexto vai em "rotulo" (até 8 palavras). Cada item de "funcionou", "travou" e "retrabalho" com a evidência concreta (issue, data).',
      '"melhorias": no formato do IMPROVEMENTS.md do playbook (título, dimensão, o problema hoje, o que seria), só as que a evidência sustenta.',
      `Resumo da semana: ${JSON.stringify(digest).slice(0, 24000)}`,
      SPEECH_RULES,
    ].join('\n'),
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
  if (!retro) throw new Error('retro não encontrada');
  const r = await askAgent<{ fala: string; texto: string }>(
    'deep',
    [`Na retro, o Luiz disse (transcrição por voz): «${question}»`, 'Responda, aprofunde ou proponha; "fala" até 90 palavras.', CHAT_RULES, SPEECH_RULES].join('\n'),
    obj({ fala: str, texto: str }),
    { maxTurns: 10, ...(retro.sessionId ? { resume: retro.sessionId } : {}) },
  );
  retro.sessionId = r.sessionId || retro.sessionId;
  retro.talk.push({ me: true, text: question, at: now() }, { me: false, text: r.data.texto || r.data.fala, speech: r.data.fala, at: now(), ...(r.partial ? { partial: true } : {}) });
  return write(retro);
}
