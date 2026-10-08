import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';
import { destination } from '../shared/destination';
import type { UsageReport } from '../shared/runs/usage';
import type { AgentTurn, Card, DeepAnswer, DeepOption, Decision, DecisionTarget, Minutes, ReplyResult, TurnOptions } from '../shared/types';
import type { AgentDef, AgentToolsConfig } from '../shared/config/types';
import { toolsForAgent } from '../shared/config/team';
import type { AttachmentRef } from '../shared/attachments';
import type { ModelRole } from '../shared/settings';
import { getLanguage, t } from '../shared/i18n';
import { type RunActivity, beginActivity } from './activity';
import { claudeExecutable, loadClaudeQuery } from './claudeSdk';
import type { ResolvedDocs, ResolvedRole } from './config-resolve';
import { type CommandAsk, type Confinement, type EngineRequest, type ReadConfinement, type Run, type Schema, type ShellPolicy, MaxTurnsError, ProviderBudgetError } from './engine/contract';
import { ceremonyCommands } from './ceremonyCommands';
import { isHostWrite, rulesAllow } from '../shared/ceremonyCommands';
import { budgetText, clipProviderText } from './engine/budget';
import { redact } from './errorlog-core';
import { credentialNames } from './engine/guard';
import { engineFor, registerEngine, runnerFor } from './engine/registry';
import { scrubShellHooks } from './engine/scrubShell';
import { type DocSources, type OpenEngineSelection, defaultDocSources, openEngineFromEnv, runOpenOnce } from './engine/open';
import { cardSnapshot, recordReuse, rememberTurn, reusableTurn } from './falas';
import { deltaText, earlierMeetings, earlierText, infoOf, judge, timeOf, unchangedTurn } from './sameDay';
import { claudeSdkEnv, providerSecret } from './llm';
import { loginPath, mergedPath } from './loginPath';
import { noteSession } from './sessions';
import { ATAS } from './env';
import { priorityChoices, priorityDecision, priorityRule } from './priority';
import { cardContext, cycle, decisionLogRef, priorityLine, destinationLabels, investigationSources, meaningsLine, prompt as cp, text as cycleWord } from './cyclePrompts';
import { docsSources, getConfig, rc } from './workspaceConfig';
import { type DocsAsk, harnessSection } from './harness/deliver';
import { answerCeremonyMentions } from './mentions/ceremony';
import { VCS_MCP_TOOL_NAME, VCS_READ_TOOL_NAME, vcsMcpServer, vcsReadToolImpl } from './vcs/engineTool';
import { RELEASE_MCP_TOOL_NAME, RELEASE_TOOL_NAME } from '../shared/release';
import { keepAlive, releaseMcpServer, releaseToolImpl } from './releaseTool';
import { runnerMcpServer, runnerMcpToolName } from './runner/tools';
import type { ToolImpl } from './engine/open/tools/types';
import { GLAB_READ, vcsReadPolicy, vcsShellEnv } from './vcs/readPolicy';
import { vcsProvider, vcsReady } from './vcs';
import { shellMcpServer, shellToolImpl, viewImageToolImpl } from './sandbox/engineTool';
import { EVIDENCE_TOOL_NAMES, evidenceMcpServer, evidenceToolImpls } from './evidence/engineTool';
import { evidenceMcpToolName } from './evidence/tool';
import type { EvidenceTools } from './evidence/tool';
import { incomingActivity, incomingText } from './engine/incoming';
import { SHELL_MCP_TOOL_NAME, SHELL_TOOL_NAME, VIEW_IMAGE_MCP_TOOL_NAME, VIEW_IMAGE_TOOL_NAME, offersViewImage } from './sandbox/tool';
import { ATTACHMENT_TOOL } from '../shared/attachments';
import { ATTACHMENT_MCP_TOOL_NAME, attachmentMcpServer, attachmentToolImpl } from './attachmentTool';
import type { SandboxSession } from './sandbox/session';

export { GLAB_READ };

/** The projects of the code host the workspace works with (a team agent of a run, which sets `tracker`, is refused when there are none; the ceremonies are not): its issue project and the project of each repository (what the cards are limited to). */
export function workspaceProjects(): string[] {
  const issues = rc().issues.project;
  return [...new Set([...(issues ? [issues] : []), ...rc().repos.flatMap((r) => (r.projectPath ? [r.projectPath] : []))])];
}

function trackerMcpTools(tools: AgentToolsConfig): string[] {
  const server = tools.trackerMcpServer.trim();
  return server ? [`mcp__${server}__get_issue_details_and_comments`, `mcp__${server}__get_merge_request_details_and_changes`] : [];
}

// Tools pre-approved for a role, from the workspace config (or the agent's own when it names them); dontAsk denies everything else.
export function allowedFor(role: ModelRole, host = true, tools?: AgentToolsConfig): string[] {
  if (role === 'teams') return [];
  const t = tools ?? getConfig().agents.tools;
  return [
    ...(t.files ? ['Read', 'Grep', 'Glob'] : []),
    ...(t.skills ? ['Skill'] : []),
    ...(host && t.trackerMcp ? trackerMcpTools(t) : []),
    ...(host ? vcsReadPolicy().rules : []),
    ...(t.subagents && role === 'deep' ? ['Agent'] : []),
  ];
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// Conflict calls may also read the folder where the release-sync tool keeps its mirrors (releaseSync.mirrorsDir); plumbing reads only, no options that write.
// Arguments never start with a dash except the bare `--`: no --no-index, --output or --ext-diff; no `..` in the repo path.
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

// What the agent is told when the shell refuses a command: the commands of the code host it may read, plumbing git in a conflict call, and
// when the workspace has neither, that no read command is open.
function shellDenial(usage: string, plumbing: string): string {
  const hints = [usage, plumbing].filter(Boolean).join(' ');
  return hints ? cp('system.shellDenied', { hints }) : cp('system.shellDeniedNone');
}

const decided = (decision: 'allow' | 'deny', reason: string) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: decision, permissionDecisionReason: reason } });

/**
 * The shell of an agent that reads: the commands the code allows (the code host reads, plumbing git in a conflict call) run; a git command that names a secret
 * path never does. With `ask` (a ceremony agent), anything else is not refused but asked of the person, and the call waits: the rules the person gave the agent
 * let a command through without asking, except a write to the code host, which is asked every time.
 */
export function shellAllowlist(patterns: RegExp[], usage: string, ask?: CommandAsk): HookCallback {
  const plumbing = (): string => (patterns.some((re) => re.source.startsWith('^git -C')) ? cp('system.hintGitplumbing') : '');
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') return {};
    const raw = String((input.tool_input as { command?: unknown }).command ?? '').trim();
    const command = stripOutputSuffix(raw);
    const secret = command.startsWith('git ') && command.split(/[\s:"']+/).some((t) => SECRET_PATH.test(t));
    if (patterns.some((re) => re.test(command)) && !secret) return {};
    if (ask && !secret) {
      if (!isHostWrite(raw) && rulesAllow(ask.rules, raw)) return decided('allow', cp('system.shellAllowedByRule'));
      const answer = await ask.request(raw);
      if (answer.ok) return decided('allow', cp('system.shellAllowedByPerson'));
      return decided('deny', answer.note ? cp('system.shellRefusedByPersonNote', { note: answer.note }) : cp('system.shellRefusedByPerson'));
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: shellDenial(usage, plumbing()),
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

// A Glob or Grep with no path from a folder that holds many repositories walks all of them (node_modules, worktrees…)
// and takes minutes: the agent is sent back to search inside one repository.
const repoCounts = new Map<string, { at: number; repos: string[] }>();

function reposUnder(root: string): string[] {
  const hit = repoCounts.get(root);
  if (hit && Date.now() - hit.at < 60_000) return hit.repos;
  let repos: string[] = [];
  try {
    repos = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(root, d.name, '.git')))
      .map((d) => d.name);
  } catch {
    repos = [];
  }
  repoCounts.set(root, { at: Date.now(), repos });
  return repos;
}

export const noBroadSearch: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse' || !/^(Grep|Glob)$/.test(input.tool_name)) return {};
  const args = input.tool_input as { path?: unknown; pattern?: unknown; glob?: unknown; type?: unknown };
  const root = resolve(input.cwd ?? '.', typeof args.path === 'string' && args.path.trim() ? args.path : '.');
  const repos = reposUnder(root);
  if (repos.length < 2) return {};
  // A Glob whose pattern already starts inside one repository ("repo/**/x") is fine.
  if (input.tool_name === 'Glob' && typeof args.pattern === 'string' && repos.some((r) => args.pattern === r || (args.pattern as string).startsWith(`${r}/`))) return {};
  const sample = repos.slice(0, 3).map((r) => join(root, r)).join(', ');
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: cp('system.broadSearch', { root, hint: sample ? ` (${sample}…)` : '' }),
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

export function agentHooks(patterns: RegExp[] = [], host = true, ask?: CommandAsk): NonNullable<Options['hooks']> {
  // The shell allow-list follows the configured provider (glab for GitLab, gh for GitHub); a host with no CLI (Bitbucket, an API-only integration)
  // reads through the app's tool and has no shell command to allow, and it is not told about a CLI it does not have.
  const policy = vcsReadPolicy();
  const cli = host && policy.via === 'cli';
  return {
    PreToolUse: [
      { matcher: 'Bash', hooks: [shellAllowlist([...(cli ? policy.patterns : []), ...patterns], policy.usage, ask)] },
      { matcher: 'Read|Grep|Glob', hooks: [noSecrets] },
      { matcher: 'Grep|Glob', hooks: [noBroadSearch] },
    ],
    PostToolUse: [{ matcher: 'Grep|Glob', hooks: [redactSecretResults] }],
  };
}

// A call a hook refuses is reported to the run's activity: the person sees "blocked" next to the call, never the reason the agent was given.
function reportBlocked(hooks: NonNullable<Options['hooks']>, onBlocked: (call: string) => void): NonNullable<Options['hooks']> {
  const wrap =
    (hook: HookCallback): HookCallback =>
    async (input, id, opts) => {
      const out = await hook(input, id, opts);
      const decision = (out as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision;
      if (input.hook_event_name === 'PreToolUse' && decision === 'deny') onBlocked(source(input.tool_name, input.tool_input as Record<string, unknown>));
      return out;
    };
  return Object.fromEntries(Object.entries(hooks).map(([event, groups]) => [event, groups?.map((g) => ({ ...g, hooks: g.hooks.map(wrap) }))])) as NonNullable<Options['hooks']>;
}

// What the agents are told about the code host; empty when the workspace has none they may read.
function vcsHint(): string {
  return vcsReadPolicy().hint;
}

/** "app#101" for a workspace whose cards carry a prefix, "101" for one that does not. */
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
function docsFor(role: ModelRole, opts: { claude?: boolean } = {}): ResolvedDocs {
  const d = docsSources(opts);
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
function extraDirs(cwd: string, role: ModelRole, opts: { claude?: boolean } = {}): string[] {
  const d = docsFor(role, opts);
  const listed = [...d.claudeMdRoots, ...d.skillsDirs, ...d.rulesDirs, ...d.agentsDirs, ...d.knowledgeDirs].filter((p) => !d.detected.includes(p));
  return [...new Set(listed.filter((p) => p !== cwd && !p.startsWith(`${cwd}/`)))];
}

/**
 * The documentation folders outside the working directory that a reading agent of a run may still reach: the same list the engine is given as
 * additional directories, so what the engine sees and what the guard allows cannot diverge. Empty when the working directory is empty or relative:
 * a relative root is not a root to confine anything to.
 */
export function extraReadRoots(cwd: string, role: ModelRole): string[] {
  if (!isAbsolute(cwd)) return [];
  return extraDirs(cwd, role, { claude: false }).filter((p) => isAbsolute(p) && p !== cwd && !p.startsWith(`${cwd}/`));
}

// The call as SDK options, which is also the shape the open engine takes: the permissions, hooks and limits are one policy for both engines.
// A call with `confine` is an agent that changes files inside its run's worktree: it gets Edit and Write, the hooks of the confinement
// instead of the read-only ones, and a shell only for the exact commands it was given. Everything else stays denied.
// A call with `read` instead is an agent of a run that only reads: the hooks that confine its file tools, and its documentation folders added
// to the directories the engine may look at. It opens no tool: `Edit`/`Write`, the shell and the VCS read are decided by `confine` alone.
function sdkOptions(req: EngineRequest): Options {
  const confine = req.confine;
  const read = req.read;
  // A call with no code host read has no CLI to allow either: its shell is whatever commands it was given.
  const host = (req.tracker ?? 'workspace') === 'workspace';
  const hooks = confine ? confine.hooks : read ? read.hooks : agentHooks(req.shell.patterns, host, req.ask);
  // A ceremony agent that may ask has the whole shell: the hook decides every command (allowed, a rule, or the person's answer).
  const asks = !confine && !!req.ask;
  const shellOff = asks ? false : confine ? !req.shell.rules.length : !((host && vcsReadPolicy().via === 'cli') || req.shell.rules.length);
  const dirs = [...req.extraDirs, ...(read?.roots ?? [])];
  return {
    cwd: req.cwd,
    // dontAsk denies every tool that allowedTools does not pre-approve.
    permissionMode: 'dontAsk',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: req.system },
    allowedTools: asks ? [...req.allowedTools.filter((t) => !t.startsWith('Bash(')), 'Bash'] : req.allowedTools,
    disallowedTools: [
      ...(shellOff ? ['Bash'] : []),
      ...(confine ? [] : ['Edit', 'Write']),
      'NotebookEdit',
      'WebFetch',
      'WebSearch',
      ...SECRET_READ_DENY,
    ],
    hooks: req.activity ? reportBlocked(hooks, (call) => req.activity?.blocked(call)) : hooks,
    outputFormat: { type: 'json_schema', schema: req.schema },
    maxTurns: 8,
    // An agent of the team reads the documentation the app hands it and none of Claude Code's: no CLAUDE.md or .claude/ of the project or the home, no settings
    // files, no automatic memory (which is the person's, not the project's). What the call needs from them the app passes itself (permissions, hooks, model, env).
    ...(req.isolated ? { settingSources: [], settings: { autoMemoryEnabled: false } } : {}),
    ...(dirs.length ? { additionalDirectories: dirs } : {}),
    ...(req.abort ? { abortController: req.abort } : {}),
    ...req.extra,
  };
}

// Documentation sources for the open engine: the config's lists (plus what autoDetect finds); the engine's own defaults when none exist. An isolated call never
// falls back to them: its lists are the ones the person wrote (and the project's `.mcp.json`), always defined, because an empty list is not an absent one.
function openDocs(cwd: string, role: ModelRole, isolated = false): DocSources {
  const d = docsFor(role, isolated ? { claude: false } : {});
  const docs: DocSources = { claudeMd: d.claudeMdRoots, skillDirs: d.skillsDirs, agentDirs: d.agentsDirs, docDirs: [...d.rulesDirs, ...d.knowledgeDirs], mcpConfigs: d.mcpConfigFiles };
  return isolated || Object.values(docs).some((list) => list.length) ? docs : defaultDocSources(cwd);
}

/** What the open engine needs to reach the provider a role is mapped to: key from the secrets store, probe results from the config. */
export function openSelection(t: ResolvedRole, cwd: string, isolated = false): OpenEngineSelection {
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
    ...(c ? { capabilities: { tools: c.tools, jsonSchema: c.jsonSchema, ...(c.contextWindow !== null ? { contextWindow: c.contextWindow } : {}), ...(c.images !== undefined ? { images: c.images } : {}) } } : {}),
    structured: t.structured,
    docs: openDocs(cwd, t.role, isolated),
  };
}

// Whether this call gets the VcsRead app tool: the code host is read through the app (no CLI), and the call is one that uses tools.
function wantsVcsTool(req: EngineRequest): boolean {
  if (req.role === 'teams' || (Array.isArray(req.extra.tools) && req.extra.tools.length === 0)) return false;
  const mode = req.tracker ?? 'workspace';
  if (mode === 'none') return false;
  // An agent of a run reads the host through the tool only, whichever read path the workspace has; the tool needs one of the host-read switches of the agent on. The
  // workspace's own read path decides every other call: an agent naming its tools may turn a tool off, never move the read of the host to another path.
  if (mode === 'tool') {
    const tools = req.tools ?? getConfig().agents.tools;
    return (tools.vcsCli || tools.trackerMcp) && vcsReady();
  }
  return !req.confine && vcsReadPolicy().via === 'tool';
}

/** The PATH the commands of an agent start with: the one of the person's login shell in front of the app's, so `npm` and the tools the repository's scripts use are found. */
async function commandPath(): Promise<Record<string, string>> {
  const path = mergedPath(await loginPath.resolve(), process.env);
  return path ? { PATH: path } : {};
}

async function runOpenEngine<T>(req: EngineRequest): Promise<Run<T>> {
  // Test hook (COXIA_ENGINE=open): the same call on the open engine against the server the environment names, with no provider secret read. The hook carries no
  // `docs`, which the bridge would fill with the defaults (CLAUDE.md up the tree, ~/.claude): an isolated call gets its own lists whichever way the selection came.
  const hook = openEngineFromEnv();
  const selection = hook ? (req.isolated ? { ...hook, docs: openDocs(req.cwd, req.target.role, true) } : hook) : openSelection(req.target, req.cwd, req.isolated);
  const tool = wantsVcsTool(req);
  // One `ViewImage`, the sandbox's: a stage that keeps evidence gets it with evidence ids added.
  const looks = offersViewImage(req.exec, req.evidence);
  const evidence = req.evidence ? evidenceToolImpls(req.evidence) : [];
  const extraTools = [...(tool ? [vcsReadToolImpl(() => vcsProvider(), workspaceProjects, req.tracker !== undefined)] : []), ...(req.exec ? [shellToolImpl(req.exec)] : []), ...(looks && req.exec ? [viewImageToolImpl(req.exec, req.evidence)] : []), ...evidence, ...(req.release ? [releaseToolImpl(keepAlive(req.release, req.beat))] : []), ...(req.attachments ? [attachmentToolImpl(req.attachments.thread, req.attachments.refs)] : []), ...(req.runnerTools ?? [])];
  const allowedTools = [...req.allowedTools, ...(tool ? [VCS_READ_TOOL_NAME] : []), ...(req.exec ? [SHELL_TOOL_NAME] : []), ...(looks ? [VIEW_IMAGE_TOOL_NAME] : []), ...(req.evidence ? EVIDENCE_TOOL_NAMES : []), ...(req.release ? [RELEASE_TOOL_NAME] : []), ...(req.attachments ? [ATTACHMENT_TOOL] : []), ...(req.runnerTools ?? []).map((x) => x.name)];
  try {
    return await runOpenOnce<T>({
    selection,
    prompt: req.prompt,
    options: { ...sdkOptions({ ...req, allowedTools }), model: req.target.model },
    extraTools: extraTools.length ? extraTools : undefined,
    sessionsDir: join(ATAS, 'open-sessions'),
    secret: { isSecret: (p) => secretPath(p, req.cwd), globs: SECRET_GLOBS },
    // An agent that writes runs the repository's own scripts: no code host credentials in their environment.
    shellEnv: { ...(req.confine ? {} : vcsShellEnv()), ...(await commandPath()) },
    writeRoot: req.confine?.writeRoot ?? req.confine?.root,
    writeReserved: req.confine?.writeReserved,
    writeAllow: req.confine?.writeAllow,
    signal: req.abort?.signal,
    describeTool: source,
    events: {
      onSession: (id) => {
        req.beat?.();
        noteSession(id, req.role, req.prompt);
      },
      onToolUse: (name, input) => {
        req.beat?.();
        req.activity?.tool(source(name, input));
      },
      onToolResult: () => req.beat?.(),
      onUsage: (u) => {
        req.beat?.();
        req.onUsage?.({ promptTokens: u.promptTokens, completionTokens: u.completionTokens, cachedTokens: u.cachedTokens, ...(u.costUsd !== undefined ? { costUsd: u.costUsd } : {}), ...(u.estimated ? { estimated: true } : {}) });
      },
      onText: () => req.beat?.(),
      onReasoning: () => req.beat?.(),
      onInterim: (text) => req.activity?.text(text),
    },
    makeMaxTurnsError: (id, src) => new MaxTurnsError(id, src),
    incoming: req.incoming,
    });
  } catch (e) {
    // A refusal by budget is a wait, not a failure: it goes up with the provider the role is mapped to, which the bridge does not know.
    if (e instanceof ProviderBudgetError) throw new ProviderBudgetError(req.target.providerId, 'open', e.detail);
    throw e;
  }
}

// The input of a call whose session stays open: the stage's prompt first, then each message the door hands over, as user turns of the same session. The SDK's
// streaming input keeps the process alive between turns, so a message never restarts the session.
interface MessageStream extends AsyncIterable<{ type: 'user'; message: { role: 'user'; content: string }; parent_tool_use_id: null }> {
  push(text: string): void;
  end(): void;
}

function messageStream(prompt: string): MessageStream {
  const queued: string[] = [prompt];
  let wake: (() => void) | null = null;
  let done = false;
  const flush = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  return {
    push: (text) => {
      queued.push(text);
      flush();
    },
    end: () => {
      done = true;
      flush();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (queued.length) yield { type: 'user' as const, message: { role: 'user' as const, content: queued.shift() as string }, parent_tool_use_id: null };
        if (done) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}

// The SDK prices a call as if it went to Anthropic's own API, whatever provider the role is mapped to: outside it, that list price says nothing about what was
// charged, so the figure the result carries is kept as an estimate and marked as one. Same test the environment uses to decide how to authenticate.
function isAnthropicApi(target: EngineRequest['target']): boolean {
  return target.kind === 'anthropic' && /^https:\/\/api\.anthropic\.com\/?$/.test(target.baseUrl);
}

async function runClaudeSdk<T>(req: EngineRequest): Promise<Run<T>> {
  const sources: string[] = [];
  let sessionId = '';
  const query = await loadClaudeQuery();
  const exe = claudeExecutable();
  // Without a CLI to read the code host with, the agents get the VcsRead app tool as an in-process MCP server.
  const vcs = wantsVcsTool(req) ? await vcsMcpServer(() => vcsProvider(), workspaceProjects, req.tracker !== undefined) : null;
  const shell = req.exec ? await shellMcpServer(req.exec, req.evidence) : null;
  // An agent set to run commands in a sandbox must not lose the sandbox silently: without the tool it could not run them at all, and the stage says so.
  if (req.exec && !shell) throw new Error(t('main.sandbox.error.tool-missing'));
  // A release run's agent asks for the steps of the release through an app tool of its own; without it the agent could not do its job, and the stage says so.
  const release = req.release ? await releaseMcpServer(keepAlive(req.release, req.beat)) : null;
  if (req.release && !release) throw new Error(t('main.release.toolMissing'));
  // The files a called agent may open, scoped to its conversation: an image comes back as an image block for the model.
  const attachment = req.attachments ? await attachmentMcpServer(req.attachments.thread, req.attachments.refs) : null;
  // The evidence tools of a stage that keeps evidence: the same in-process MCP server shape as the Shell tool.
  const evidence = req.evidence ? await evidenceMcpServer(req.evidence) : null;
  if (req.evidence && !evidence) throw new Error(t('main.evidence.error.tool-missing'));
  // The app tools of a stage that talks while it works (SendMessage, CallAgent) or of a called agent (AskConversation), as an in-process MCP server.
  const runner = req.runnerTools?.length ? await runnerMcpServer(req.runnerTools) : null;
  const mcp = vcs || shell || release || attachment || evidence || runner ? { ...(vcs ?? {}), ...(shell ?? {}), ...(release ?? {}), ...(attachment ?? {}), ...(evidence ?? {}), ...(runner ?? {}) } : null;
  const env = { ...claudeSdkEnv(req.target), ...(await commandPath()) };
  // The child that runs a command of an agent that writes inherits this environment, provider key included: each such command is rewritten to start
  // without the credential-looking variables (the open engine cleans its own environment instead).
  const confine = req.confine ? { ...req.confine, hooks: scrubShellHooks(req.confine.hooks, credentialNames(env)) } : undefined;
  const options = {
    ...sdkOptions({ ...req, allowedTools: [...req.allowedTools, ...(vcs ? [VCS_MCP_TOOL_NAME] : []), ...(shell ? [SHELL_MCP_TOOL_NAME] : []), ...(shell && offersViewImage(req.exec, req.evidence) ? [VIEW_IMAGE_MCP_TOOL_NAME] : []), ...(release ? [RELEASE_MCP_TOOL_NAME] : []), ...(attachment ? [ATTACHMENT_MCP_TOOL_NAME] : []), ...(evidence ? EVIDENCE_TOOL_NAMES.map(evidenceMcpToolName) : []), ...(runner && req.runnerTools ? req.runnerTools.map((x) => runnerMcpToolName(x.name)) : [])], confine }),
    ...(mcp ? { mcpServers: mcp as NonNullable<Options['mcpServers']> } : {}),
    model: req.target.model,
    env,
    ...(exe ? { pathToClaudeCodeExecutable: exe } : {}),
  };
  // A stage that talks while it works keeps the session open: the message a person or another agent sent enters as a user turn between two steps, and the
  // stage does not restart. The door decides; without one the call is a single prompt, exactly as before.
  const stream = req.incoming ? messageStream(req.prompt) : null;
  // The door of a stage that talks while it works is asked what the model has already said, never before it spoke: a message that is waiting enters the session,
  // and the collection asks for the final answer once the queue is empty. Asking it only on a turn that produced no final answer would leave a message already
  // queued undelivered when the stage ends answering. Only while the stream is open: at the collection pass there is no message to wait for.
  let open = stream !== null;
  const throughDoor = async (): Promise<boolean> => {
    if (!stream || !req.incoming || !open) return false;
    const message = await req.incoming((text) => req.activity?.text(incomingActivity(text)));
    if (message === null) {
      open = false;
      stream.push(t('main.engine.text.collect'));
      return false;
    }
    stream.push(incomingText(message));
    return true;
  };
  // While the session is open, a message that arrived as the tools ran reaches the model with their results (the SDK's PostToolBatch, once per batch, before
  // the next request), so the agent hears it while it works and not only when its turn ends.
  if (stream && req.incoming) {
    const incoming = req.incoming;
    const between = {
      hooks: [
        async () => {
          if (!open) return {};
          const message = await incoming((text) => req.activity?.text(incomingActivity(text)));
          return message === null ? {} : { hookSpecificOutput: { hookEventName: 'PostToolBatch' as const, additionalContext: incomingText(message) } };
        },
      ],
    };
    options.hooks = { ...options.hooks, PostToolBatch: [...(options.hooks?.PostToolBatch ?? []), between] };
  }
  const q = query({ prompt: stream ?? req.prompt, options });
  const counted = new Set<string>();
  // What the assistant said, kept for the failure a call with no structured output throws: the provider's refusal reaches the person, never only the subtype.
  const assistantText: string[] = [];
  for await (const m of q) {
    req.beat?.();
    if ('session_id' in m) noteSession(m.session_id, req.role, req.prompt);
    if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
    if (m.type === 'assistant') {
      // Each content block of one response is a message of its own with the same id: its use is counted once.
      const used = (m.message as { id?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage;
      const id = (m.message as { id?: string }).id;
      if (used && (!id || !counted.has(id))) {
        if (id) counted.add(id);
        const cached = used.cache_read_input_tokens ?? 0;
        req.onUsage?.({ promptTokens: (used.input_tokens ?? 0) + cached + (used.cache_creation_input_tokens ?? 0), completionTokens: used.output_tokens ?? 0, cachedTokens: cached });
      }
      for (const block of m.message.content) {
        if (block.type === 'text') {
          assistantText.push(block.text);
          req.activity?.text(block.text);
        }
        if (block.type !== 'tool_use') continue;
        sources.push(source(block.name, block.input as Record<string, unknown>));
        if (block.name !== 'StructuredOutput') req.activity?.tool(sources[sources.length - 1]);
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
      // What the SDK says the whole call cost: it arrives as a report with no tokens, so it adds to the cost without counting as a call.
      if (typeof m.total_cost_usd === 'number') req.onUsage?.({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: m.total_cost_usd, ...(isAnthropicApi(req.target) ? {} : { costEstimated: true }) });
      if (m.subtype === 'error_max_turns') throw new MaxTurnsError(sessionId, sources);
      // The turn ended: the door is asked now, whatever the turn produced. A message that is waiting goes into the same session and the stage goes on; with none,
      // the closing call asks for the final answer with what the session already has.
      if (await throughDoor()) continue;
      if (m.subtype !== 'success' || m.structured_output == null) {
        // The provider's own error reaches the failure: the assistant text the call already carried, and the SDK's own error when it has one.
        const said = clipProviderText([...assistantText, typeof (m as { result?: unknown }).result === 'string' ? (m as { result: string }).result : ''].filter(Boolean).join('\n'));
        // A refusal by budget is a wait, not a failure of the stage; the SDK prefixes the gateway's message with "Failed to authenticate", so the body decides.
        if (budgetText(said)) throw new ProviderBudgetError(req.target.providerId, 'claude-sdk', redact(said));
        // i18n-ignore: developer error from the SDK result
        throw new Error(`agent failed: ${redact(said || `agent ended with ${m.subtype}`)}`);
      }
      stream?.end();
      return { data: m.structured_output as T, sessionId, sources };
    }
  }
  // i18n-ignore: developer error from the SDK result
  throw new Error('agent ended without a result');
}

registerEngine('claude-sdk', runClaudeSdk);
registerEngine('open', runOpenEngine);

/**
 * One small call to a provider, for the sweep to find out whether its key has budget again: the cheapest call the engine has, a one-word answer with no
 * tools. It goes through the same classification as a stage, so a refusal by budget is a refusal here too, and a 5xx or a network error is only "could not tell".
 */
export async function probeProviderBudget(providerId: string): Promise<{ ok: boolean; refusal: ProviderBudgetError | null; detail: string }> {
  const provider = rc().provider(providerId);
  if (!provider) return { ok: false, refusal: null, detail: '' };
  const own = rc().agentModel({ role: null, provider: provider.id, model: provider.models[0] ?? '' });
  try {
    await runnerFor(own)({
      role: own.role,
      prompt: cp('system.budgetProbe'),
      schema: { type: 'object', properties: { ok: { type: 'string' } }, required: ['ok'], additionalProperties: false },
      target: own,
      system: '',
      cwd: rc().projectsRoot,
      allowedTools: [],
      extraDirs: [],
      shell: { rules: [], patterns: [] },
      extra: { maxTurns: 1, tools: [] },
    });
    return { ok: true, refusal: null, detail: '' };
  } catch (e) {
    if (e instanceof ProviderBudgetError) return { ok: false, refusal: e, detail: e.detail };
    return { ok: false, refusal: null, detail: redact(e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

// One agent call: the role says which provider and model serve it (llm.roles), the provider says which engine runs it.
async function runOnce<T>(
  role: ModelRole,
  prompt: string,
  schema: Schema,
  extra: Partial<Options> = {},
  shell: ShellPolicy = { rules: [], patterns: [] },
  activity?: RunActivity,
): Promise<Run<T>> {
  // The env hook (COXIA_ENGINE=open) forces the open engine whatever the provider says.
  const target = openEngineFromEnv() ? { ...engineFor(role), engine: 'open' as const } : engineFor(role);
  const cwd = rc().projectsRoot;
  // The ceremony follows its system agent of the team: whether it reads the code host, and the commands the person allowed it always.
  const agent = getConfig().agents.team.find((a) => a.id === role && a.system);
  const reads = (agent?.tracker ?? 'read') === 'read';
  const id = agent?.id ?? role;
  const ask: CommandAsk | undefined = role === 'teams' ? undefined : { rules: agent?.allowedCommands ?? [], request: (command) => ceremonyCommands.ask(id, command, extra.abortController?.signal) };
  const tools = agent ? toolsForAgent(getConfig(), agent) : getConfig().agents.tools;
  return runnerFor(target)<T>({ role, prompt, schema, target, system: systemPrompt(role), cwd, allowedTools: [...allowedFor(role, reads, tools), ...shell.rules], extraDirs: extraDirs(cwd, role), shell, extra, activity, tracker: reads ? 'workspace' : 'none', tools, ask });
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
  const activity = beginActivity(role, (p) => secretPath(p, rc().projectsRoot));
  activity.status('started');
  try {
    const r = await runResumable<T>(activity, role, prompt, schema, extra, shell);
    activity.status('finished');
    return r;
  } catch (e) {
    activity.status('failed', e instanceof Error ? e.message : String(e));
    throw e;
  }
}

async function runResumable<T>(activity: RunActivity, role: ModelRole, prompt: string, schema: Schema, extra: Partial<Options>, shell: ShellPolicy): Promise<Run<T>> {
  // A role may have its own turn limit in the config; the one-turn wrap-up below is never raised by it.
  const cap = getConfig().agents.roles[role].maxTurns;
  try {
    return await runOnce<T>(role, prompt, schema, cap ? { ...extra, maxTurns: cap } : extra, shell, activity);
  } catch (e) {
    if (!(e instanceof MaxTurnsError)) throw e;
    const stopped = cp('system.stopped', { noSession: e.sessionId ? '' : cp('system.noSession') });
    if (!e.sessionId) throw new Error(stopped);
    console.error('[agent] error_max_turns, resuming once for a partial answer', e.sessionId);
    activity.status('resumed');
    try {
      const r = await runOnce<T>(role, cp('system.wrapUp'), schema, { ...extra, resume: e.sessionId, maxTurns: 2, tools: [], allowedTools: [] }, { rules: [], patterns: shell.patterns }, activity);
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

export async function prepareTurn(card: Card, opts: TurnOptions = {}): Promise<AgentTurn> {
  // A card already covered in an earlier meeting today is compared with what that meeting saw; this comes before the reuse of earlier days.
  const earlier = earlierMeetings(opts.ceremonyId);
  const day = earlier.length ? judge(card, earlier) : null;
  if (day?.kind === 'unchanged' && !opts.deepen) {
    recordReuse(card.ref);
    return unchangedTurn(card, day);
  }
  const same = day ? null : reusableTurn(card);
  if (same) return { ...same, seen: cardSnapshot(card).seen };
  const snap = day?.now ?? cardSnapshot(card);
  const c = cycle();
  const pre = c.ceremonyParams.preDaily;
  const common = {
    ref: card.ref,
    card: cardContext(card),
    specHint: pre.specReads > 0 && c.enrichment.specFolder ? cp('turn.specHint', { reads: pre.specReads }) : '',
    words: pre.speechWords,
    questionLine: c.meanings.question.enabled ? cp('turn.questionOn', { question: cycleWord(c.meanings.question.text) }) : cp('turn.questionOff'),
    meanings: meaningsLine(),
    priorityLine: priorityLine(card),
  };
  const prompt = day ? cp('turn.sameDay', { ...common, since: timeOf(day), earlier: earlierText(day), delta: deltaText(day) }) : cp('turn.main', common);
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
    seen: snap.seen,
    ...(day ? { sameDay: { ...infoOf(day), ...(opts.deepen ? { deepened: true } : {}) } } : {}),
  };
  rememberTurn(card, turn, snap.fp);
  return turn;
}

export async function reply(card: Card, turn: AgentTurn, text: string): Promise<ReplyResult> {
  // A named agent answers first, in the ceremony: the system agent still leads and takes over after.
  const mentions = await answerCeremonyMentions(text, { thread: card.ref, ref: card.ref, title: card.title, msgs: [] });
  const targets = [
    cycle().specLayout.decisionLog.heading && cycle().enrichment.specFolder ? cp('reply.targetSpec') : '',
    rc().cardSource?.noteArgs.length ? cp('reply.targetNote') : '',
    cp('reply.targetLog'),
  ]
    .filter(Boolean)
    .join('; ');
  const prompt = cp(
    'reply.main',
    { intro: turn.sessionId ? '' : cp('reply.intro', { card: cardContext(card), speech: turn.speech }), text, targets, priorityRule: priorityRule(card) },
    { keepEmpty: ['intro'] },
  );
  const schema = obj({
    ack: str,
    decisao: { anyOf: [{ type: 'null' }, obj({ texto: str, alvo: { enum: ['spec', 'note', 'ata'] } })] },
    efeito: { anyOf: [{ type: 'null' }, obj({ texto: str, repo: str })] },
    desbloqueio: { type: 'boolean' },
    prioridade: { anyOf: [{ type: 'null' }, obj({ para: { enum: priorityChoices() } })] },
    opcoes: OPTIONS,
  });
  type Out = {
    ack: string;
    decisao: { texto: string; alvo: DecisionTarget } | null;
    efeito: { texto: string; repo: string } | null;
    desbloqueio: boolean;
    prioridade: { para: string } | null;
    opcoes: string[];
  };
  const r = await run<Out>('reply', prompt, schema, { maxTurns: 3, ...(turn.sessionId ? { resume: turn.sessionId } : {}) });
  const target = r.data.decisao?.alvo === 'spec' && !card.spec ? 'ata' : r.data.decisao?.alvo;
  const decision: Decision | null =
    r.data.decisao && target ? { ref: card.ref, text: r.data.decisao.texto, target, dest: destination(card, target, destinationLabels()) } : null;
  return {
    ack: r.data.ack,
    decision,
    priority: r.data.prioridade ? priorityDecision(card, r.data.prioridade.para) : null,
    effect: r.data.efeito ? { ref: card.ref, text: r.data.efeito.texto, repo: r.data.efeito.repo } : null,
    needsDeepDive: r.data.desbloqueio,
    options: options(r.data.opcoes),
    ...(mentions.length ? { mentions } : {}),
  };
}

export async function deepAsk(card: Card, question: string, sessionId: string | null): Promise<DeepAnswer> {
  const mentions = await answerCeremonyMentions(question, { thread: card.ref, ref: card.ref, title: card.title, msgs: [] });
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
  return { sessionId: r.sessionId, speech: r.data.fala, text: r.data.texto || r.data.fala, sources: r.sources, ...(r.partial ? { partial: true } : {}), ...(mentions.length ? { mentions } : {}) };
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
    activities: JSON.stringify(cards.map((c) => ({ ref: c.ref, [t('main.teams.field.titulo')]: c.title, url: c.url, [t('main.teams.field.estagio')]: c.stage, [t('main.teams.field.bloqueios')]: c.blockers, [t('main.teams.field.mudou')]: c.changes }))),
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

/** One call of a team agent for a run: the stage's prompt, the agent's own model, and (for an agent that writes) its confinement. */
export interface AgentCall {
  agent: AgentDef;
  /** The `ReleaseAction` tool of an agent of a release run: one step of the release, answered in text for the model. */
  release?: (input: unknown) => Promise<string>;
  /**
   * The conversation the agent was called in and the files the message carries: with them the call gets the read-only `ConversationAttachment` tool,
   * scoped to that conversation. Absent: the call has no attachment tool (a stage's own agent reads the files through the message section instead).
   */
  attachments?: { thread: string; refs: readonly AttachmentRef[] };
  prompt: string;
  schema: Schema;
  /** The agent's system text: its job, its instructions and the rules of the stage (built by the runner). */
  system: string;
  /** The run's worktree for an agent that writes; where a reader looks at the code too. */
  cwd: string;
  confine?: Confinement;
  /** The confinement of a reading agent of a run: its file tools stay inside it, and it is offered no Edit, no Write and no shell. */
  readRoot?: ReadConfinement;
  /** What the call works on, for the root AGENTS.md files it is handed. Absent: it gets none (and still reads nothing of Claude Code). */
  docs?: DocsAsk;
  /** The stage's sandbox when the agent's `shell` is `sandbox`: its commands go there, through the `Shell` tool. */
  exec?: SandboxSession;
  /** The evidence tools of a stage that keeps evidence (only with a sandbox): keeping a file, marking an image and looking at it. */
  evidence?: EvidenceTools;
  /** The mailbox of a stage that talks while it works: where the engine gets a message to deliver between two steps (see EngineRequest.incoming). */
  incoming?: (delivered: (text: string) => void) => Promise<string | null>;
  /** The app tools of a stage that talks (`SendMessage`, `CallAgent`) or of a called agent (`AskConversation`); the engine offers each one by its name. */
  runnerTools?: ToolImpl[];
  /** What the live activity calls it (the agent's id). */
  label: string;
  /** The activity already made for a call that was accepted earlier (a mention): the engine reports only how it ends. */
  activity?: RunActivity;
  maxTurns: number;
  /**
   * A call that answers a message (a mention, a question of the chain, a request between squads) and may run out of turns: the same session is resumed once, with no
   * tool at all, to answer with what it has read, and the answer comes back marked `partial`. A stage leaves it off: it must not be reported done from a half answer.
   */
  wrapUp?: boolean;
  abort?: AbortController;
  /** Called at every sign of life from the model (text, a tool call, a usage report): what keeps the idle limit of the stage from running out. */
  beat?: () => void;
  /** Called once per model call with what it used, and what it cost when the provider or the SDK said. */
  onUsage?: (usage: UsageReport) => void;
}

// What a reader of a run may use: the tools the agent uses (its own when it names them, else the workspace's), as the ceremonies get them, and no shell beyond the
// code host reads. An agent that writes gets the read tools, Edit and Write, and a rule for each command it was given. A mention never gets Edit or Write.
function toolsOf(call: AgentCall): { allowedTools: string[]; shell: ShellPolicy; tracker: NonNullable<EngineRequest['tracker']>; tools: AgentToolsConfig } {
  const tracker = trackerOf(call.agent);
  const tools = call.confine ? getConfig().agents.tools : toolsForAgent(getConfig(), call.agent);
  if (!call.confine) return { allowedTools: allowedFor(call.agent.model.role ?? 'deep', tracker === 'workspace', tools), shell: { rules: [], patterns: [] }, tracker, tools };
  return { allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'], shell: { rules: [], patterns: [] }, tracker, tools };
}

/**
 * What an agent of a run may read from the code host: nothing (`none`), or the `VcsRead` app tool only (`read`), whichever read path the workspace has and whether the
 * agent changes files or not. Never the host CLI (it would need the person's credentials in the same process that runs repository code, and its paths are not limited to
 * the workspace's projects) and never a tracker MCP server (a process with credentials of its own): the tool is the one path whose projects the app limits. An agent saved
 * before the field existed reads as it behaved: a reader had the host read, one that writes had none.
 */
export function trackerOf(agent: Pick<AgentDef, 'tracker' | 'permission'>): NonNullable<EngineRequest['tracker']> {
  const value = agent.tracker ?? (agent.permission === 'worktree' ? 'none' : 'read');
  return value === 'none' ? 'none' : 'tool';
}

// The live activity shows the call the model made; this adds how it ended, once the command has.
function withActivity(session: SandboxSession, activity: RunActivity): SandboxSession {
  return {
    description: session.description,
    ...(session.stageDir ? { stageDir: session.stageDir } : {}),
    exec: async (command) => {
      const r = await session.exec(command);
      activity.tool(r.refused ? `exit — ${r.refused}` : r.timedOut ? `exit — timeout (${Math.round(r.ms / 1000)}s)` : `exit ${r.exitCode ?? '—'} (${Math.max(1, Math.round(r.ms / 100) / 10)}s)`);
      return r;
    },
    get log() {
      return session.log;
    },
    close: () => session.close(),
  };
}

/**
 * Runs a team agent once. The model comes from the agent (a borrowed role or an explicit provider and model), the engine from that provider.
 * A call that runs out of turns throws MaxTurnsError: a stage must not be reported done from a half-finished answer.
 */
export async function runAgent<T>(call: AgentCall, commands: string[] = []): Promise<Run<T>> {
  const resolved = rc().agentModel(call.agent.model);
  const target = openEngineFromEnv() ? { ...resolved, engine: 'open' as const } : resolved;
  const activity = call.activity ?? beginActivity(call.label, (p) => secretPath(p, call.cwd));
  // A call that was opened when the message arrived already said it was working (or waiting): the engine only reports the end.
  if (!call.activity) activity.status('started');
  try {
    const { allowedTools, shell, tracker, tools } = toolsOf(call);
    const rules = call.confine ? commands.map((c) => `Bash(${c})`) : shell.rules;
    const modelRole = call.agent.model.role ?? 'deep';
    // The documentation of the repositories goes in the system text, the same for both engines; a failure to read it never fails the call.
    const docs = call.docs ? await harnessSection(call.docs, call.agent, { cwd: call.cwd, contextWindow: target.capabilities?.contextWindow }).catch((e: unknown) => {
      console.error('[agent] could not build the documentation section', e instanceof Error ? e.message : e);
      return '';
    }) : '';
    const request: EngineRequest = {
      role: target.role,
      prompt: call.prompt,
      schema: call.schema,
      target,
      system: [call.system, docs].filter(Boolean).join('\n\n'),
      cwd: call.cwd,
      allowedTools: [...allowedTools, ...rules],
      extraDirs: call.confine ? [] : extraDirs(call.cwd, modelRole, { claude: false }),
      isolated: true,
      shell: { rules, patterns: shell.patterns },
      extra: { maxTurns: call.maxTurns },
      activity,
      confine: call.confine,
      read: call.readRoot,
      tracker,
      tools,
      exec: call.exec ? withActivity(call.exec, activity) : undefined,
      evidence: call.evidence,
      release: call.release,
      attachments: call.attachments,
      abort: call.abort,
      beat: call.beat,
      onUsage: call.onUsage,
      incoming: call.incoming,
      runnerTools: call.runnerTools,
    };
    let r: Run<T>;
    try {
      r = await runnerFor(target)<T>(request);
    } catch (e) {
      if (!call.wrapUp || !(e instanceof MaxTurnsError)) throw e;
      r = await wrapUpAnswer<T>(request, e, activity);
    }
    activity.status('finished');
    return r;
  } catch (e) {
    activity.status('failed', e instanceof Error ? e.message : String(e));
    // One seam for stages, mentions and the chain: the reason carries the provider the role is mapped to, whichever engine raised it.
    if (e instanceof ProviderBudgetError) throw new ProviderBudgetError(target.providerId, e.engine, e.detail);
    throw e;
  }
}

// The resume of a call that ran out of turns: same session, same schema, 2 turns and no tool of any kind (no shell session, no code host read, no release step), so
// it can only answer. Its transcript is the same session, so the cost panel counts it.
async function wrapUpAnswer<T>(request: EngineRequest, e: MaxTurnsError, activity: RunActivity): Promise<Run<T>> {
  const stopped = cp('system.stopped', { noSession: e.sessionId ? '' : cp('system.noSession') });
  if (!e.sessionId) throw new Error(stopped);
  console.error('[agent] error_max_turns, resuming once for an answer', e.sessionId);
  activity.status('resumed');
  try {
    const r = await runnerFor(request.target)<T>({
      ...request,
      prompt: cp('system.wrapUp'),
      allowedTools: [],
      extraDirs: [],
      shell: { rules: [], patterns: request.shell.patterns },
      extra: { maxTurns: 2, resume: e.sessionId, tools: [], allowedTools: [] },
      // No tool of any kind, so no read confinement to carry either: the answer can only come from what was already read.
      read: undefined,
      exec: undefined,
      release: undefined,
    });
    return { ...r, sources: [...e.sources, ...r.sources], partial: true };
  } catch (again) {
    // A refusal by budget is a wait for the runner, not a failure to word here.
    if (again instanceof ProviderBudgetError) throw again;
    console.error('[agent] wrap-up answer failed', again instanceof Error ? again.message : again);
    throw new Error(cp('system.partialFailed', { stopped, reason: again instanceof Error ? again.message : String(again) }));
  }
}

// Structured agent call for the other ceremony modules (gate, QA handoff, retro).
export { run as askAgent, obj, str, strOrNull };
