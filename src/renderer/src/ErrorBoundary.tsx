import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportRenderer } from './errorReport';
import { t } from './i18n';

interface State {
  failed: boolean;
}

// A render error used to leave a blank window. It is reported to the log and the person gets a way out.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRenderer('react', error, info.componentStack ?? undefined);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page">
        <div className="wrap" style={{ maxWidth: 560 }}>
          <section className="panel" role="alert" style={{ padding: 20, gap: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>{t('ui.error.title')}</h1>
            <p className="small">{t('ui.error.body')}</p>
            <div className="row">
              <button type="button" className="btn" onClick={() => this.setState({ failed: false })}>{t('ui.error.retry')}</button>
              <button type="button" className="btn" onClick={() => window.location.reload()}>{t('ui.error.reload')}</button>
            </div>
          </section>
        </div>
      </div>
    );
  }
}
