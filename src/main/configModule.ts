import { existsSync, writeFileSync } from 'node:fs';
import { app, BrowserWindow, dialog } from 'electron';
import { CONFIG_SCHEMA } from '../shared/config/schema';
import type { WorkspaceConfig } from '../shared/config/types';
import { collectSecretRequirements, validateConfig } from '../shared/config/validate';
import { CONFIG_EVENT, type ConfigView } from '../shared/configView';
import type { ExportResult, ImportApply, ImportPreview, ImportResult, ImportSource, ImportTarget } from '../shared/configTransfer';
import type { SecretInput, SecretInfo, SecretsStorageStatus } from '../shared/secrets';
import { syncProfiles } from './browser/module';
import { applyImport, exportText, previewImport } from './config-transfer';
import { DATA_ROOT, HOME, WORKSPACE_ID } from './env';
import { locateSdk } from './claudeSdk';
import type { Module } from './module';
import { secrets } from './secrets';
import { readRegistry } from './workspaces-core';
import { refusedPaths } from './configScope';
import { checkConfig, getConfig, reloadConfig, saveConfig } from './workspaceConfig';
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
    saveConfig(next);
    return announce();
  });

  // The save a paired browser may use (webPolicy.ts leaves config:save desktop-only): validated like any save, and refused when it changes anything outside
  // the team, the squads, the flow, the comment templates and the runner's plain settings (configScope.ts). The diff is against the stored config, not the client's word.
  ctx.handle('config:cycle-save', (next: WorkspaceConfig) => {
    const config = checkConfig(next);
    const refused = refusedPaths(getConfig(), config);
    if (refused.length) throw new Error(t('main.config.webScope', { paths: refused.slice(0, 4).join(', ') }));
    saveConfig(config);
    return announce();
  });

  ctx.handle('config:secret-set', (input: SecretInput): SecretInfo => {
    const info = secrets().set(input);
    announce();
    return info;
  });
  ctx.handle('config:secret-remove', (ref: string) => {
    secrets().remove(ref);
    return announce();
  });
  ctx.handle('config:secret-check', (ref: string) => secrets().check(ref));
  ctx.handle('config:secrets-accept-insecure', (): SecretsStorageStatus => {
    secrets().acceptInsecureStorage();
    announce();
    return secrets().storage();
  });

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
    const result = applyImport(transferDeps(), req, WORKSPACE_ID);
    if (result.appliedToRunning) {
      reloadConfig();
      // An import can drop agents: their logged-in profiles go with them.
      syncProfiles();
    }
    announce();
    return result;
  });
};
