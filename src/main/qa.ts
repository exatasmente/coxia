import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, QaHandoff } from '../shared/types';
import { askAgent, obj, str } from './agents';
import { answerCeremonyMentions } from './mentions/ceremony';
import { cycle, formatTime, prompt as cp } from './cyclePrompts';
import { ATAS } from './env';
import { issueProjectKey, issueWebUrl, rc } from './workspaceConfig';
import { issueNotesHint } from './vcs/readPolicy';
import { assertExternalWrite } from './workspace';
import { t } from '../shared/i18n';

const DIR = join(ATAS, 'qa');
const IID = /^\d+$/;

function now(): string {
  return formatTime(new Date());
}

function read(iid: string): QaHandoff | null {
  if (!IID.test(iid)) return null;
  try {
    const q = JSON.parse(readFileSync(join(DIR, `${iid}.json`), 'utf8')) as QaHandoff;
    return { ...q, checklistExists: existsSync(q.checklistFile) };
  } catch {
    return null;
  }
}

function write(q: QaHandoff): QaHandoff {
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `${q.iid}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(q, null, 1));
  renameSync(`${file}.tmp`, file);
  return { ...q, checklistExists: existsSync(q.checklistFile) };
}

// How the agent reads the comments of the issue (the provider's own commands); nothing when the workspace has no issue project.
function notesHint(iid: string): string {
  try {
    return issueNotesHint(rc().issues.project ?? issueProjectKey(), iid);
  } catch {
    return '';
  }
}

export function getQa(iid: string): QaHandoff | null {
  return read(iid);
}

export async function prepareQa(card: Card): Promise<QaHandoff> {
  if (!card.spec) throw new Error(t('main.qa.noFolder', { iid: card.iid }));
  const layout = rc().specLayout;
  const testPlans = layout.phaseFiles.map((f) => f.file).filter((f) => /TEST_PLAN/i.test(f));
  const noteUrl = issueWebUrl(card.iid);
  const prompt = cp('qa.prepare', {
    ref: card.ref,
    title: card.title,
    folder: card.spec.folder,
    completion: layout.documents.completion,
    testPlan: testPlans.length ? cp('qa.testPlan', { plans: testPlans.join(cp('qa.or')) }) : '',
    mrs: JSON.stringify(card.mrPaths),
    readHint: cp('qa.readHint', { notesHint: notesHint(card.iid) }),
    skillsLine: cp('qa.skillsLine'),
    words: cycle().ceremonyParams.qaHandoff.speechWords,
    releaseSkillRef: cp('qa.releaseSkillRef'),
    handoff: noteUrl ? cp('qa.handoffWith', { message: cp('qa.handoffMessage', { url: noteUrl }) }) : cp('qa.handoffNone'),
  });
  const r = await askAgent<{
    fala: string;
    mudou: string;
    checklist: { titulo: string; itens: string[] }[];
    riscos: string[];
    ambiente: string;
    nota_qa: number | null;
    teams: string;
  }>(
    'deep',
    prompt,
    obj({
      fala: str,
      mudou: str,
      checklist: { type: 'array', items: obj({ titulo: str, itens: { type: 'array', items: str } }), minItems: 1 },
      riscos: { type: 'array', items: str },
      ambiente: str,
      nota_qa: { type: ['integer', 'null'] },
      teams: str,
    }),
    { maxTurns: 24 },
  );
  return write({
    id: card.iid,
    ref: card.ref,
    iid: card.iid,
    title: card.title,
    stage: card.stage,
    sessionId: r.sessionId || null,
    speech: r.data.fala,
    changed: r.data.mudou,
    checklist: r.data.checklist.map((s) => ({ title: s.titulo, items: s.itens })),
    risks: r.data.riscos,
    environment: r.data.ambiente,
    teams: r.data.teams,
    checklistFile: join(card.spec.folder, layout.documents.qaChecklist),
    checklistExists: false,
    written: null,
    talk: [],
    createdAt: new Date().toISOString(),
  });
}

export async function askQa(iid: string, question: string): Promise<QaHandoff> {
  const q = read(iid);
  if (!q) throw new Error(t('main.qa.notPrepared'));
  const mentioned = await answerCeremonyMentions(question, { thread: q.id, ref: q.ref, title: q.title, msgs: q.talk.map((m) => ({ who: m.me ? 'me' : (m.agent ?? 'app'), text: m.text })) });
  const r = await askAgent<{ fala: string; texto: string }>(
    'deep',
    cp('qa.ask', { ref: q.ref, question }),
    obj({ fala: str, texto: str }),
    { maxTurns: 12, ...(q.sessionId ? { resume: q.sessionId } : {}) },
  );
  q.sessionId = r.sessionId || q.sessionId;
  q.talk.push(
    { me: true, text: question, at: now() },
    ...mentioned.map((m) => ({ me: false, agent: m.agent, text: m.text, speech: m.speech, at: now() })),
    { me: false, text: r.data.texto || r.data.fala, speech: r.data.fala, at: now(), ...(r.partial ? { partial: true } : {}) },
  );
  return write(q);
}

export function writeQaChecklist(iid: string): QaHandoff {
  assertExternalWrite(t('main.qa.whatWrite'));
  const q = read(iid);
  if (!q) throw new Error(t('main.qa.notPrepared'));
  const specs = rc().specsDir;
  if (!specs || !q.checklistFile.startsWith(specs)) throw new Error(t('main.qa.outside'));
  const body = [
    cp('qa.doc.title', { iid: q.iid, title: q.title }),
    '',
    `> ${q.changed.replace(/\n+/g, ' ')}`,
    `>`,
    cp('qa.doc.environment', { environment: q.environment.replace(/\n+/g, ' ') }),
    cp('qa.doc.generated', { date: new Date().toLocaleDateString('sv-SE') }),
    '',
    '---',
    ...q.checklist.flatMap((s, i) => ['', `## ${i + 1}. ${s.title}`, '', ...s.items.map((it) => `- [ ] ${it}`)]),
    ...(q.risks.length ? ['', cp('qa.doc.risks'), '', ...q.risks.map((r) => `- ${r}`)] : []),
    '',
  ].join('\n');
  writeFileSync(q.checklistFile, body);
  q.written = new Date().toISOString();
  return write(q);
}
