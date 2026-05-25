import { useState } from 'react';
import I from './Icons';

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (curl: string) => void;
  loading: boolean;
}

export default function CurlModal({ open, onClose, onImport, loading }: Props) {
  const [value, setValue] = useState('');
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="label-mono">action / import</span>
            <h3>Paste a <em>cURL</em> command</h3>
          </div>
          <button className="icon-btn" onClick={onClose}><I.X /></button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 12.5, color: 'var(--mute-2)', marginBottom: 10 }}>
            Method, URL, headers, and body will be parsed into the builder.
          </p>
          <textarea
            className="json-editor"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={`curl -X POST https://api.acme.com/v1/users \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Olivia Park","role":"designer"}'`}
            style={{ minHeight: 220 }}
            spellCheck={false}
          />
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={() => value.trim() && onImport(value.trim())}
            disabled={loading || !value.trim()}
          >
            {loading ? <span className="spinner" /> : <I.Import />}
            Parse &amp; Load
          </button>
        </div>
      </div>
    </div>
  );
}
