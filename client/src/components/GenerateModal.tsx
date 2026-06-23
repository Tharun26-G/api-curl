import { useState } from 'react';
import { CategoryCounts, TestCategory } from '../types';
import I from './Icons';

interface Props {
  open: boolean;
  onClose: () => void;
  onGenerate: (counts: CategoryCounts, customPrompt: string, customCount: number) => void;
  loading: boolean;
}

const CATEGORIES: { key: TestCategory; label: string; hint: string; default: number }[] = [
  { key: 'positive', label: 'Positive', hint: '2xx happy-path scenarios', default: 2 },
  { key: 'negative', label: 'Negative', hint: 'Wrong method, malformed JSON, etc.', default: 2 },
  { key: 'missing-field', label: 'Missing field', hint: 'Omit a required field at a time', default: 2 },
  { key: 'empty', label: 'Empty value', hint: 'Send empty string / null / []', default: 1 },
  { key: 'boundary', label: 'Boundary', hint: 'Min / max / length limits', default: 1 },
  { key: 'duplicate', label: 'Duplicate', hint: 'Repeat the same payload', default: 1 },
  { key: 'security', label: 'Security edge', hint: 'SQLi, XSS, header smuggling', default: 1 },
  { key: 'large-payload', label: 'Large payload', hint: 'Oversize body / many fields', default: 1 },
  { key: 'special-characters', label: 'Special chars', hint: 'Unicode, emojis, escapes', default: 1 },
];

const DEFAULTS: CategoryCounts = Object.fromEntries(
  CATEGORIES.map(c => [c.key, c.default]),
) as CategoryCounts;

export default function GenerateModal({ open, onClose, onGenerate, loading }: Props) {
  const [counts, setCounts] = useState<CategoryCounts>(DEFAULTS);
  const [customPrompt, setCustomPrompt] = useState('');
  const [customCount, setCustomCount] = useState(0);

  if (!open) return null;

  const total =
    Object.values(counts).reduce<number>((a, b) => a + (b || 0), 0) +
    (customPrompt.trim() ? customCount : 0);

  const setCount = (key: TestCategory, value: number) => {
    setCounts(prev => ({ ...prev, [key]: Math.max(0, Math.min(20, value)) }));
  };

  const setAll = (n: number) => {
    const next: CategoryCounts = {};
    for (const c of CATEGORIES) next[c.key] = n;
    setCounts(next);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Generate test cases</h3>
            <div className="sub">Choose how many cases to generate per category. The model fills in the rest.</div>
          </div>
          <button className="icon-btn" onClick={onClose}><I.X /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 14, gap: 6 }}>
            <button className="btn xs ghost" onClick={() => setAll(0)}>Clear</button>
            <button className="btn xs ghost" onClick={() => setAll(1)}>Set all to 1</button>
            <button className="btn xs ghost" onClick={() => setCounts(DEFAULTS)}>Reset</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            {CATEGORIES.map(cat => (
              <div key={cat.key} className="gen-card">
                <div style={{ minWidth: 0 }}>
                  <div className="title">{cat.label}</div>
                  <div className="hint">{cat.hint}</div>
                </div>
                <input
                  type="number"
                  className="count-input"
                  min={0}
                  max={20}
                  value={counts[cat.key] ?? 0}
                  onChange={e => setCount(cat.key, parseInt(e.target.value || '0', 10))}
                />
              </div>
            ))}
          </div>

          <div className="divider" />

          <div style={{ marginBottom: 8 }}>
            <span className="label-mono">Custom scenario (optional)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="e.g. Test that an authenticated admin can promote any user to admin, but normal users cannot."
              rows={3}
              style={{
                padding: 10,
                background: 'var(--card-2)',
                border: '1px solid var(--line)',
                fontFamily: 'var(--mono)',
                fontSize: 12.5,
                color: 'var(--ink)',
                resize: 'vertical',
                borderRadius: 'var(--radius-xs)',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div className="label-mono" style={{ marginBottom: 4 }}>Count</div>
                <input
                  type="number"
                  className="count-input"
                  min={0}
                  max={20}
                  value={customCount}
                  onChange={e => setCustomCount(parseInt(e.target.value || '0', 10))}
                  style={{ width: '100%' }}
                />
              </div>
              <span style={{ fontSize: 11, color: 'var(--mute)', fontFamily: 'var(--mono)' }}>
                Leave blank for none
              </span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <span style={{ marginRight: 'auto', fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--mute)' }}>
            Total: <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{total}</span> cases
          </span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={loading || total === 0}
            onClick={() => onGenerate(counts, customPrompt, customCount)}
          >
            {loading ? <span className="spinner" /> : <I.Sparkles size={14} />}
            Generate {total} cases
          </button>
        </div>
      </div>
    </div>
  );
}
