import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, QaHandoff } from '../shared/types';
import { CHAT_RULES, SPEECH_RULES, askAgent, obj, str } from './agents';
import { ATAS, GITLAB, SPECS } from './env';
import { assertExternalWrite } from './workspace';

const DIR = join(ATAS, 'qa');
const IID = /^\d+$/;

function now(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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

export function getQa(iid: string): QaHandoff | null {
  return read(iid);
}

export async function prepareQa(card: Card): Promise<QaHandoff> {
  if (!card.spec) throw new Error(`a #${card.iid} não tem pasta no .specs`);
  const prompt = [
    `Passagem para o QA da issue ${card.ref} (${card.title}), por voz. Você explica ao QA o que mudou e o que testar.`,
    `Leia em ${card.spec.folder}: ISSUE_COMPLETION.md (Testes do Desenvolvedor e checklist de impacto), o TEST_PLAN (bug/3_TEST_PLAN.md ou feat/4_TEST_PLAN.md), o Plan e o que precisar.`,
    `MRs: ${JSON.stringify(card.mrPaths)}. Leia o diff pelo MCP do GitLab e os comentários da issue com glab api projects/sz4%2Fsz4/issues/${card.iid}/notes, procurando a nota "@qa.interno" (branch de release e pipelines).`,
    'Skills de referência: qa-release-branch (texto do Teams) e testar-atividade-gitlab (cenário: objetivo, precondições, ações, resultado esperado, evidência).',
    '"fala": até 150 palavras para o QA ouvir: o que mudou para o usuário, onde testar, o que mais pode quebrar.',
    '"mudou": um parágrafo em linguagem de produto, sem nome de classe.',
    '"checklist": seções (ex.: "Cenários principais (fluxo feliz)", "Regressão", "Bordas") com itens verificáveis, cada um com ação e resultado esperado.',
    '"riscos": o que pode quebrar além do fluxo corrigido. "ambiente": branch de release, pipeline e jobs de deploy pela nota do QA; se não houver nota, diga que a branch de release ainda não foi criada (skill qa-release-branch).',
    `"nota_qa": o id da nota @qa.interno mais recente, ou null. "teams": se houver nota, exatamente "Bom dia!\\n\\nAtividades disponíveis para testes :\\nhttps://${GITLAB}/sz4/sz4/-/work_items/${card.iid}#note_<id>"; sem nota, "".`,
    SPEECH_RULES,
  ].join('\n');
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
    checklistFile: join(card.spec.folder, 'QA_CHECKLIST.md'),
    checklistExists: false,
    written: null,
    talk: [],
    createdAt: new Date().toISOString(),
  });
}

export async function askQa(iid: string, question: string): Promise<QaHandoff> {
  const q = read(iid);
  if (!q) throw new Error('passagem para o QA não preparada');
  const r = await askAgent<{ fala: string; texto: string }>(
    'deep',
    [`Pergunta do QA ou do Luiz na passagem da ${q.ref} (transcrição por voz): «${question}»`, '"fala": até 90 palavras.', CHAT_RULES, SPEECH_RULES].join('\n'),
    obj({ fala: str, texto: str }),
    { maxTurns: 12, ...(q.sessionId ? { resume: q.sessionId } : {}) },
  );
  q.sessionId = r.sessionId || q.sessionId;
  q.talk.push({ me: true, text: question, at: now() }, { me: false, text: r.data.texto || r.data.fala, speech: r.data.fala, at: now() });
  return write(q);
}

export function writeQaChecklist(iid: string): QaHandoff {
  assertExternalWrite('gravar o checklist de QA na spec');
  const q = read(iid);
  if (!q) throw new Error('passagem para o QA não preparada');
  if (!q.checklistFile.startsWith(SPECS)) throw new Error('checklist fora do .specs');
  const body = [
    `# QA Checklist — #${q.iid} ${q.title}`,
    '',
    `> ${q.changed.replace(/\n+/g, ' ')}`,
    `>`,
    `> **Ambiente:** ${q.environment.replace(/\n+/g, ' ')}`,
    `> Gerado na passagem para o QA por voz (${new Date().toLocaleDateString('sv-SE')}).`,
    '',
    '---',
    ...q.checklist.flatMap((s, i) => ['', `## ${i + 1}. ${s.title}`, '', ...s.items.map((it) => `- [ ] ${it}`)]),
    ...(q.risks.length ? ['', '## Riscos', '', ...q.risks.map((r) => `- ${r}`)] : []),
    '',
  ].join('\n');
  writeFileSync(q.checklistFile, body);
  q.written = new Date().toISOString();
  return write(q);
}
