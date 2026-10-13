import { ContractError } from '../shared/contract';
import { t } from '../shared/i18n';
import { type InstanceDef, type InstanceInput, type InstanceStatus, type InstanceTest, type InstancesView, parseSshTarget } from '../shared/instances';
import type { SecretsStorageStatus } from '../shared/secrets';
import { openLink } from './instanceBridge';
import { type KeyStore, type SshCommands, SYSTEM_SSH, addInstance, hostKnown, instanceById, readInstances, removeInstance, scanHostKeys, selectInstance, trustHost } from './instances-core';

// What the `instances:*` channels do (#211). They belong to this computer's window alone (webPolicy.ts), so they are registered by the desktop and not by the core.

export interface InstanceChannelDeps {
  root: string;
  /** The instance this process runs against: LOCAL_INSTANCE, or an id. */
  running: string;
  keys: KeyStore & { storage(): SecretsStorageStatus; acceptInsecureStorage(): void };
  status: () => InstanceStatus;
  /** Relaunches the app so the choice takes effect. */
  restart: () => void;
  commands?: SshCommands;
  restartDelayMs?: number;
}

export interface InstanceChannels {
  list(): InstancesView;
  add(input: InstanceInput): InstancesView;
  remove(id: string): InstancesView;
  select(id: string): { restarting: boolean };
  test(id: string): Promise<InstanceTest>;
  trust(id: string, fingerprint: string): Promise<InstanceTest>;
  acceptInsecure(): SecretsStorageStatus;
}

export function createInstanceChannels(d: InstanceChannelDeps): InstanceChannels {
  const cmds = d.commands ?? SYSTEM_SSH;
  const list = (): InstancesView => {
    const file = readInstances(d.root);
    return { running: d.running, current: file.current, list: file.list, status: d.status(), storage: d.keys.storage() };
  };
  const targetOf = (def: InstanceDef) => {
    const target = parseSshTarget(def.sshTarget);
    if (!target) throw new ContractError('invalid-input', t('main.instances.badTarget'));
    return target;
  };

  async function test(id: string): Promise<InstanceTest> {
    const def = instanceById(d.root, id);
    try {
      const target = targetOf(def);
      if (!(await hostKnown(cmds, d.root, target))) {
        const keys = await scanHostKeys(cmds, target);
        return { ok: false, code: 'host-unknown', fingerprints: [...new Set(keys.map((k) => k.fingerprint))] };
      }
      const link = await openLink({ def, root: d.root, keys: d.keys, commands: cmds, timeoutMs: 15_000 });
      try {
        const own = (await link.call('ownership:status', [])) as { role: 'owner' | 'client'; owner: { host: string } | null };
        return { ok: true, workspace: link.workspace, role: own.role, owner: own.owner?.host ?? '' };
      } finally {
        link.close();
      }
    } catch (e) {
      return { ok: false, code: 'failed', message: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    list,
    add(input) {
      addInstance(d.root, input, d.keys);
      return list();
    },
    remove(id) {
      if (id === d.running) throw new ContractError('conflict', t('main.instances.removeRunning'));
      removeInstance(d.root, id, d.keys);
      return list();
    },
    select(id) {
      selectInstance(d.root, id);
      if (id === d.running) return { restarting: false };
      setTimeout(d.restart, d.restartDelayMs ?? 700);
      return { restarting: true };
    },
    test,
    async trust(id, fingerprint) {
      await trustHost(cmds, d.root, targetOf(instanceById(d.root, id)), String(fingerprint));
      return test(id);
    },
    acceptInsecure() {
      d.keys.acceptInsecureStorage();
      return d.keys.storage();
    },
  };
}

