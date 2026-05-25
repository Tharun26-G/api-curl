import { useMemo, useState } from 'react';
import { Environment } from '../types';
import I from './Icons';

interface Props {
  environments: Environment[];
  activeId: string | null;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSetActive: (id: string | null) => void;
  onUpdateVars: (id: string, vars: Record<string, string>) => void;
}

interface KvRow { k: string; v: string }

function toRows(vars: Record<string, string>): KvRow[] {
  const rows: KvRow[] = Object.entries(vars).map(([k, v]) => ({ k, v }));
  rows.push({ k: '', v: '' });
  return rows;
}

function toMap(rows: KvRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { k, v } of rows) if (k.trim()) out[k.trim()] = v;
  return out;
}

export default function EnvironmentsView({
  environments,
  activeId,
  onCreate,
  onRename,
  onDelete,
  onSetActive,
  onUpdateVars,
}: Props) {
  const [newName, setNewName] = useState('');
  const [selected, setSelected] = useState<string | null>(environments[0]?.id || null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const current = environments.find(e => e.id === selected) || null;
  const rows = useMemo(() => (current ? toRows(current.vars) : []), [current]);

  const updateRow = (idx: number, field: 'k' | 'v', value: string) => {
    if (!current) return;
    const next = rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r));
    onUpdateVars(current.id, toMap(next));
  };

  const removeRow = (idx: number) => {
    if (!current) return;
    const next = rows.filter((_, i) => i !== idx);
    onUpdateVars(current.id, toMap(next));
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3>Environments &amp; Variables</h3>
        <span className="h-meta">{environments.length.toString().padStart(2, '0')} defined</span>
      </div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input
                placeholder="New environment name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  background: 'var(--ink)',
                  border: '1px solid var(--rule)',
                  fontFamily: 'var(--mono)',
                  fontSize: 12.5,
                  color: 'var(--cream)',
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newName.trim()) {
                    onCreate(newName.trim());
                    setNewName('');
                  }
                }}
              />
              <button
                className="btn primary sm"
                onClick={() => {
                  if (newName.trim()) {
                    onCreate(newName.trim());
                    setNewName('');
                  }
                }}
              >
                <I.Plus /> Add
              </button>
            </div>

            <div className="list">
              {environments.length === 0 ? (
                <div className="empty-state" style={{ padding: 14 }}>
                  <span className="label">no environments</span>
                  <span style={{ fontSize: 12.5 }}>Create one to inject <code style={{ color: 'var(--acid)' }}>{`{{vars}}`}</code> into URLs, headers, and bodies.</span>
                </div>
              ) : (
                environments.map(env => {
                  const isActive = env.id === activeId;
                  return (
                    <div
                      key={env.id}
                      className={`list-item ${selected === env.id ? 'active' : ''}`}
                      onClick={() => setSelected(env.id)}
                    >
                      <I.Globe />
                      {renaming === env.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onClick={e => e.stopPropagation()}
                          onBlur={() => {
                            if (renameValue.trim()) onRename(env.id, renameValue.trim());
                            setRenaming(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              if (renameValue.trim()) onRename(env.id, renameValue.trim());
                              setRenaming(null);
                            }
                          }}
                          style={{ flex: 1, fontFamily: 'var(--mono)', color: 'var(--cream)' }}
                        />
                      ) : (
                        <span className="li-name">{env.name}</span>
                      )}
                      <span className="li-meta">{Object.keys(env.vars).length}</span>
                      <div className="li-actions">
                        <button
                          className={`icon-btn`}
                          title={isActive ? 'Active' : 'Set active'}
                          style={isActive ? { color: 'var(--acid)' } : undefined}
                          onClick={e => {
                            e.stopPropagation();
                            onSetActive(isActive ? null : env.id);
                          }}
                        >
                          <I.Check />
                        </button>
                        <button
                          className="icon-btn"
                          title="Rename"
                          onClick={e => {
                            e.stopPropagation();
                            setRenaming(env.id);
                            setRenameValue(env.name);
                          }}
                        >
                          <I.Edit />
                        </button>
                        <button
                          className="icon-btn"
                          title="Delete"
                          onClick={e => {
                            e.stopPropagation();
                            onDelete(env.id);
                            if (selected === env.id) setSelected(null);
                          }}
                        >
                          <I.Trash />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div>
            {!current ? (
              <div className="empty-state" style={{ paddingTop: 0 }}>
                <span className="label">select an environment</span>
                <div className="title">
                  Define <em>{`{{vars}}`}</em> that resolve at request time.
                </div>
                <span style={{ fontSize: 12.5 }}>
                  Example: <code style={{ color: 'var(--acid)' }}>{`{{baseUrl}}/v1/users`}</code> reads <code style={{ color: 'var(--acid)' }}>baseUrl</code> from the active environment.
                </span>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span className="label-mono">variables for {current.name}</span>
                  {current.id === activeId ? (
                    <span className="chip acid">active</span>
                  ) : (
                    <button className="btn sm outline-acid" onClick={() => onSetActive(current.id)}>
                      Set active
                    </button>
                  )}
                </div>

                <div className="kv-row" style={{ marginBottom: 6 }}>
                  <span className="label-mono">key</span>
                  <span className="label-mono">value</span>
                  <span />
                </div>
                {rows.map((row, idx) => (
                  <div className="kv-row" key={idx}>
                    <input
                      placeholder="baseUrl"
                      value={row.k}
                      onChange={e => updateRow(idx, 'k', e.target.value)}
                    />
                    <input
                      placeholder="https://api.acme.com"
                      value={row.v}
                      onChange={e => updateRow(idx, 'v', e.target.value)}
                    />
                    {idx < rows.length - 1 ? (
                      <button className="icon-btn" onClick={() => removeRow(idx)} title="Remove">
                        <I.X size={14} />
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
