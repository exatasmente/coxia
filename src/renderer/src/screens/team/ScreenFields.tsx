import type { SandboxStatus } from '../../../../shared/sandbox';
import { isWeb } from '../../platform';
import { useT } from '../../i18n';
import type { AgentDraft } from './agentEdit';
import { CHROMIUM_LABEL } from './labels';
import { SessionsPanel } from './SessionsPanel';
import { useSandboxStatus } from './sandboxStatus';
import { ChipsInput, Toggle } from './ui';

// The three settings that give an agent the app's browser, on the computer only: a paired browser may lower them but the editor does not draw them there, so a phone never
// offers a switch it cannot turn on. The line under the switch says whether this computer can start the app's browser at all.

interface Props {
  draft: AgentDraft;
  set: (p: Partial<AgentDraft>) => void;
  hostsError?: string;
  /** Set for an agent already saved: the sessions its browser holds are listed (and revoked) for it. */
  agent?: { id: string; name: string };
}

/** The agent's virtual screen, the sites it may reach and its logged-in browser, with the sessions the latter holds. */
export function ScreenFields(props: Props) {
  const { status } = useSandboxStatus();
  return <ScreenFieldsView {...props} status={status} />;
}

/** The same, given what this computer can do (null while it is being asked). Nothing at all in a paired browser. */
export function ScreenFieldsView({ draft, set, hostsError, agent, status }: Props & { status: SandboxStatus | null }) {
  const t = useT();
  if (isWeb()) return null;
  const gui = status?.gui;
  const host = draft.shell === 'host';
  return (
    <fieldset className="wz-fieldset">
      <legend className="wz-label">{t('ui.team.f.screenGroup')}</legend>
      <Toggle checked={draft.screen} onChange={(screen) => set({ screen })} label={t('ui.team.f.screen')} />
      <p className="small muted">{t('ui.team.f.screenHint')}</p>
      {draft.screen && draft.shell !== 'none' && <p className="small muted">{t('ui.team.f.screenShell')}</p>}
      {draft.screen && host && <p className="small muted" role="note">{t('ui.team.f.screenHost')}</p>}
      {draft.screen && status && !status.available && <p className="small muted" role="status">{t('ui.team.screen.noSandbox')}</p>}
      {draft.screen && status?.available && gui?.display === 'off' && <p className="small muted" role="status">{t('ui.team.screen.displayOff')}</p>}
      {draft.screen && status?.available && gui?.chromium && <p className="small muted" role="status">{t(CHROMIUM_LABEL[gui.chromium])}</p>}
      <ChipsInput
        label={t('ui.team.f.allowedHosts')}
        hint={t(host ? 'ui.team.f.allowedHostsHost' : 'ui.team.f.allowedHostsHint')}
        addLabel={t('ui.squads.f.labelAdd')}
        removeLabel={(h) => t('ui.runner.sandbox.hostRemove', { host: h })}
        values={draft.allowedHosts}
        onChange={(allowedHosts) => set({ allowedHosts })}
        add={(list, text) => (text.trim() && !list.includes(text.trim().toLowerCase()) ? [...list, text.trim().toLowerCase()] : list)}
        error={hostsError}
      />
      <Toggle checked={draft.browserProfile} onChange={(browserProfile) => set({ browserProfile })} label={t('ui.team.f.browserProfile')} />
      <p className="small muted">{t('ui.team.f.browserProfileHint')}</p>
      {draft.browserProfile && host && <p className="small muted" role="note">{t('ui.team.f.browserProfileHost')}</p>}
      {agent && <SessionsPanel agent={agent.id} name={agent.name} />}
    </fieldset>
  );
}
