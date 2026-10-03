import { useCallback, useEffect, useState } from 'react';
import type { SandboxStatus } from '../../../../shared/sandbox';
import { api } from '../../api';

/** Whether this computer can make a sandbox, as the team and runner screens need it: asked once, and again on request. Null while the first answer is on its way. */
export function useSandboxStatus(): { status: SandboxStatus | null; check: () => void; checking: boolean } {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    let live = true;
    api.invoke<SandboxStatus>('sandbox:status').then(
      (s) => live && setStatus(s),
      () => live && setStatus({ available: false, backend: null, version: null, reason: 'platform', detail: '' }),
    );
    return () => {
      live = false;
    };
  }, []);
  const check = useCallback(() => {
    setChecking(true);
    api.invoke<SandboxStatus>('sandbox:probe').then(setStatus, () => undefined).finally(() => setChecking(false));
  }, []);
  return { status, check, checking };
}
