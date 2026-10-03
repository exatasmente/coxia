import { type ReactNode, useEffect } from 'react';
import type { Screen } from '../App';
import { ceremoniesListed } from '../../../shared/cycles/view';
import { useCycle } from '../cycleApi';
import { tNodes, tvNodes, useT, useTv, useVoiceEnabled } from '../i18n';
import { BackIcon } from './icons';

// F1 opens the help from any screen and closes it when it is already open.
export function useHelpShortcut(current: Screen['name'], go: (s: Screen) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F1' || e.repeat) return;
      e.preventDefault();
      go({ name: current === 'help' ? 'today' : 'help' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, go]);
}

const Key = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;
const KEYCAP = { enter: 'Enter', tab: 'Tab', shift: 'Shift' }; // i18n-ignore: key names
const Mono = ({ children }: { children: ReactNode }) => <span className="mono">{children}</span>;

function Item({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div style={{ fontWeight: 600 }}>{term}</div>
      <div className="small" style={{ lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

function Block({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="panel" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h2>
        {intro && <p className="small muted" style={{ marginTop: 4 }}>{intro}</p>}
      </div>
      {children}
    </section>
  );
}

export function Ajuda({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const tv = useTv();
  const voiceOn = useVoiceEnabled();
  // Until the cycle has loaded the screen lists everything; afterwards only the ceremonies the cycle has and the workspace can run.
  const cycle = useCycle();
  const listed = cycle ? ceremoniesListed(cycle) : null;
  const has = (key: keyof NonNullable<typeof listed>) => !listed || listed[key];
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 980, gap: 20 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label={t('ui.help.back')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>{t('ui.help.title')}</h1>
          </div>
          <span className="small muted">{tNodes('ui.help.f1', { key: <Key>{'F1'}</Key> })}</span>
        </header>

        <Block title={tv('help.shortcuts.title')} intro={tv('help.shortcuts.intro')}>
          {voiceOn && (
            <>
              <Item term={<Key>{t('ui.help.key.space')}</Key>}>{t('ui.help.space.text')}</Item>
              <Item term={t('ui.help.silence.term')}>{t('ui.help.silence.text')}</Item>
            </>
          )}
          <Item term={t('ui.help.type.term')}>{tvNodes('help.type.text', { key: <Key>{KEYCAP.enter}</Key> })}</Item>
          <Item term={tNodes('ui.help.tab.term', { tab: <Key>{KEYCAP.tab}</Key>, shift: <Key>{KEYCAP.shift}</Key> })}>
            {tNodes('ui.help.tab.text', { enter: <Key>{KEYCAP.enter}</Key>, space: <Key>{t('ui.help.key.space')}</Key> })}
          </Item>
          {voiceOn ? (
            <Item term={t('ui.help.agentVoice.term')}>{t('ui.help.agentVoice.text')}</Item>
          ) : (
            <Item term={tv('help.voice.off.term')}>{tv('help.voice.off.text')}</Item>
          )}
        </Block>

        <Block title={tv('help.commands.title')} intro={tv('help.commands.intro')}>
          <Item term={t('ui.help.cmd.next.term')}>{t('ui.help.cmd.next.text')}</Item>
          <Item term={t('ui.help.cmd.deepen.term')}>{t('ui.help.cmd.deepen.text')}</Item>
          <Item term={t('ui.help.cmd.end.term')}>{tv('help.cmd.end')}</Item>
        </Block>

        <Block title={t('ui.help.ceremonies.title')}>
          {has('preDaily') && <Item term={t('ui.help.ceremonies.preDaily')}>{tv('help.preDaily')}</Item>}
          {has('unblock') && <Item term={t('ui.help.ceremonies.unblock')}>{t('ui.help.ceremonies.unblock.text')}</Item>}
          {has('qaHandoff') && <Item term={t('ui.help.ceremonies.qaHandoff')}>{t('ui.help.ceremonies.qaHandoff.text')}</Item>}
          {has('retro') && <Item term={t('ui.help.ceremonies.retro')}>{t('ui.help.ceremonies.retro.text')}</Item>}
          {has('gate') && <Item term={t('ui.help.ceremonies.gate')}>{t('ui.help.ceremonies.gate.text')}</Item>}
          {has('host') && has('qaReturn') && <Item term={t('ui.help.ceremonies.others')}>{t('ui.help.ceremonies.others.text')}</Item>}
          {has('host') && !has('qaReturn') && <Item term={t('ui.help.ceremonies.hostOnly')}>{t('ui.help.ceremonies.hostOnly.text')}</Item>}
          {has('host') && <Item term={t('ui.help.ceremonies.radar')}>{t('ui.help.ceremonies.radar.text')}</Item>}
        </Block>

        <Block title={t('ui.help.never.title')}>
          <Item term={t('ui.help.never.gitlab.term')}>{t('ui.help.never.gitlab.text')}</Item>
          <Item term={t('ui.help.never.teams.term')}>{t('ui.help.never.teams.text')}</Item>
          <Item term={tv('help.effects.term')}>{t('ui.help.never.effects.text')}</Item>
          <Item term={t('ui.help.never.agents.term')}>{t('ui.help.never.agents.text')}</Item>
          <Item term={t('ui.help.never.local.term')}>{t('ui.help.never.local.text')}</Item>
        </Block>

        <Block title={t('ui.help.data.title')} intro={t('ui.help.data.intro')}>
          <Item term={<Mono>{t('ui.help.data.workspaces.term')}</Mono>}>
            {tNodes('ui.help.data.workspaces.text', {
              minutes: <Mono>{t('ui.help.data.minutesFile')}</Mono>,
              history: <Mono>{'historico/'}</Mono>,
              gates: <Mono>{'gates/'}</Mono>,
              qa: <Mono>{'qa/'}</Mono>,
              retros: <Mono>{'retros/'}</Mono>,
              activity: <Mono>{'atividade/'}</Mono>,
              config: <Mono>{'config.json'}</Mono>,
              actions: <Mono>{'acoes.json'}</Mono>,
              cost: <Mono>{'custo.json'}</Mono>,
              radar: <Mono>{'radar.json'}</Mono>,
              status: <Mono>{'status.json'}</Mono>,
            })}
          </Item>
          <Item term={<Mono>{'~/.local/share/cerimonias/'}</Mono>}>{t('ui.help.data.shared.text')}</Item>
          <Item term={<Mono>{t('ui.help.data.specs.term')}</Mono>}>{t('ui.help.data.specs.text')}</Item>
          <Item term={t('ui.help.data.theme.term')}>{tv('help.theme')}</Item>
        </Block>
      </div>
    </div>
  );
}
