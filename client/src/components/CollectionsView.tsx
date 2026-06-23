import { useState } from 'react';
import { Collection, SavedRequest } from '../types';
import I from './Icons';
import { RequestState } from './RequestBuilder';

interface Props {
  collections: Collection[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSaveCurrent: (collectionId: string, name: string) => void;
  onLoad: (req: SavedRequest) => void;
  onRemoveRequest: (collectionId: string, requestId: string) => void;
  currentRequest: RequestState;
}

export default function CollectionsView({
  collections,
  onCreate,
  onRename,
  onDelete,
  onSaveCurrent,
  onLoad,
  onRemoveRequest,
  currentRequest,
}: Props) {
  const [newName, setNewName] = useState('');
  const [saveName, setSaveName] = useState('');
  const [selected, setSelected] = useState<string | null>(collections[0]?.id || null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const current = collections.find(c => c.id === selected) || null;

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: '8px 12px',
    background: 'var(--card-2)',
    border: '1px solid var(--line)',
    fontFamily: 'var(--mono)',
    fontSize: 12.5,
    color: 'var(--ink)',
    borderRadius: 'var(--radius-xs)',
  };

  return (
    <div className="card has-divider">
      <div className="card-header">
        <h3>Collections</h3>
        <span className="h-meta">{collections.length} on file</span>
      </div>
      <div className="card-body" style={{ paddingTop: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input
                placeholder="New collection name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                style={inputStyle}
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
                <I.Plus size={12} /> Add
              </button>
            </div>

            <div className="list">
              {collections.length === 0 ? (
                <div className="empty-state" style={{ padding: 14 }}>
                  <span className="label">No collections</span>
                  <span style={{ fontSize: 12.5 }}>Create one to organise requests.</span>
                </div>
              ) : (
                collections.map(col => (
                  <div
                    key={col.id}
                    className={`list-item ${selected === col.id ? 'active' : ''}`}
                    onClick={() => setSelected(col.id)}
                  >
                    <I.Folder />
                    {renaming === col.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onBlur={() => {
                          if (renameValue.trim()) onRename(col.id, renameValue.trim());
                          setRenaming(null);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            if (renameValue.trim()) onRename(col.id, renameValue.trim());
                            setRenaming(null);
                          }
                        }}
                        style={{ flex: 1, fontFamily: 'var(--mono)', color: 'var(--ink)' }}
                      />
                    ) : (
                      <span className="li-name">{col.name}</span>
                    )}
                    <span className="li-meta">{col.requests.length}</span>
                    <div className="li-actions">
                      <button
                        className="icon-btn"
                        title="Rename"
                        onClick={e => {
                          e.stopPropagation();
                          setRenaming(col.id);
                          setRenameValue(col.name);
                        }}
                      >
                        <I.Edit />
                      </button>
                      <button
                        className="icon-btn"
                        title="Delete"
                        onClick={e => {
                          e.stopPropagation();
                          onDelete(col.id);
                          if (selected === col.id) setSelected(null);
                        }}
                      >
                        <I.Trash />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            {!current ? (
              <div className="empty-state" style={{ paddingTop: 0 }}>
                <span className="label">Select a collection</span>
                <div className="title">Save your current request into a collection for re-use.</div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <span className="label-mono">Save current request → {current.name}</span>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <input
                      placeholder={`${currentRequest.method} ${currentRequest.url}`}
                      value={saveName}
                      onChange={e => setSaveName(e.target.value)}
                      style={inputStyle}
                    />
                    <button
                      className="btn primary sm"
                      onClick={() => {
                        const name = saveName.trim() || `${currentRequest.method} ${currentRequest.url}`;
                        onSaveCurrent(current.id, name);
                        setSaveName('');
                      }}
                    >
                      <I.Save size={12} /> Save
                    </button>
                  </div>
                </div>

                <div className="list">
                  {current.requests.length === 0 ? (
                    <div className="empty-state" style={{ padding: 14 }}>
                      <span className="label">No saved requests</span>
                      <span style={{ fontSize: 12.5 }}>
                        Click <strong style={{ color: 'var(--ink)' }}>Save</strong> above to add the current request.
                      </span>
                    </div>
                  ) : (
                    current.requests.map(req => (
                      <div
                        key={req.id}
                        className="list-item"
                        onClick={() => onLoad(req)}
                        title="Load into builder"
                      >
                        <span className={`method-pill ${req.method}`}>{req.method}</span>
                        <span className="li-name">{req.name}</span>
                        <span className="li-meta">{new Date(req.updatedAt).toLocaleDateString()}</span>
                        <div className="li-actions">
                          <button
                            className="icon-btn"
                            title="Remove"
                            onClick={e => {
                              e.stopPropagation();
                              onRemoveRequest(current.id, req.id);
                            }}
                          >
                            <I.Trash />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
