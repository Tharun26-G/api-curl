import I from './Icons';
import { Environment } from '../types';

interface Props {
  models: string[];
  selectedModel: string;
  onSelectModel: (m: string) => void;
  environments: Environment[];
  activeEnvId: string | null;
  onSelectEnv: (id: string | null) => void;
  onNewRequest: () => void;
  onImportCurl: () => void;
  onGenerateCases: () => void;
  onRunAll: () => void;
  onExportCsv: () => void;
  generating: boolean;
  runningAll: boolean;
  testsCount: number;
}

export default function Navbar({
  models,
  selectedModel,
  onSelectModel,
  environments,
  activeEnvId,
  onSelectEnv,
  onNewRequest,
  onImportCurl,
  onGenerateCases,
  onRunAll,
  onExportCsv,
  generating,
  runningAll,
  testsCount,
}: Props) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="mark">
          <span className="glyph">A</span>
          API Workbench
        </span>
      </div>
      <div className="actions">
        <button className="btn" onClick={onNewRequest} title="Start with a blank request">
          <I.Plus size={14} /> New
        </button>
        <button className="btn" onClick={onImportCurl} title="Paste a cURL command">
          <I.Import size={14} /> Import cURL
        </button>
        <button className="btn primary" onClick={onGenerateCases} disabled={generating} title="Generate test cases with Ollama">
          {generating ? <span className="spinner" /> : <I.Sparkles size={14} />}
          Generate
        </button>
        <button className="btn" onClick={onRunAll} disabled={runningAll || testsCount === 0}>
          {runningAll ? <span className="spinner" /> : <I.Play size={12} />}
          Run All <span className="kbd" style={{ marginLeft: 4 }}>{testsCount}</span>
        </button>
        <button className="btn ghost" onClick={onExportCsv} disabled={testsCount === 0} title="Export test cases as CSV">
          <I.Download size={14} /> CSV
        </button>
      </div>
      <div className="right-side">
        <span className="label-mono">Env</span>
        <select
          className="btn"
          value={activeEnvId ?? ''}
          onChange={e => onSelectEnv(e.target.value || null)}
          style={{ minWidth: 130 }}
          title="Active environment"
        >
          <option value="">No environment</option>
          {environments.map(env => (
            <option key={env.id} value={env.id}>{env.name}</option>
          ))}
        </select>
        <span className="label-mono">Model</span>
        <select
          className="btn"
          value={selectedModel}
          onChange={e => onSelectModel(e.target.value)}
          style={{ minWidth: 140 }}
          title="Ollama model"
        >
          {(models.length ? models : [selectedModel]).map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
