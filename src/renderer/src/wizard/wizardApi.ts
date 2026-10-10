import type { WorkspaceConfig } from '../../../shared/config/types';
import type { ConfigView } from '../../../shared/configView';
import type { ExportResult, ImportApply, ImportPreview, ImportResult, ImportSource, ImportTarget } from '../../../shared/configTransfer';
import type { SecretInfo, SecretInput, SecretsStorageStatus } from '../../../shared/secrets';
import {
  type CycleTemplatesResult,
  type DocsScanResult,
  type FolderPick,
  type ProviderTestResult,
  type ScannedRepo,
  type SdkStatus,
  type VcsTestResult,
  type VoiceAction,
  type VoiceRunResult,
  WIZARD_CHANNELS as C,
  type WizardAvailability,
  type WizardProgress,
} from '../../../shared/wizard';
import { api } from '../api';

// The channels the wizard and the settings sections call. Every one of them is desktop-only: a browser is refused (webPolicy.ts) and the
// screens check isWeb() before offering them.
export const wizardApi = {
  config: () => api.invoke<ConfigView>('config:get'),
  save: (config: WorkspaceConfig) => api.invoke<ConfigView>('config:save', config),
  validate: (config: WorkspaceConfig) => api.invoke<{ ok: boolean; errors: { path: string; message: string }[]; warnings: { path: string; message: string }[] }>('config:validate', config),
  secretSet: (input: SecretInput) => api.invoke<SecretInfo>('config:secret-set', input),
  secretRemove: (ref: string) => api.invoke<ConfigView>('config:secret-remove', ref),
  acceptInsecure: () => api.invoke<SecretsStorageStatus>('config:secrets-accept-insecure'),
  exportConfig: () => api.invoke<ExportResult>('config:export'),
  importPick: () => api.invoke<string | null>('config:import-pick'),
  importPreview: (source: ImportSource, target: ImportTarget) => api.invoke<ImportPreview>('config:import-preview', source, target),
  importApply: (req: ImportApply) => api.invoke<ImportResult>('config:import-apply', req),

  availability: () => api.invoke<WizardAvailability>(C.availability),
  progress: () => api.invoke<WizardProgress>(C.progressGet),
  saveProgress: (progress: WizardProgress) => api.invoke<WizardProgress>(C.progressSet, progress),
  clearProgress: () => api.invoke<void>(C.progressClear),
  testProvider: (id: string, model?: string, opts?: { rich?: boolean }) => api.invoke<ProviderTestResult>(C.providerTest, id, model, opts),
  sdkStatus: () => api.invoke<SdkStatus>(C.sdkStatus),
  sdkInstall: () => api.invoke<{ started: boolean }>(C.sdkInstall),
  sdkCancel: () => api.invoke<void>(C.sdkCancel),
  pickPath: (kind: 'dir' | 'file', title: string) => api.invoke<FolderPick | null>(C.pickFolder, kind, title),
  scanProjects: (roots: string[]) => api.invoke<ScannedRepo[]>(C.scanProjects, roots),
  pathsExist: (paths: string[]) => api.invoke<boolean[]>(C.pathsExist, paths),
  testVcs: (id: string) => api.invoke<VcsTestResult>(C.vcsTest, id),
  scanDocs: () => api.invoke<DocsScanResult>(C.docsScan),
  cycleTemplates: () => api.invoke<CycleTemplatesResult>(C.cycleTemplates),
  voice: (action: VoiceAction, options: unknown) => api.invoke<VoiceRunResult>(C.voiceRun, action, options),
};
