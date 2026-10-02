import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';
import { destination } from '../shared/destination';
import type { AgentTurn, Card, DeepAnswer, DeepOption, Decision, DecisionTarget, Minutes, ReplyResult } from '../shared/types';
import type { ModelRole } from '../shared/settings';
import { getLanguage, t } from '../shared/i18n';
import { claudeExecutable, loadClaudeQuery } from './claudeSdk';
import type { ResolvedDocs, ResolvedRole } from './config-resolve';
import { type EngineRequest, type Run, type Schema, type ShellPolicy, MaxTurnsError } from './engine/contract';
import { engineFor, registerEngine, runnerFor } from './engine/registry';
import { type DocSources, type OpenEngineSelection, defaultDocSources, openEngineFromEnv, runOpenOnce } from './engine/open';
import { cardFingerprint, rememberTurn, reusableTurn } from './falas';
import { claudeSdkEnv, providerSecret } from './llm';
import { noteSession } from './sessions';
import { ATAS } from './env';
import { cardContext, cycle, decisionLogRef, destinationLabels, investigationSources, meaningsLine, prompt as cp, text as cycleWord } from './cyclePrompts';
import { docsSources, getConfig, rc } from './workspaceConfig';
import { VCS_MCP_TOOL_NAME, VCS_READ_TOOL_NAME, vcsMcpServer, vcsReadToolImpl } from './vcs/engineTool';
import { GITLAB_HINT, GLAB_READ, vcsReadPolicy, vcsShellEnv } from './vcs/readPolicy';
import { vcsProvider } from './vcs';

export { GLAB_READ };

function trackerMcpTools(): string[] {
  const server = getConfig().agents.tools.trackerMcpServer.trim();
  return server ? [`mcp__${server}__get_issue_details_and_comments`, `mcp__${server}__get_merge_request_details_and_changes`] : [];
}

// Tools pre-approved for a role, from the workspace config; dontAsk denies everything else.
function allowedFor(role: ModelRole): string[] {
  if (role === 'teams') return [];
  const t = getConfig().agents.tools;
  return [
    ...(t.files ? ['Read', 'Grep', 'Glob'] : []),
    ...(t.skills ? ['Skill'] : []),
    ...(t.trackerMcp ? trackerMcpTools() : []),
    ...vcsReadPolicy().rules,
    ...(t.subagents && role === 'deep' ? ['Agent'] : []),
  ];
}

// Conflict calls may also read the post-release-sync mirrors; plumbing reads only, no options that write.
export const GIT_MIRROR_READ = [
  // Arguments never start with a dash except the bare `--`: no --no-index, --output or --ext-diff; no `..` in the repo path.
  /^git -C \/home\/[\w-][\w.-]*\/\.cache\/post-release-sync\/(?!\S*\.\.)[\w./-]+\.git (merge-tree --write-tree( --name-only)?|diff( --stat)?|show( --stat)?|log --oneline( -\d+)?|merge-base)( (--|[\w./:^~][\w./:^~-]*))+$/,
];

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// The same plumbing-only allow-list, for the folder where the release-sync tool keeps its mirrors (releaseSync.mirrorsDir).
export function gitMirrorRead(mirrorsDir: string): RegExp[] {
  const dir = escapeRe(mirrorsDir.replace(/\/+$/, ''));
  return [new RegExp(`^git -C ${dir}\\/(?!\\S*\\.\\.)[\\w./-]+\\.git (merge-tree --write-tree( --name-only)?|diff( --stat)?|show( --stat)?|log --oneline( -\\d+)?|merge-base)( (--|[\\w./:^~][\\w./:^~-]*))+$`)];
}

function mirrorPatterns(): RegExp[] {
  const dir = rc().releaseSync?.mirrorsDir;
  return dir ? gitMirrorRead(dir) : [];
}

// Trailing stderr merge and a head limit only shorten the output, so they are accepted on any allowed command.
export function stripOutputSuffix(command: string): string {
  return command.trim().replace(/( 2>&1)?( \| head -[cn] \d+)?$/, '');
}

export function shellAllowlist(patterns: RegExp[], usage = GITLAB_HINT): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') return {};
    const command = stripOutputSuffix(String((input.tool_input as { command?: unknown }).command ?? ''));
    if (patterns.some((re) => re.test(command)) && !(command.startsWith('git ') && command.split(/[\s:"']+/).some((t) => SECRET_PATH.test(t)))) {
      return {};
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: cp('system.shellDenied', { hints: `${usage}${patterns.some((re) => re.source.startsWith('^git -C')) ? ` ${cp('system.hintGitplumbing')}` : ''}` }),
      },
    };
  };
}

// Agents run on a third-party model: secret files never enter the context.
// A name with secret/credential/token only counts when the file is not source code: TokenService.php and secret.service.ts
// are code, token.json and config/secrets.yml are data. Anything else with such a name (no extension, .bak, .md) is held back.
const CODE_EXT = [
  'php', 'phtml', 'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'py', 'go', 'java', 'kt', 'kts', 'dart', 'rb', 'cs', 'rs', 'swift',
  'c', 'h', 'cc', 'cpp', 'hpp', 'scala', 'ex', 'exs', 'lua', 'pl', 'sh', 'html', 'css', 'scss', 'less',
];
const SECRET_NAME = '(?=[\\s\\S]*(?:secret|credential|token))(?![\\s\\S]*\\.(?:' + CODE_EXT.join('|') + ')$)';
const SECRET_KEYS = '(?:^|\\/)(?:\\.env(?:rc)?(?:$|[./*?])|\\.(?:ssh|config|aws|docker)(?:$|\\/)|\\.(?:netrc|npmrc|pypirc)$|id_(?:rsa|dsa|ecdsa|ed25519)[^/]*$)|\\.env$|(?:^|[\\/_.-])key$|\\.(?:pem|p12|pfx)$|\\.mcp\\.json$|\\.claude\\.json$';
const NAME_RULE = new RegExp(`^${SECRET_NAME}`, 'i');
const KEY_RULE = new RegExp(SECRET_KEYS, 'i');
export const SECRET_PATH = new RegExp(`${NAME_RULE.source}|${KEY_RULE.source}`, 'i');

// SECRET_PATH in gitignore syntax. Read deny rules are the layer that also reaches a Grep or Glob with no path
// (the SDK turns them into case-insensitive ripgrep ignores placed after any glob the model passes); a hook never
// sees what a path-less search will walk. A glob cannot say "unless it is code", so the name rules list the data
// extensions; the hook and the result filter apply the full rule. The ~/ rules cover the home, outside the cwd.
const SECRET_WORDS = ['secret', 'credential', 'token'];
const DATA_EXT = ['json', 'yml', 'yaml', 'txt', 'ini', 'cfg', 'conf', 'toml', 'properties', 'xml'];
export const SECRET_GLOBS = [
  '**/.env*',
  '**/*.env',
  ...SECRET_WORDS.flatMap((w) => DATA_EXT.map((e) => `**/*${w}*.${e}`)),
  '**/.git-credentials',
  '**/key',
  '**/*_key',
  '**/*-key',
  '**/*.key',
  '**/*.pem',
  '**/*.p12',
  '**/*.pfx',
  '**/id_rsa*',
  '**/id_dsa*',
  '**/id_ecdsa*',
  '**/id_ed25519*',
  '**/.ssh/**',
  '**/.config/**',
  '**/.aws/**',
  '**/.docker/**',
  '**/.netrc',
  '**/.npmrc',
  '**/.pypirc',
  '**/.mcp.json',
  '**/.claude.json',
  '~/.ssh/**',
  '~/.config/**',
  '~/.aws/**',
  '~/.docker/**',
  '~/.netrc',
  '~/.npmrc',
  '~/.pypirc',
  '~/.claude.json',
  '~/.claude/*.json',
  '~/.claude/projects/**',
];
export const SECRET_READ_DENY = SECRET_GLOBS.map((g) => `Read(${g})`);

// The Claude Code state in the home holds settings with keys and the transcript of every session.
function inClaudeState(p: string): boolean {
  const base = `${homedir()}/.claude/`;
  if (!p.startsWith(base)) return false;
  const rel = p.slice(base.length);
  return rel.startsWith('projects/') || (!rel.includes('/') && rel.endsWith('.json'));
}

// The path as written, with ~ expanded, absolute against the cwd and with symlinks resolved:
// a link named notes.txt that points at a .env is the .env.
export function secretPath(p: string, cwd = process.cwd()): boolean {
  const home = p === '~' || p.startsWith('~/') ? homedir() + p.slice(1) : p;
  const abs = isAbsolute(home) ? home : resolve(cwd, home);
  const forms = [p, home, abs];
  try {
    forms.push(realpathSync(abs));
  } catch {
    // does not exist: the written forms are all there is
  }
  const dir = isDirectory(abs);
  return forms.some((f) => inClaudeState(f) || KEY_RULE.test(f) || (NAME_RULE.test(f) && !dir));
}

// A directory named tokens/ has no extension to tell code from data: it can be searched, and the results are judged file by file.
function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export const noSecrets: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return {};
  const args = input.tool_input as { file_path?: unknown; path?: unknown; pattern?: unknown; glob?: unknown };
  const paths = [args.file_path, args.path, input.tool_name === 'Glob' ? args.pattern : null, args.glob].filter(
    (p): p is string => typeof p === 'string',
  );
  if (!paths.some((p) => secretPath(p, input.cwd))) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: cp('system.secretDenied'),
    },
  };
};

// Last layer for Grep and Glob: whatever the deny rules let through, a result that names a secret file is cut.
export function withoutSecretFiles(response: unknown, cwd?: string): object | null {
  if (typeof response !== 'object' || response === null) return null;
  const out = response as { filenames?: unknown; content?: unknown };
  const names = Array.isArray(out.filenames) ? (out.filenames as unknown[]) : null;
  const keptNames = names?.filter((n) => typeof n !== 'string' || !secretPath(n, cwd));
  const lines = typeof out.content === 'string' ? out.content.split('\n') : null;
  // A match line is "path:line:text" (context lines "path-line-text"); a file name may hold ':' or '-', so every
  // "[:-]digits[:-]" is tried as the end of the path.
  const keptLines = lines?.filter((l) => {
    for (const m of l.matchAll(/[:-]\d+[:-]/g)) {
      const file = l.slice(0, m.index);
      if (!/\s/.test(file) && secretPath(file, cwd)) return false;
    }
    return true;
  });
  if (keptNames?.length === names?.length && keptLines?.length === lines?.length) return null;
  return {
    ...out,
    ...(keptNames ? { filenames: keptNames, numFiles: keptNames.length } : {}),
    ...(keptLines ? { content: keptLines.join('\n') } : {}),
  };
}

export const redactSecretResults: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PostToolUse' || !/^(Grep|Glob)$/.test(input.tool_name)) return {};
  const clean = withoutSecretFiles(input.tool_response, input.cwd);
  if (!clean) return {};
  if (process.env.CERIMONIAS_DEBUG) console.error('[redacted]', input.tool_name);
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: clean } };
};

export function agentHooks(patterns: RegExp[] = []): NonNullable<Options['hooks']> {
  // The shell allow-list follows the configured provider (gh for GitHub); anything else keeps the glab one, which no tool rule enables.
  const policy = vcsReadPolicy();
  const cli = policy.via === 'cli';
  return {
    PreToolUse: [
      { matcher: 'Bash', hooks: [shellAllowlist([...(cli ? policy.patterns : GLAB_READ), ...patterns], cli ? policy.usage : GITLAB_HINT)] },
      { matcher: 'Read|Grep|Glob', hooks: [noSecrets] },
    ],
    PostToolUse: [{ matcher: 'Grep|Glob', hooks: [redactSecretResults] }],
  };
}

// What the agents are told about the code host; empty when the workspace has none they may read.
function vcsHint(): string {
  return vcsReadPolicy().hint;
}

/** "sz4#15499" for a workspace whose cards carry a prefix, "15499" for one that does not. */
export function issueRef(iid: string | number): string {
  return `${rc().issues.refPrefix}${iid}`;
}

const str = { type: 'string' };
// Up to three ready-made replies: in the call the person may tap one instead of speaking.
const OPTIONS = { type: 'array', items: { type: 'string' }, maxItems: 3 };

function options(list: unknown): string[] {
  return Array.isArray(list) ? list.filter((o): o is string => typeof o === 'string' && !!o.trim()).map((o) => o.trim().slice(0, 120)).slice(0, 3) : [];
}
const strOrNull = { type: ['string', 'null'] };

function obj(properties: Record<string, unknown>): Schema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function source(name: string, input: Record<string, unknown>): string {
  const detail =
    input.command ?? input.file_path ?? input.pattern ?? input.skill ?? input.iid ?? input.issue_iid ?? input.mr_iid ?? input.merge_request_iid ?? '';
  return `${name.replace(/^mcp__[^_]+(?:-[^_]+)*__/, '')} ${String(detail)}`.trim();
}

// The prompt of an agent call: the role preamble (or the workspace's override), the persona, the VCS hints and the extra instructions of the config.
function systemPrompt(role: ModelRole): string {
  const agents = getConfig().agents;
  const preamble = agents.roles[role].promptOverride.trim() || cp('system.role');
  return [preamble, agents.persona.trim(), agents.roles[role].persona.trim(), vcsHint(), agents.extraInstructions.trim(), agents.roles[role].extraInstructions.trim()].filter(Boolean).join('\n');
}

// Which documentation sources of the config a role may read (agents.roles[role].docs): all of them unless the workspace narrowed it.
function docsFor(role: ModelRole): ResolvedDocs {
  const d = docsSources();
  const pick = getConfig().agents.roles[role].docs;
  return {
    ...d,
    claudeMdRoots: pick.claudeMd ? d.claudeMdRoots : [],
    skillsDirs: pick.skills ? d.skillsDirs : [],
    rulesDirs: pick.rules ? d.rulesDirs : [],
    agentsDirs: pick.agents ? d.agentsDirs : [],
    knowledgeDirs: pick.knowledge ? d.knowledgeDirs : [],
    mcpConfigFiles: pick.mcp ? d.mcpConfigFiles : [],
  };
}

// Folders the config lists as documentation but that sit outside the working directory: the agent may read them too.
function extraDirs(cwd: string, role: ModelRole): string[] {
  const d = docsFor(role);
  const listed = [...d.claudeMdRoots, ...d.skillsDirs, ...d.rulesDirs, ...d.agentsDirs, ...d.knowledgeDirs].filter((p) => !d.detected.includes(p));
  return [...new Set(listed.filter((p) => p !== cwd && !p.startsWith(`${cwd}/`)))];
}

// The call as SDK options, which is also the shape the open engine takes: the permissions, hooks and limits are one policy for both engines.
function sdkOptions(req: EngineRequest): Options {
  return {
    cwd: req.cwd,
    // dontAsk denies every tool that allowedTools does not pre-approve.
    permissionMode: 'dontAsk',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: req.system },
    allowedTools: req.allowedTools,
    disallowedTools: [
      ...(vcsReadPolicy().via === 'cli' || req.shell.rules.length ? [] : ['Bash']),
      'Edit',
      'Write',
      'NotebookEdit',
      'WebFetch',
      'WebSearch',
      ...SECRET_READ_DENY,
    ],
    hooks: agentHooks(req.shell.patterns),
    outputFormat: { type: 'json_schema', schema: req.schema },
    maxTurns: 8,
    ...(req.extraDirs.length ? { additionalDirectories: req.extraDirs } : {}),
    ...req.extra,
  };
}

// Documentation sources for the open engine: the config's lists (plus what autoDetect finds); the engine's own defaults when none exist.
function openDocs(cwd: string, role: ModelRole): DocSources {
  const d = docsFor(role);
  const docs: DocSources = { claudeMd: d.claudeMdRoots, skillDirs: d.skillsDirs, agentDirs: d.agentsDirs, docDirs: [...d.rulesDirs, ...d.knowledgeDirs], mcpConfigs: d.mcpConfigFiles };
  return Object.values(docs).some((list) => list.length) ? docs : defaultDocSources(cwd);
}

/** What the open engine needs to reach the provider a role is mapped to: key from the secrets store, probe results from the config. */
export function openSelection(t: ResolvedRole, cwd: string): OpenEngineSelection {
  const c = t.capabilities;
  return {
    provider: {
      baseUrl: t.baseUrl,
      model: t.model,
      apiKey: providerSecret(t.secretRef) ?? undefined,
      lang: getLanguage(),
      ...(Object.keys(t.headers).length ? { headers: t.headers } : {}),
      ...(t.maxOutputTokens !== null ? { maxOutputTokens: t.maxOutputTokens } : {}),
      ...(t.temperature !== null ? { temperature: t.temperature } : {}),
      ...(t.timeoutMs !== null ? { timeoutMs: t.timeoutMs } : {}),
    },
    ...(c ? { capabilities: { tools: c.tools, jsonSchema: c.jsonSchema, ...(c.contextWindow !== null ? { contextWindow: c.contextWindow } : {}) } } : {}),
    structured: t.structured,
    docs: openDocs(cwd, t.role),
  };
}

// Whether this call gets the VcsRead app tool: the code host is read through the app (no CLI), and the call is one that uses tools.
function wantsVcsTool(req: EngineRequest): boolean {
  if (req.role === 'teams' || (Array.isArray(req.extra.tools) && req.extra.tools.length === 0)) return false;
  return vcsReadPolicy().via === 'tool';
}

async function runOpenEngine<T>(req: EngineRequest): Promise<Run<T>> {
  // Test hook (COXIA_ENGINE=open): the same call on the open engine against the server the environment names, with no provider secret read.
  const selection = openEngineFromEnv() ?? openSelection(req.target, req.cwd);
  const tool = wantsVcsTool(req);
  return runOpenOnce<T>({
    selection,
    prompt: req.prompt,
    options: { ...sdkOptions(tool ? { ...req, allowedTools: [...req.allowedTools, VCS_READ_TOOL_NAME] } : req), model: req.target.model },
    extraTools: tool ? [vcsReadToolImpl(() => vcsProvider())] : undefined,
    sessionsDir: join(ATAS, 'open-sessions'),
    secret: { isSecret: (p) => secretPath(p, req.cwd), globs: SECRET_GLOBS },
    shellEnv: vcsShellEnv(),
    describeTool: source,
    events: { onSession: (id) => noteSession(id, req.role, req.prompt) },
    makeMaxTurnsError: (id, src) => new MaxTurnsError(id, src),
  });
}

async function runClaudeSdk<T>(req: EngineRequest): Promise<Run<T>> {
  const sources: string[] = [];
  let sessionId = '';
  const query = await loadClaudeQuery();
  const exe = claudeExecutable();
  // Without a CLI to read the code host with, the agents get the VcsRead app tool as an in-process MCP server.
  const mcp = wantsVcsTool(req) ? await vcsMcpServer(() => vcsProvider()) : null;
  const q = query({
    prompt: req.prompt,
    options: {
      ...sdkOptions(mcp ? { ...req, allowedTools: [...req.allowedTools, VCS_MCP_TOOL_NAME] } : req),
      ...(mcp ? { mcpServers: mcp as NonNullable<Options['mcpServers']> } : {}),
      model: req.target.model,
      env: claudeSdkEnv(req.target),
      ...(exe ? { pathToClaudeCodeExecutable: exe } : {}),
    },
  });
  for await (const m of q) {
    if ('session_id' in m) noteSession(m.session_id, req.role, req.prompt);
    if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
    if (m.type === 'assistant') {
      for (const block of m.message.content) {
        if (block.type !== 'tool_use') continue;
        sources.push(source(block.name, block.input as Record<string, unknown>));
        if (process.env.CERIMONIAS_DEBUG) console.error('[tool]', block.name, JSON.stringify(block.input).slice(0, 300));
      }
    }
    if (process.env.CERIMONIAS_DEBUG && m.type === 'user' && Array.isArray(m.message.content)) {
      for (const block of m.message.content) {
        if (block.type === 'tool_result' && block.is_error) console.error('[tool error]', JSON.stringify(block.content).slice(0, 300));
      }
    }
    if (m.type === 'result') {
      sessionId = m.session_id;
      if (m.subtype === 'error_max_turns') throw new MaxTurnsError(sessionId, sources);
      if (m.subtype !== 'success' || m.structured_output == null) throw new Error(`agent ended with ${m.subtype}`);
      return { data: m.structured_output as T, sessionId, sources };
    }
  }
  throw new Error('agent ended without a result');
}

registerEngine('claude-sdk', runClaudeSdk);
registerEngine('open', runOpenEngine);

// One agent call: the role says which provider and model serve it (llm.roles), the provider says which engine runs it.
async function runOnce<T>(
  role: ModelRole,
  prompt: string,
  schema: Schema,
  extra: Partial<Options> = {},
  shell: ShellPolicy = { rules: [], patterns: [] },
): Promise<Run<T>> {
  // The env hook (COXIA_ENGINE=open) forces the open engine whatever the provider says.
  const target = openEngineFromEnv() ? { ...engineFor(role), engine: 'open' as const } : engineFor(role);
  const cwd = rc().projectsRoot;
  return runnerFor(target)<T>({ role, prompt, schema, target, system: systemPrompt(role), cwd, allowedTools: [...allowedFor(role), ...shell.rules], extraDirs: extraDirs(cwd, role), shell, extra });
}

// An agent that runs out of turns is resumed once, without tools, to answer with what it has; that answer is marked partial.
// The resume stays in the same session transcript, which is what the cost panel reads, so its generations are counted.
async function run<T>(
  role: ModelRole,
  prompt: string,
  schema: Schema,
  extra: Partial<Options> = {},
  shell: ShellPolicy = { rules: [], patterns: [] },
): Promise<Run<T>> {
  // A role may have its own turn limit in the config; the one-turn wrap-up below is never raised by it.
  const cap = getConfig().agents.roles[role].maxTurns;
  try {
    return await runOnce<T>(role, prompt, schema, cap ? { ...extra, maxTurns: cap } : extra, shell);
  } catch (e) {
    if (!(e instanceof MaxTurnsError)) throw e;
    const stopped = cp('system.stopped', { noSession: e.sessionId ? '' : cp('system.noSession') });
    if (!e.sessionId) throw new Error(stopped);
    console.error('[agent] error_max_turns, resuming once for a partial answer', e.sessionId);
    try {
      const r = await runOnce<T>(role, cp('system.wrapUp'), schema, { ...extra, resume: e.sessionId, maxTurns: 2, tools: [], allowedTools: [] }, { rules: [], patterns: shell.patterns });
      return { ...r, sources: [...e.sources, ...r.sources], partial: true };
    } catch (again) {
      console.error('[agent] partial answer failed', again instanceof Error ? again.message : again);
      throw new Error(cp('system.partialFailed', { stopped, reason: again instanceof Error ? again.message : String(again) }));
    }
  }
}

// The model sometimes answers the literal string "null" (or "nenhum") instead of JSON null.
export function nullish(value: string | null): string | null {
  const v = value?.trim() ?? '';
  return !v || /^(null|none|nenhum|nenhuma|n\/a|-)\.?$/i.test(v) ? null : v;
}

export async function prepareTurn(card: Card): Promise<AgentTurn> {
  const same = reusableTurn(card);
  if (same) return same;
  const fp = cardFingerprint(card);
  const c = cycle();
  const pre = c.ceremonyParams.preDaily;
  const prompt = cp('turn.main', {
    ref: card.ref,
    card: cardContext(card),
    specHint: pre.specReads > 0 && c.enrichment.specFolder ? cp('turn.specHint', { reads: pre.specReads }) : '',
    words: pre.speechWords,
    questionLine: c.meanings.question.enabled ? cp('turn.questionOn', { question: cycleWord(c.meanings.question.text) }) : cp('turn.questionOff'),
    meanings: meaningsLine(),
  });
  const schema = obj({ fala: str, andou: str, proximo: str, bloqueio: strOrNull, pergunta: strOrNull, opcoes: OPTIONS });
  const r = await run<{ fala: string; andou: string; proximo: string; bloqueio: string | null; pergunta: string | null; opcoes: string[] }>(
    'turn',
    prompt,
    schema,
  );
  const turn: AgentTurn = {
    ref: card.ref,
    sessionId: r.sessionId || null,
    speech: r.data.fala,
    did: r.data.andou,
    next: r.data.proximo,
    blocker: nullish(r.data.bloqueio),
    question: nullish(r.data.pergunta),
    options: options(r.data.opcoes),
  };
  rememberTurn(card, turn, fp);
  return turn;
}

export async function reply(card: Card, turn: AgentTurn, text: string): Promise<ReplyResult> {
  const targets = [
    cycle().specLayout.decisionLog.heading && cycle().enrichment.specFolder ? cp('reply.targetSpec') : '',
    rc().cardSource?.noteArgs.length ? cp('reply.targetNote') : '',
    cp('reply.targetLog'),
  ]
    .filter(Boolean)
    .join('; ');
  const prompt = cp(
    'reply.main',
    { intro: turn.sessionId ? '' : cp('reply.intro', { card: cardContext(card), speech: turn.speech }), text, targets },
    { keepEmpty: ['intro'] },
  );
  const schema = obj({
    ack: str,
    decisao: { anyOf: [{ type: 'null' }, obj({ texto: str, alvo: { enum: ['spec', 'daily-report', 'ata'] } })] },
    efeito: { anyOf: [{ type: 'null' }, obj({ texto: str, repo: str })] },
    desbloqueio: { type: 'boolean' },
    opcoes: OPTIONS,
  });
  type Out = {
    ack: string;
    decisao: { texto: string; alvo: DecisionTarget } | null;
    efeito: { texto: string; repo: string } | null;
    desbloqueio: boolean;
    opcoes: string[];
  };
  const r = await run<Out>('reply', prompt, schema, { maxTurns: 3, ...(turn.sessionId ? { resume: turn.sessionId } : {}) });
  const target = r.data.decisao?.alvo === 'spec' && !card.spec ? 'ata' : r.data.decisao?.alvo;
  const decision: Decision | null =
    r.data.decisao && target ? { ref: card.ref, text: r.data.decisao.texto, target, dest: destination(card, target, destinationLabels()) } : null;
  return {
    ack: r.data.ack,
    decision,
    effect: r.data.efeito ? { ref: card.ref, text: r.data.efeito.texto, repo: r.data.efeito.repo } : null,
    needsDeepDive: r.data.desbloqueio,
    options: options(r.data.opcoes),
  };
}

export async function deepAsk(card: Card, question: string, sessionId: string | null): Promise<DeepAnswer> {
  const prompt = cp(
    'deep.main',
    {
      intro: sessionId ? '' : cp('deep.intro', { ref: card.ref, sources: investigationSources(), card: cardContext(card) }),
      question,
      words: cycle().ceremonyParams.unblock.speechWords,
    },
    { keepEmpty: ['intro'] },
  );
  const r = await run<{ fala: string; texto: string }>('deep', prompt, obj({ fala: str, texto: str }), {
    maxTurns: 20,
    ...(sessionId ? { resume: sessionId } : {}),
  });
  return { sessionId: r.sessionId, speech: r.data.fala, text: r.data.texto || r.data.fala, sources: r.sources, ...(r.partial ? { partial: true } : {}) };
}

export async function deepOptions(card: Card, sessionId: string): Promise<DeepOption[]> {
  const prompt = cp('deep.options', { ref: card.ref, decisionLog: decisionLogRef() });
  const option = obj({ titulo: str, consequencia: str, efeito: strOrNull, decisao: str, recomendada: { type: 'boolean' } });
  const r = await run<{ opcoes: { titulo: string; consequencia: string; efeito: string | null; decisao: string; recomendada: boolean }[] }>(
    'deep',
    prompt,
    obj({ opcoes: { type: 'array', items: option, minItems: 2, maxItems: 3 } }),
    { maxTurns: 4, resume: sessionId },
  );
  return r.data.opcoes.map((o) => ({
    title: o.titulo,
    consequence: o.consequencia,
    effect: o.efeito,
    decision: o.decisao,
    recommended: o.recomendada,
  }));
}

export async function teamsText(minutes: Minutes, cards: Card[]): Promise<string> {
  const pre = cycle().ceremonyParams.preDaily;
  const prompt = cp('teams.main', {
    target: pre.summaryTarget ? cycleWord(pre.summaryTarget) : cycleWord('cycle.summary.chat'),
    style: cycleWord(pre.summaryStyle),
    activities: JSON.stringify(cards.map((c) => ({ ref: c.ref, titulo: c.title, url: c.url, estagio: c.stage, bloqueios: c.blockers, mudou: c.changes }))),
    decisions: JSON.stringify(minutes.decisions),
    effects: JSON.stringify(minutes.effects),
  });
  const r = await run<{ texto: string }>('teams', prompt, obj({ texto: str }), { maxTurns: 2 });
  return r.data.texto;
}

export async function rewriteQaComment(issue: number, current: string, syncOutput: string, unit: Record<string, unknown> | null): Promise<{ body: string; summary: string }> {
  const prompt = cp(
    'conflict.comment',
    {
      ref: issueRef(issue),
      rulesRef: cp('conflict.comment.rulesRef'),
      pipelinesHint: vcsReadPolicy().via === 'cli' && vcsReadPolicy().kind === 'gitlab' ? cp('conflict.comment.pipelinesHint') : '',
      sync: syncOutput.slice(-4000),
      unit: JSON.stringify(unit ?? {}).slice(0, 4000),
      current,
    },
    { keepEmpty: ['sync', 'current'] },
  );
  const r = await run<{ body: string; resumo: string }>('deep', prompt, obj({ body: str, resumo: str }), { maxTurns: 12 });
  return { body: r.data.body, summary: r.data.resumo };
}

export async function conflictAsk(context: string, question: string, sessionId: string | null): Promise<DeepAnswer> {
  const prompt = cp(
    'conflict.ask',
    {
      intro: sessionId ? '' : cp('conflict.ask.intro', { skillRef: cp('conflict.ask.skillRef'), context }),
      question,
      words: cycle().ceremonyParams.releaseConflicts.speechWords,
    },
    { keepEmpty: ['intro'] },
  );
  const r = await run<{ fala: string; texto: string }>(
    'deep',
    prompt,
    obj({ fala: str, texto: str }),
    { maxTurns: 40, ...(sessionId ? { resume: sessionId } : {}) },
    { rules: ['Bash(git -C:*)'], patterns: mirrorPatterns() },
  );
  return { sessionId: r.sessionId, speech: r.data.fala, text: r.data.texto || r.data.fala, sources: r.sources, ...(r.partial ? { partial: true } : {}) };
}

export interface ProposeHunk {
  id: string;
  file: string;
  ours: string;
  base: string | null;
  theirs: string;
}

export interface Proposal {
  summary: string;
  items: { id: string; resolution: string; explanation: string; confidence: 'alta' | 'media' | 'baixa'; test: string }[];
  // The agent ran out of turns on this batch and proposed from what it had read.
  partial?: boolean;
}

const SIDE_MAX = 12_000;
// One call per batch: a batch is the hunks of one file, split when their text passes BATCH_CHARS.
const BATCH_CHARS = 24_000;
const BATCH_PARALLEL = 3;
const PROMPT_MAX = 40_000;

function clip(text: string | null, left: { n: number }): string {
  if (text === null) return cp('conflict.noBase');
  const max = Math.min(SIDE_MAX, Math.max(left.n, 400));
  left.n -= Math.min(text.length, max);
  return text.length > max ? `${text.slice(0, max)}\n${cp('conflict.clipped', { max, total: text.length })}` : text;
}

type ProposeInput = { issue: number; title: string; mr: string; branch: string; worktree: string; hunks: ProposeHunk[] };

const hunkChars = (h: ProposeHunk) => h.ours.length + h.theirs.length + (h.base?.length ?? 0);

export function proposeBatches(hunks: ProposeHunk[]): ProposeHunk[][] {
  const batches: ProposeHunk[][] = [];
  for (const file of [...new Set(hunks.map((h) => h.file))]) {
    let batch: ProposeHunk[] = [];
    let size = 0;
    for (const h of hunks.filter((x) => x.file === file)) {
      if (batch.length && size + hunkChars(h) > BATCH_CHARS) {
        batches.push(batch);
        batch = [];
        size = 0;
      }
      batch.push(h);
      size += hunkChars(h);
    }
    if (batch.length) batches.push(batch);
  }
  return batches;
}

// Many conflicts in one call made the agent read files to recover clipped text and run out of turns:
// each batch goes alone, a few at a time, and a failed batch only leaves its own hunks without a proposal.
export async function conflictPropose(p: ProposeInput): Promise<Proposal & { failed: string[]; partialIds: string[] }> {
  if (!p.hunks.length) return { summary: t('main.agents.noHunks'), items: [], failed: [], partialIds: [] };
  const batches = proposeBatches(p.hunks);
  const results: (Proposal | null)[] = new Array(batches.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      try {
        results[i] = await proposeBatch({ ...p, hunks: batches[i] });
      } catch (e) {
        console.error('[conflict:propose]', batches[i][0]?.file, (e as Error).message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_PARALLEL, batches.length) }, worker));
  const failed = batches.flatMap((b, i) => (results[i] ? [] : b.map((h) => h.id)));
  if (failed.length === p.hunks.length) throw new Error(t('main.agents.noProposal'));
  const summaries = results.filter((r): r is Proposal => !!r).map((r) => r.summary.trim()).filter(Boolean);
  return {
    summary: [summaries.length > 1 ? summaries.map((x, i) => `${i + 1}. ${x}`).join(' ') : summaries[0] ?? '', failed.length ? t('main.agents.someFailed', { count: failed.length }) : ''].filter(Boolean).join(' '),
    items: results.flatMap((r) => r?.items ?? []),
    failed,
    partialIds: batches.flatMap((b, i) => (results[i]?.partial ? b.map((h) => h.id) : [])),
  };
}

async function proposeBatch(p: ProposeInput): Promise<Proposal> {
  const left = { n: PROMPT_MAX };
  const blocks = p.hunks.map((h) =>
    cp('conflict.hunk', { id: h.id, file: h.file, ours: clip(h.ours, left), base: clip(h.base, left), theirs: clip(h.theirs, left) }, { keepEmpty: ['ours', 'base', 'theirs'] }),
  );
  const prompt = cp('conflict.propose', { ref: issueRef(p.issue), title: p.title, mr: p.mr, branch: p.branch, worktree: p.worktree, blocks: blocks.join('\n\n') });
  const item = obj({ id: str, resolucao: str, explicacao: str, confianca: { enum: ['alta', 'media', 'baixa'] }, testar: str });
  const r = await run<{ resumo: string; trechos: { id: string; resolucao: string; explicacao: string; confianca: 'alta' | 'media' | 'baixa'; testar: string }[] }>(
    'deep',
    prompt,
    obj({ resumo: str, trechos: { type: 'array', items: item } }),
    { maxTurns: 12, additionalDirectories: [p.worktree] },
  );
  return {
    summary: r.data.resumo,
    ...(r.partial ? { partial: true } : {}),
    items: r.data.trechos.map((t) => ({ id: t.id, resolution: t.resolucao, explanation: t.explicacao, confidence: t.confianca, test: t.testar })),
  };
}

// Structured agent call for the other ceremony modules (gate, QA handoff, retro).
export { run as askAgent, obj, str, strOrNull };
