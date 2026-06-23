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
            <h3>Import cURL</h3>
            <div className="sub">Method, URL, headers, and body will be parsed into the builder.</div>
          </div>
          <button className="icon-btn" onClick={onClose}><I.X /></button>
        </div>
        <div className="modal-body">
          <textarea
            className="json-editor"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={`curl -X POST https://api.acme.co/v1/users \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Olivia Park","role":"designer"}'`}
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
            {loading ? <span className="spinner" /> : <I.Import size={14} />}
            Parse &amp; Load
          </button>
        </div>
      </div>
    </div>
  );
}
