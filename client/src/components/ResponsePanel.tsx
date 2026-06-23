import { useState } from 'react';
import { ResponseData } from '../types';
import JsonView from './JsonView';

interface Props {
  response: ResponseData | null;
  sending: boolean;
}

const TABS = ['Response', 'Headers', 'Cookies'] as const;
type Tab = typeof TABS[number];

function statusClass(status: number): string {
  if (status === 0) return 'err';
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) return 'warn';
  return 'err';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function ResponsePanel({ response, sending }: Props) {
  const [tab, setTab] = useState<Tab>('Response');

  return (
    <div className="card has-divider">
      <div className="card-header">
        <h3>
          <span className="label-mono" style={{ letterSpacing: '0.18em', color: 'var(--mute)' }}>RESPONSE</span>
          {response && !response.error && (
            <>
              <span className={`chip ${statusClass(response.status)}`}>
                {response.status} {response.statusText}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--mute)' }}>
                {formatDuration(response.duration)}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--mute)' }}>
                {formatBytes(response.size)}
              </span>
            </>
          )}
          {response?.error && (
            <>
              <span className="chip err">Error</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--mute)' }}>
                {formatDuration(response.duration)}
              </span>
            </>
          )}
        </h3>
        {response && (
          <span className="dot-status">{response.error ? 'Failed' : 'Complete'}</span>
        )}
      </div>
      <div className="card-body" style={{ paddingTop: 16 }}>
        {sending && (
          <div className="empty-state" style={{ paddingTop: 0 }}>
            <span className="spinner" />
            <span className="label">Awaiting response…</span>
          </div>
        )}

        {!sending && !response && (
          <div className="empty-state" style={{ paddingTop: 0 }}>
            <span className="label">No response yet</span>
            <div className="title">Send a request to see the response here.</div>
          </div>
        )}

        {!sending && response && (
          <>
            <div className="tabs">
              {TABS.map(t => (
                <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
              ))}
            </div>

            {tab === 'Response' && (
              response.error ? (
                <pre className="code-block" style={{ color: 'var(--err)' }}>{response.error}</pre>
              ) : (
                <JsonView text={response.body} />
              )
            )}

            {tab === 'Headers' && (
              <JsonView text={JSON.stringify(response.headers, null, 2)} />
            )}

            {tab === 'Cookies' && (
              response.headers['set-cookie'] ? (
                <pre className="code-block">{response.headers['set-cookie']}</pre>
              ) : (
                <div className="empty-state" style={{ paddingTop: 0 }}>
                  <span className="label">Empty</span>
                  <span style={{ fontSize: 12.5 }}>No cookies set by this response.</span>
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
