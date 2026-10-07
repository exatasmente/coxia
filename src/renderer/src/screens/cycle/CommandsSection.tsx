import { type RunAgentCommands, countCommands, groupCommands } from '../../../../shared/runCommands';
import type { AgentDef } from '../../../../shared/config/types';
import { useT } from '../../i18n';
import { agentName } from './names';
import { useThread } from './forumApi';

/**
 * Every command the run's agents ran, live: read from the cells the run itself writes (`runner.exec` and `runner.exec.host`), grouped by agent and, inside each
 * agent, by the stage it ran in. Nothing here goes to the code host. It lives as long as the run's thread does, so it is still there after the run ends.
 */
export function CommandsSection({ thread, team }: { thread: string; team: readonly AgentDef[] | undefined }) {
  const t = useT();
  const live = useThread(thread);
  const groups: RunAgentCommands[] = groupCommands([...live.messages]);
  const total = countCommands(groups);
  if (!total) return null;
  return (
    <section className="panel cy-commands" aria-labelledby="cy-commands-h">
      <h2 id="cy-commands-h" className="cy-h">{t('ui.cycle.commands.title')}</h2>
      {groups.map((g) => (
        <article key={g.agent} className="cy-round">
          <div className="row cy-round-head">
            <h3 className="cy-stage-name">{agentName(team, g.agent)}</h3>
            <span className="faint small">{t('ui.cycle.commands.count', { count: g.stages.reduce((n, s) => n + s.commands.length, 0) })}</span>
          </div>
          {g.stages.map((s) => (
            <div key={s.stage}>
              <p className="faint small">{s.stage}</p>
              <ul className="cy-findings">
                {s.commands.map((c, i) => (
                  <li key={i} className="cy-finding">
                    <div className="row cy-finding-head">
                      <span className="badge cy-tone-quiet mono">{c.n}</span>
                      <code className="mono small cy-where">{c.command}</code>
                      <span className="badge cy-tone-quiet">{t(c.via === 'host' ? 'ui.cycle.commands.host' : 'ui.cycle.commands.sandbox')}</span>
                      <span className="faint small">{c.result} · {t('ui.cycle.commands.ms', { ms: Math.round(c.ms / 100) / 10 })}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </article>
      ))}
      <p className="faint small">{t('ui.cycle.commands.derived')}</p>
    </section>
  );
}
