import { useState } from 'react';
import { ResponseData } from '../types';
import JsonView from './JsonView';

interface Props {
  response: ResponseData | null;
  sending: boolean;
}

const TABS = ['Response', 'Headers', 'Cookies', 'Notes'] as const;
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

export default function ResponsePanel({ response, sending }: Props) {
  const [tab, setTab] = useState<Tab>('Response');

  return (
    <div className="card spec" data-spec="B · response">
      <div className="card-header">
        <h3>Response</h3>
        {response && !response.error && (
          <div className="resp-meta">
            <span className={`chip ${statusClass(response.status)}`}>
              {response.status} {response.statusText}
            </span>
            <span className="chip">{response.duration} ms</span>
            <span className="chip">{formatBytes(response.size)}</span>
          </div>
        )}
        {response?.error && (
          <div className="resp-meta">
            <span className="chip err">Error</span>
            <span className="chip">{response.duration} ms</span>
          </div>
        )}
      </div>
      <div className="card-body">
        {sending && (
          <div className="empty-state" style={{ paddingTop: 8 }}>
            <span className="spinner" />
            <span className="label">awaiting response…</span>
          </div>
        )}

        {!sending && !response && (
          <div className="empty-state" style={{ paddingTop: 0 }}>
            <span className="label">no response yet</span>
            <div className="title">Send a request to see what comes <em>back</em>.</div>
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
                <pre className="code-block" style={{ color: 'var(--coral)' }}>{response.error}</pre>
              ) : (
                <JsonView text={response.body} />
              )
            )}

            {tab === 'Headers' && (
              <JsonView text={JSON.stringify(response.headers, null, 2)} />
            )}

            {tab === 'Cookies' && (
              <div className="empty-state" style={{ paddingTop: 0 }}>
                {response.headers['set-cookie'] ? (
                  <pre className="code-block">{response.headers['set-cookie']}</pre>
                ) : (
                  <>
                    <span className="label">empty</span>
                    <span style={{ fontSize: 12.5 }}>No cookies set by this response.</span>
                  </>
                )}
              </div>
            )}

            {tab === 'Notes' && (
              <div className="empty-state" style={{ paddingTop: 0 }}>
                <span className="label">notes</span>
                <span style={{ fontSize: 12.5 }}>
                  Run a test case from the right panel to capture assertions.
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
