import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { errorText } from './api';
import { isWeb } from './platform';
import { UNAUTHORIZED, post, sessionCheck } from './webApi';
import './web.css';

type State = 'checking' | 'login' | 'offline' | 'ready';

function deviceName(): string {
  const ua = navigator.userAgent;
  const system = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return system ? `${browser} em ${system}` : browser;
}

function Login({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState(deviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Cerimônias</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Entre com o código de pareamento gerado no app do computador, em Configurações › Acesso pelo navegador.
          </p>
        </div>
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
        {error && <div className="error" role="alert">{error}</div>}
        <button type="submit" className="btn btn-dark" disabled={busy || code.trim().length < 8 || !name.trim()}>
          {busy ? <span className="spinner" /> : null} Entrar
        </button>
      </form>
    </div>
  );
}

// Browser build only: shows the login screen until the session cookie is valid. The Electron window renders the app directly.
export function WebGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(isWeb() ? 'checking' : 'ready');

  const check = () => {
    setState('checking');
    void sessionCheck().then((s) => setState(s === 'ok' ? 'ready' : s));
  };

  useEffect(() => {
    if (!isWeb()) return;
    check();
    const expired = () => setState('login');
    window.addEventListener(UNAUTHORIZED, expired);
    return () => window.removeEventListener(UNAUTHORIZED, expired);
  }, []);

  if (state === 'ready') return <>{children}</>;
  if (state === 'login') return <Login onDone={() => location.reload()} />;
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
  return <div className="web-center"><span className="spinner" aria-label="Carregando" /></div>;
}
