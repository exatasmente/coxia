import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { errorText } from './api';
import { OutboxBanner } from './OutboxBanner';
import { consumePairFragment } from './pairFragment';
import { isWeb } from './platform';
import { HttpStatusError, UNAUTHORIZED, post, sessionCheck } from './webApi';
import './web.css';

type State = 'checking' | 'pairing' | 'login' | 'offline' | 'ready';

// Read once, at load: the QR link carries the code in the fragment, and it leaves the address bar right away.
const pairCode = isWeb() ? consumePairFragment(window) : null;
let pairStarted = false;

function deviceName(): string {
  const ua = navigator.userAgent;
  const system = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return system ? `${browser} em ${system}` : browser;
}

function Login({ notice, onDone }: { notice: string | null; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState(deviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('api/login', { code, name });
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="web-center">
      <form className="panel web-card" onSubmit={(e) => void submit(e)}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Coxia</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Escaneie o QR code do app do computador (Configurações › Acesso pelo navegador) ou digite o código de pareamento.
          </p>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <label className="web-field">
          <span style={{ fontWeight: 600 }}>Código de pareamento</span>
          <input
            className="text-input mono web-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX"
            maxLength={20}
            required
          />
        </label>
        <label className="web-field">
          <span style={{ fontWeight: 600 }}>Nome deste aparelho</span>
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" required />
        </label>
        <button type="submit" className="btn btn-dark" disabled={busy || code.trim().length < 8 || !name.trim()}>
          {busy ? <span className="spinner" /> : null} Entrar
        </button>
      </form>
    </div>
  );
}

// Browser build only: pairs from the QR link, or shows the login screen until the session cookie is valid.
// The Electron window renders the app directly.
export function WebGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(!isWeb() ? 'ready' : pairCode ? 'pairing' : 'checking');
  const [notice, setNotice] = useState<string | null>(null);

  const check = () => {
    setState('checking');
    void sessionCheck().then((s) => setState(s === 'ok' ? 'ready' : s));
  };

  const pairWith = (code: string) => {
    setState('pairing');
    post('api/login', { code, name: deviceName() }).then(
      () => location.reload(),
      (e) => {
        setNotice(e instanceof HttpStatusError && e.status === 401 ? 'Este link de pareamento expirou ou já foi usado. Gere outro no app do computador.' : errorText(e));
        setState('login');
      },
    );
  };

  useEffect(() => {
    if (!isWeb()) return;
    if (pairCode && !pairStarted) {
      pairStarted = true;
      pairWith(pairCode);
    } else if (!pairCode) check();
    // The same tab given a pairing link while the app is open (pasted into the address bar).
    const onHash = () => {
      const code = consumePairFragment(window);
      if (code) pairWith(code);
    };
    const expired = () => setState((s) => (s === 'pairing' ? s : 'login'));
    window.addEventListener('hashchange', onHash);
    window.addEventListener(UNAUTHORIZED, expired);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener(UNAUTHORIZED, expired);
    };
  }, []);

  if (state === 'ready') {
    return (
      <>
        {children}
        {isWeb() && <OutboxBanner />}
      </>
    );
  }
  if (state === 'login') return <Login notice={notice} onDone={() => location.reload()} />;
  if (state === 'offline') {
    return (
      <div className="web-center">
        <div className="panel web-card">
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Sem conexão</h1>
          <p className="muted">Não consegui falar com o app no computador. Confira se ele está aberto e com o acesso pelo navegador ligado.</p>
          <button type="button" className="btn btn-dark" onClick={check}>Tentar de novo</button>
        </div>
      </div>
    );
  }
  return (
    <div className="web-center">
      <div className="row" role="status" style={{ gap: 10 }}>
        <span className="spinner" aria-hidden="true" />
        {state === 'pairing' && <span>Pareando este aparelho…</span>}
      </div>
    </div>
  );
}
