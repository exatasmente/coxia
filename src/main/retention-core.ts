import { RETENTION_LABEL, type RetentionKind } from '../shared/retention';

export const DAY = 86_400_000;
// A transcript touched this recently may still be in use, whatever the retention says.
export const RECENT_MS = DAY;
export const APP_ENTRYPOINT = 'sdk-ts';

// A session belongs to the app only when its first prompt starts like one the app sends (src/main/{agents,gate,qa,retro,feedback}.ts).
// Anything else, including sessions that look similar, is the user's own work and is never listed.
const APP_PROMPTS: [RegExp, string][] = [
  [/^Você é o agente da atividade /, 'fala do agente'],
  [/^Desbloqueio (?:por voz|em texto) da atividade /, 'desbloqueio'],
  [/^Gate [12] da issue /, 'gate'],
  [/^Avalie uma resposta livre a uma pergunta de quiz de gate/, 'gate'],
  [/^Leitura assistida do ciclo de consolidação/, 'gate'],
  [/^Produza o recurso visual do ciclo de consolidação/, 'gate'],
  [/^Nova rodada do quiz do Gate /, 'gate'],
  [/^Passagem para o QA da issue /, 'passagem para o QA'],
  [/^Pergunta do QA ou do Luiz na passagem /, 'passagem para o QA'],
  [/^Retro semanal do Luiz, (?:por voz|em texto)/, 'retro'],
  [/^Na retro, o Luiz disse /, 'retro'],
  [/^Escreva o texto que o Luiz vai colar no Teams/, 'texto do Teams'],
  [/^A issue \S*\d+ foi sincronizada com a main depois de uma release/, 'sincronização com a release'],
  [/^(?:Call|Conversa) sobre um conflito de sincronização com a main/, 'sincronização com a release'],
  [/^(?:Call|Conversa) de reentrada da issue /, 'reentrada'],
  [/^Revisão do MR \S+ \(issue /, 'revisão de MR'],
  [/^Com base no que você investigou sobre /, 'desbloqueio'],
  [/^O Luiz respondeu (?:por voz |por escrito)/, 'fala do agente'],
];

export function appPromptKind(firstPrompt: string | null | undefined): string | null {
  if (!firstPrompt) return null;
  return APP_PROMPTS.find(([re]) => re.test(firstPrompt))?.[1] ?? null;
}

export interface RetentionRef {
  sessionId: string;
  // When the thing that mentions the session was last alive (ms).
  at: number;
  // The thing that mentions it is marked to be kept: the session is too, whatever the age.
  keep: boolean;
  from: string;
}

export interface RetentionFile {
  kind: RetentionKind;
  path: string;
  size: number;
  mtimeMs: number;
  // Session transcripts only.
  sessionId?: string;
  firstPrompt?: string | null;
  // Every entrypoint found in the transcript: a session the user resumed in the CLI has more than the SDK's.
  entrypoints?: string[];
  // Data files only: the user asked to keep it.
  keep?: boolean;
}

export interface Verdict {
  file: RetentionFile;
  remove: boolean;
  reason: string;
}

export interface Selection {
  remove: Verdict[];
  keep: Verdict[];
}

function when(ms: number, now: number): string {
  const d = Math.floor((now - ms) / DAY);
  return `sem alteração há ${d} dia${d === 1 ? '' : 's'}`;
}

function name(path: string): string {
  return path.split('/').slice(-1)[0];
}

export function selectRetention(files: RetentionFile[], refs: RetentionRef[], opts: { now: number; days: number }): Selection {
  const { now, days } = opts;
  const cutoff = now - days * DAY;
  const out: Selection = { remove: [], keep: [] };
  const decide = (file: RetentionFile, remove: boolean, reason: string) => (remove ? out.remove : out.keep).push({ file, remove, reason });

  for (const file of files) {
    if (file.kind !== 'sessoes') {
      if (file.keep) decide(file, false, 'marcado para manter');
      else if (now - file.mtimeMs < RECENT_MS) decide(file, false, 'alterado nas últimas 24 h');
      else if (file.mtimeMs >= cutoff) decide(file, false, 'dentro do prazo');
      else decide(file, true, `${RETENTION_LABEL[file.kind].toLowerCase()}, ${when(file.mtimeMs, now)}`);
      continue;
    }

    const kind = appPromptKind(file.firstPrompt);
    if (!kind) {
      decide(file, false, 'não é do app: o primeiro prompt não é de nenhum agente');
      continue;
    }
    const foreign = (file.entrypoints ?? []).filter((e) => e !== APP_ENTRYPOINT);
    if (!(file.entrypoints ?? []).includes(APP_ENTRYPOINT)) {
      decide(file, false, 'não é do app: sem registro de execução pelo SDK');
      continue;
    }
    if (foreign.length) {
      decide(file, false, `continuada fora do app (${foreign.join(', ')})`);
      continue;
    }
    if (now - file.mtimeMs < RECENT_MS) {
      decide(file, false, 'alterada nas últimas 24 h');
      continue;
    }
    if (file.mtimeMs >= cutoff) {
      decide(file, false, 'dentro do prazo');
      continue;
    }
    const live = refs.find((r) => r.sessionId === file.sessionId && (r.keep || r.at >= cutoff));
    if (live) {
      decide(file, false, `usada por ${live.from}, ainda dentro do prazo`);
      continue;
    }
    decide(file, true, `sessão do app (${kind}), ${when(file.mtimeMs, now)}, sem cerimônia no prazo que a use`);
  }
  return out;
}

export function entrypointsOf(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/"entrypoint":"([^"]*)"/g)) found.add(m[1]);
  return [...found];
}

export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

export function fileName(path: string): string {
  return name(path);
}
