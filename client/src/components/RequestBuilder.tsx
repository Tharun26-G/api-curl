import { useMemo, useState } from 'react';
import I from './Icons';

export interface RequestState {
  method: string;
  url: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  body: string;
  auth: string;
  preScript: string;
  tests: string;
}

interface Props {
  state: RequestState;
  onChange: (s: RequestState) => void;
  onSend: () => void;
  sending: boolean;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const TABS = ['Body', 'Params', 'Headers', 'Auth', 'Pre-request', 'Tests'] as const;
type Tab = typeof TABS[number];

function kvToEntries(kv: Record<string, string>): { k: string; v: string }[] {
  const arr = Object.entries(kv).map(([k, v]) => ({ k, v }));
  arr.push({ k: '', v: '' });
  return arr;
}

function entriesToKv(entries: { k: string; v: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { k, v } of entries) if (k.trim()) out[k.trim()] = v;
  return out;
}

export default function RequestBuilder({ state, onChange, onSend, sending }: Props) {
  const [tab, setTab] = useState<Tab>('Body');

  const beautify = () => {
    try {
      const parsed = JSON.parse(state.body);
      onChange({ ...state, body: JSON.stringify(parsed, null, 2) });
    } catch {
      // no-op
    }
  };

  const headerEntries = useMemo(() => kvToEntries(state.headers), [state.headers]);
  const paramEntries = useMemo(() => kvToEntries(state.params), [state.params]);

  const updateKv =
    (kind: 'headers' | 'params') =>
    (idx: number, field: 'k' | 'v', value: string) => {
      const current = kind === 'headers' ? headerEntries : paramEntries;
      const next = current.map((row, i) => (i === idx ? { ...row, [field]: value } : row));
      onChange({ ...state, [kind]: entriesToKv(next) } as RequestState);
    };

  const removeKv = (kind: 'headers' | 'params') => (idx: number) => {
    const current = kind === 'headers' ? headerEntries : paramEntries;
    const next = current.filter((_, i) => i !== idx);
    onChange({ ...state, [kind]: entriesToKv(next) } as RequestState);
  };

  return (
    <div className="card spec" data-spec="A · request">
      <div className="card-header">
        <h3>Request Specimen</h3>
        <span className="h-meta">draft / live</span>
      </div>
      <div className="card-body">
        <div className="req-row">
          <select
            className="method-select"
            value={state.method}
            onChange={e => onChange({ ...state, method: e.target.value })}
          >
            {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input
            className="url-input"
            value={state.url}
            onChange={e => onChange({ ...state, url: e.target.value })}
            placeholder="https://api.acme.com/v1/users · supports {{vars}}"
            onKeyDown={e => {
              if (e.key === 'Enter' && !sending) onSend();
            }}
          />
          <button className="btn primary" onClick={onSend} disabled={sending || !state.url.trim()}>
            {sending ? <span className="spinner" /> : <I.Send />}
            Send
          </button>
        </div>

        <div className="tabs">
          {TABS.map(t => {
            const counts: Record<Tab, number> = {
              Body: state.body ? 1 : 0,
              Params: Object.keys(state.params).length,
              Headers: Object.keys(state.headers).length,
              Auth: state.auth ? 1 : 0,
              'Pre-request': state.preScript ? 1 : 0,
              Tests: state.tests ? 1 : 0,
            };
            const c = counts[t];
            return (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {t}{c > 0 && <span className="count">{c}</span>}
              </button>
            );
          })}
        </div>

        {tab === 'Params' && (
          <KvEditor
            entries={paramEntries}
            keyPlaceholder="param"
            valPlaceholder="value · supports {{vars}}"
            onChange={updateKv('params')}
            onRemove={removeKv('params')}
          />
        )}

        {tab === 'Headers' && (
          <KvEditor
            entries={headerEntries}
            keyPlaceholder="header"
            valPlaceholder="value · supports {{vars}}"
            onChange={updateKv('headers')}
            onRemove={removeKv('headers')}
          />
        )}

        {tab === 'Body' && (
          <>
            <div className="editor-toolbar">
              <span>json body</span>
              <button className="btn sm ghost" onClick={beautify}>Beautify</button>
            </div>
            <textarea
              className="json-editor"
              value={state.body}
              spellCheck={false}
              onChange={e => onChange({ ...state, body: e.target.value })}
              placeholder='{"name":"Olivia Park","role":"designer"}'
            />
          </>
        )}

        {tab === 'Auth' && (
          <textarea
            className="json-editor"
            value={state.auth}
            spellCheck={false}
            onChange={e => onChange({ ...state, auth: e.target.value })}
            placeholder="Bearer {{token}} — sent as Authorization header"
            style={{ minHeight: 120 }}
          />
        )}

        {tab === 'Pre-request' && (
          <textarea
            className="json-editor"
            value={state.preScript}
            spellCheck={false}
            onChange={e => onChange({ ...state, preScript: e.target.value })}
            placeholder="// Pre-request script (stub — for future scripting)"
            style={{ minHeight: 120 }}
          />
        )}

        {tab === 'Tests' && (
          <textarea
            className="json-editor"
            value={state.tests}
            spellCheck={false}
            onChange={e => onChange({ ...state, tests: e.target.value })}
            placeholder="// Notes / pseudocode for assertions"
            style={{ minHeight: 120 }}
          />
        )}
      </div>
    </div>
  );
}

function KvEditor({
  entries,
  keyPlaceholder,
  valPlaceholder,
  onChange,
  onRemove,
}: {
  entries: { k: string; v: string }[];
  keyPlaceholder: string;
  valPlaceholder: string;
  onChange: (idx: number, field: 'k' | 'v', value: string) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div>
      <div className="kv-row" style={{ marginBottom: 6 }}>
        <span className="label-mono">key</span>
        <span className="label-mono">value</span>
        <span />
      </div>
      {entries.map((row, idx) => (
        <div className="kv-row" key={idx}>
          <input placeholder={keyPlaceholder} value={row.k} onChange={e => onChange(idx, 'k', e.target.value)} />
          <input placeholder={valPlaceholder} value={row.v} onChange={e => onChange(idx, 'v', e.target.value)} />
          {idx < entries.length - 1 ? (
            <button className="icon-btn" onClick={() => onRemove(idx)} title="Remove">
              <I.X size={14} />
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
    </div>
  );
}
