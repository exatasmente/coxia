import { useEffect, useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import type { ProcedureGet } from '../../../../shared/proceduresView';
import { useT } from '../../i18n';
import { RecordBody } from './RecordBody';
import { proceduresApi } from './proceduresApi';

// The open record of the list: read from the app when it opens, and read again when a write changes it.

const GONE = { missing: 'ui.procedures.panel.missing', deleted: 'ui.procedures.panel.missing', newer: 'ui.procedures.panel.newer', invalid: 'ui.procedures.panel.invalid' } as const;

export function RecordPanel({ id, revision, team }: { id: string; /** The revision the list showed: a different one means the record changed, so it is read again. */ revision: number; team: readonly AgentDef[] | undefined }) {
  const t = useT();
  const [got, setGot] = useState<ProcedureGet | null>(null);
  useEffect(() => {
    let live = true;
    void proceduresApi.get(id).then(
      (g) => live && setGot(g),
      () => live && setGot({ status: 'invalid' }),
    );
    return () => {
      live = false;
    };
  }, [id, revision]);
  if (!got) return <span className="spinner" aria-label={t('ui.procedures.panel.loading')} />;
  if (got.status !== 'ok') return <p className="small muted">{t(GONE[got.status])}</p>;
  return <RecordBody record={got.record} team={team} />;
}
