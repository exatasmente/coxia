import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, QaHandoff } from '../shared/types';
import { chatRules, speechRules, askAgent, obj, qaMention, str } from './agents';
import { callWord, heardText, modeText } from './agentVoice';
import { ATAS } from './env';
import { issueProjectPath, issueWebUrl, rc } from './workspaceConfig';
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
  const layout = rc().specLayout;
  const testPlans = layout.phaseFiles.map((f) => f.file).filter((f) => /TEST_PLAN/i.test(f));
  const noteUrl = issueWebUrl(card.iid);
  const prompt = [
    `Passagem para o QA da issue ${card.ref} (${card.title}), ${modeText()}. Você explica ao QA o que mudou e o que testar.`,
    `Leia em ${card.spec.folder}: ${layout.documents.completion} (Testes do Desenvolvedor e checklist de impacto)${testPlans.length ? `, o plano de testes (${testPlans.join(' ou ')})` : ''}, o Plan e o que precisar.`,
    `MRs: ${JSON.stringify(card.mrPaths)}. Leia o diff pelo MCP do GitLab e os comentários da issue com glab api projects/${issueProjectPath()}/issues/${card.iid}/notes, procurando a nota "${qaMention()}" (branch de release e pipelines).`,
    'Skills de referência: qa-release-branch (texto do Teams) e testar-atividade-gitlab (cenário: objetivo, precondições, ações, resultado esperado, evidência).',
    '"fala": até 150 palavras para o QA ouvir: o que mudou para o usuário, onde testar, o que mais pode quebrar.',
    '"mudou": um parágrafo em linguagem de produto, sem nome de classe.',
    '"checklist": seções (ex.: "Cenários principais (fluxo feliz)", "Regressão", "Bordas") com itens verificáveis, cada um com ação e resultado esperado.',
    '"riscos": o que pode quebrar além do fluxo corrigido. "ambiente": branch de release, pipeline e jobs de deploy pela nota do QA; se não houver nota, diga que a branch de release ainda não foi criada (skill qa-release-branch).',
    `"nota_qa": o id da nota ${qaMention()} mais recente, ou null. "teams": ${noteUrl ? `se houver nota, exatamente "Bom dia!\\n\\nAtividades disponíveis para testes :\\n${noteUrl}#note_<id>"; sem nota, ""` : '""'}.`,
    speechRules(),
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
    checklistFile: join(card.spec.folder, layout.documents.qaChecklist),
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
    [`Pergunta do QA ou do Luiz na passagem da ${q.ref} (${heardText()}): «${question}»`, '"fala": até 90 palavras.', chatRules(), speechRules()].join('\n'),
    obj({ fala: str, texto: str }),
    { maxTurns: 12, ...(q.sessionId ? { resume: q.sessionId } : {}) },
  );
  q.sessionId = r.sessionId || q.sessionId;
  q.talk.push({ me: true, text: question, at: now() }, { me: false, text: r.data.texto || r.data.fala, speech: r.data.fala, at: now(), ...(r.partial ? { partial: true } : {}) });
  return write(q);
}

export function writeQaChecklist(iid: string): QaHandoff {
  assertExternalWrite('gravar o checklist de QA na spec');
  const q = read(iid);
  if (!q) throw new Error('passagem para o QA não preparada');
  const specs = rc().specsDir;
  if (!specs || !q.checklistFile.startsWith(specs)) throw new Error('checklist fora da pasta de specs');
  const body = [
    `# QA Checklist — #${q.iid} ${q.title}`,
    '',
    `> ${q.changed.replace(/\n+/g, ' ')}`,
    `>`,
    `> **Ambiente:** ${q.environment.replace(/\n+/g, ' ')}`,
    `> Gerado na passagem para o QA ${modeText()} (${new Date().toLocaleDateString('sv-SE')}).`,
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
