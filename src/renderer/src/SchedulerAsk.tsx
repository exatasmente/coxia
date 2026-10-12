import { useEffect, useState } from 'react';
import { activeSchedules, asksAtStart } from '../../shared/schedules';
import { useT } from './i18n';
import { schedulesApi } from './schedulesApi';
import { Sheet } from './screens/Sheet';

// The question when the app opens: with an active schedule and nobody asked yet in this session of the app, whether the scheduler should run. Closing the sheet is a no:
// nothing fires until the person turns it on in the screen.

export function SchedulerAsk() {
  const t = useT();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    void schedulesApi.list().then(
      (v) => setCount(asksAtStart(v) ? activeSchedules(v.schedules).length : null),
      () => undefined,
    );
  }, []);

  if (count === null) return null;
  const answer = (on: boolean) => {
    setCount(null);
    void schedulesApi.setEnabled(on).catch(() => undefined);
  };
  return (
    <Sheet label={t('ui.schedules.ask.title')} onClose={() => answer(false)}>
      <p>{t('ui.schedules.ask.body', { count })}</p>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-accent" onClick={() => answer(true)}>{t('ui.schedules.ask.yes')}</button>
        <button type="button" className="btn" onClick={() => answer(false)}>{t('ui.schedules.ask.no')}</button>
      </div>
    </Sheet>
  );
}
