import { existsSync, writeFileSync } from 'node:fs';
import { app, BrowserWindow, dialog } from 'electron';
import { CONFIG_SCHEMA } from '../shared/config/schema';
import { TEST_ENV_REF_PREFIX, type Language, type WorkspaceConfig } from '../shared/config/types';
import { collectSecretRequirements, validateConfig } from '../shared/config/validate';
import { CONFIG_EVENT, type ConfigView } from '../shared/configView';
import { promptEntries, withPromptOverride, type PromptEntry } from '../shared/cycles/prompts';
import type { ExportResult, ImportApply, ImportPreview, ImportResult, ImportSource, ImportTarget } from '../shared/configTransfer';
import type { SecretInput, SecretInfo, SecretsStorageStatus } from '../shared/secrets';
import { syncProfiles } from './browser/module';
import { applyImport, exportText, previewImport } from './config-transfer';
import { DATA_ROOT, HOME, WORKSPACE_ID } from './env';
import { locateSdk } from './claudeSdk';
import type { Module } from './module';
import { recordWrite } from './auditoria';
import { configAuditEntry, type ConfigOp } from './configAudit';
import { secretAuditEntry, type SecretOp } from './decisionAudit';
import { viaOf } from './rpc';
import { secrets, testEnvLedger } from './secrets';
import { readRegistry } from './workspaces-core';
import { keepStoredTurns, refusedPaths, remoteControlRaised } from './configScope';
import { checkConfig, getConfig, reloadConfig, saveConfig, updateConfig } from './workspaceConfig';
import { t } from '../shared/i18n';

// The channels of the configuration: read it, save it, the secrets store, and export/import. Everything that writes, touches files or
// stores a secret is desktop-only (webPolicy.ts): a browser client must not be able to change what the app executes or where it reads.

function view(): ConfigView {
  const config = getConfig();
  const store = secrets();
  return {
    config,
    secrets: store.list(),
    storage: store.storage(),
    requirements: collectSecretRequirements(config).map((r) => ({ ...r, configured: store.has(r.ref) })),
    claudeSdk: locateSdk(config.claudeSdk, HOME),
    workspaceId: WORKSPACE_ID,
  };
}

const parentWindow = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

function transferDeps() {
  return { root: DATA_ROOT, home: HOME, secrets: secrets(), exists: existsSync, now: () => new Date() };
}

function workspaceName(id: string): string {
  return readRegistry(DATA_ROOT)?.list.find((w) => w.id === id)?.name ?? id;
}

/** Runs a change of the configuration and writes the line that says what changed, for whoever made it. A refused save changed nothing and has none. */
function recordedConfig<T>(op: ConfigOp, change: () => T): T {
  const before = getConfig();
  const result = change();
  try {
    const line = configAuditEntry(before, getConfig(), { op, via: viaOf() });
    if (line) recordWrite(line);
  } catch (e) {
    // The change already happened; a failing log must not turn it into a reported failure.
    console.error('[config] audit', e instanceof Error ? e.message : e);
  }
  return result;
}

/** The line of a secret's change, written after it whatever the outcome: the name and the kind of source, never a value, a command, a variable or a path. */
function recordedSecret<T>(op: SecretOp, ref: unknown, source: unknown, change: () => T): T {
  try {
    const result = change();
    recordWrite(secretAuditEntry({ op, ref, source, ok: true, via: viaOf() }));
    return result;
  } catch (e) {
    recordWrite(secretAuditEntry({ op, ref, source, ok: false, via: viaOf() }));
    throw e;
  }
}

export const configModule: Module = (ctx) => {
  const announce = (): ConfigView => {
    const v = view();
    ctx.emit({ type: 'module', name: CONFIG_EVENT, payload: v });
    return v;
  };

  ctx.handle('config:get', () => view());
  ctx.handle('config:schema', () => CONFIG_SCHEMA);
  ctx.handle('config:validate', (raw: unknown) => {
    const r = validateConfig(raw);
    return { ok: r.ok, errors: r.errors, warnings: r.warnings };
  });
  ctx.handle('config:save', (next: WorkspaceConfig) => {
    // The persona reaches this channel through its door: it may turn an agent's Remote Control off, never on (#282).
    if (viaOf() === 'persona' && remoteControlRaised(getConfig(), next).length) throw new Error(t('main.config.remoteControlPersona'));
    recordedConfig('save', () => saveConfig(keepStoredTurns(next, getConfig())));
    return announce();
  });

  // The save a paired browser may use (webPolicy.ts leaves config:save desktop-only): validated like any save, and refused when it changes anything outside
  // the team, the squads, the flow, the comment templates and the runner's plain settings (configScope.ts). The diff is against the stored config, not the client's word.
  ctx.handle('config:cycle-save', (next: WorkspaceConfig) => {
    const config = checkConfig(keepStoredTurns(next, getConfig()));
    const refused = refusedPaths(getConfig(), config);
    if (refused.length) throw new Error(t('main.config.webScope', { paths: refused.slice(0, 4).join(', ') }));
    recordedConfig('cycle-save', () => saveConfig(config));
    return announce();
  });

  // The prompt editor (Ctrl+Shift+I, the desktop window only): every prompt id the catalogs have, read from them on each call so a text added later shows up
  // without a list to keep, and the change of one text in one language, kept in devCycle.promptOverrides. Both are desktop-only (webPolicy.ts): a prompt
  // is what every agent is told, so a paired browser neither reads the editor's list nor writes it.
  ctx.handle('config:prompts', (): PromptEntry[] => promptEntries(getConfig().devCycle));
  ctx.handle('config:prompt-set', (id: string, language: Language, text: string | null): PromptEntry[] => {
    recordedConfig('prompt-set', () => updateConfig((c) => ({ ...c, devCycle: { ...c.devCycle, promptOverrides: withPromptOverride(c.devCycle.promptOverrides, id, language, text) } })));
    announce();
    return promptEntries(getConfig().devCycle);
  });

  ctx.handle('config:secret-set', (input: SecretInput): SecretInfo => {
    const info = recordedSecret('set', input?.ref, input?.source, () => secrets().set(input));
    announce();
    return info;
  });
  ctx.handle('config:secret-remove', (ref: string) => {
    // The kind of source is read before the entry goes.
    recordedSecret('remove', ref, secrets().list().find((x) => x.ref === ref)?.source, () => secrets().remove(ref));
    return announce();
  });
  ctx.handle('config:secret-check', (ref: string) => secrets().check(ref));
  ctx.handle('config:secrets-accept-insecure', (): SecretsStorageStatus => {
    recordedSecret('accept-insecure', undefined, undefined, () => secrets().acceptInsecureStorage());
    announce();
    return secrets().storage();
  });

  // The confirmation of a non-test-only secret of the test environment (spec rule 10): a person's once-per-entry decision, made here and recorded in the
  // audit log before anything changes. Never offered to the agent, and refused for a ref that is not of the test prefix.
  ctx.handle('config:testenv-confirm', (ref: string) => {
    if (!ref.startsWith(TEST_ENV_REF_PREFIX)) throw new Error(t('main.config.testenv.badRef', { ref }));
    recordWrite({ kind: 'test-env', issue: 0, target: `test-env:${ref}`, via: 'config', fields: { ref }, ok: true, code: null, result: 'confirmed', origin: { actionId: '', kind: 'test-env-confirm', key: ref, summary: null }, by: null });
    testEnvLedger().confirm(ref, 'person');
    return testEnvLedger().list();
  });
  ctx.handle('config:testenv-revoke', (ref: string) => {
    testEnvLedger().revoke(ref);
    recordWrite({ kind: 'test-env', issue: 0, target: `test-env:${ref}`, via: 'config', fields: { ref }, ok: true, code: null, result: 'revoked', origin: { actionId: '', kind: 'test-env-confirm', key: ref, summary: null }, by: null });
    return testEnvLedger().list();
  });
  ctx.handle('config:testenv-confirmations', () => testEnvLedger().list());

  ctx.handle('config:export', async (): Promise<ExportResult> => {
    const config = getConfig();
    const win = parentWindow();
    const options = { title: t('main.config.exportTitle'), defaultPath: `coxia-${WORKSPACE_ID}.json`, filters: [{ name: t('main.config.fileFilter'), extensions: ['json'] }] };
    const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    const requiredSecrets = collectSecretRequirements(config);
    if (picked.canceled || !picked.filePath) return { path: null, requiredSecrets };
    writeFileSync(picked.filePath, exportText(config, { workspaceName: workspaceName(WORKSPACE_ID), appVersion: app.getVersion(), now: new Date() }));
    return { path: picked.filePath, requiredSecrets };
  });

  ctx.handle('config:import-pick', async (): Promise<string | null> => {
    // Test hook: the isolated UI tests cannot drive a native file dialog.
    if (process.env.COXIA_TEST_IMPORT_FILE) return process.env.COXIA_TEST_IMPORT_FILE;
    const options = { title: t('main.config.importTitle'), properties: ['openFile' as const], filters: [{ name: t('main.config.fileFilter'), extensions: ['json'] }] };
    const win = parentWindow();
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });
  ctx.handle('config:import-preview', (source: ImportSource, target: ImportTarget): ImportPreview => previewImport(transferDeps(), source, target));
  ctx.handle('config:import-apply', (req: ImportApply): ImportResult => {
    const before = getConfig();
    const result = applyImport(transferDeps(), req, WORKSPACE_ID);
    if (result.appliedToRunning) {
      reloadConfig();
      const line = configAuditEntry(before, getConfig(), { op: 'import-apply', via: viaOf() });
      if (line) recordWrite(line);
      // An import can drop agents: their logged-in profiles go with them.
      syncProfiles();
    }
    announce();
    return result;
  });
};
