import { OllamaConfig, OllamaStatus } from '../types';
import I from './Icons';

export type SidebarKey = 'request' | 'tests' | 'collections' | 'environments';

interface Props {
  active: SidebarKey;
  onSelect: (key: SidebarKey) => void;
  config: OllamaConfig;
  status: OllamaStatus;
  models: string[];
  onConfigChange: (cfg: OllamaConfig) => void;
  testsCount: number;
  collectionsCount: number;
  environmentsCount: number;
}

const NAV: { key: SidebarKey; label: string; Icon: any }[] = [
  { key: 'request', label: 'Request', Icon: I.Send },
  { key: 'tests', label: 'Test Cases', Icon: I.List },
  { key: 'collections', label: 'Collections', Icon: I.Folder },
  { key: 'environments', label: 'Environments', Icon: I.Variable },
];

export default function Sidebar({
  active,
  onSelect,
  config,
  status,
  models,
  onConfigChange,
  testsCount,
  collectionsCount,
  environmentsCount,
}: Props) {
  const dotClass = status.connected ? 'connected' : status.error ? 'error' : '';
  const label = status.connected ? 'online' : status.error ? 'offline' : 'pending';

  const counts: Record<SidebarKey, number> = {
    request: 0,
    tests: testsCount,
    collections: collectionsCount,
    environments: environmentsCount,
  };

  return (
    <aside className="sidebar">
      <div className="section-label">
        <span>Navigate</span>
      </div>
      <div className="nav">
        {NAV.map(({ key, label, Icon }) => (
          <div
            key={key}
            className={`nav-item ${active === key ? 'active' : ''}`}
            onClick={() => onSelect(key)}
          >
            <Icon />
            <span>{label}</span>
            {counts[key] > 0 && <span className="num">{counts[key]}</span>}
          </div>
        ))}
      </div>

      <div className="footer">
        <div className="ollama-block">
          <h5>
            <span>Ollama</span>
            <span className={`status-dot ${dotClass}`}>{label}</span>
          </h5>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>Endpoint</label>
            <input
              value={config.url}
              onChange={e => onConfigChange({ ...config, url: e.target.value })}
              placeholder="http://localhost:11434"
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Model</label>
            {models.length > 0 ? (
              <select
                value={config.model}
                onChange={e => onConfigChange({ ...config, model: e.target.value })}
              >
                {!models.includes(config.model) && <option value={config.model}>{config.model}</option>}
                {models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                value={config.model}
                onChange={e => onConfigChange({ ...config, model: e.target.value })}
                placeholder="llama3"
              />
            )}
          </div>
          {status.error && (
            <div style={{ color: 'var(--err)', fontSize: '10.5px', marginTop: '8px', wordBreak: 'break-word', lineHeight: '1.3' }}>
              {status.error}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
