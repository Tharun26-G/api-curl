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
          API<em style={{ fontStyle: 'italic' }}>/</em>Workbench<span className="dot">.</span>
        </span>
        <span className="meta">
          <span>vol. 01</span>
          <span>edition / ai-tests</span>
        </span>
      </div>
      <div className="actions">
        <button className="btn" onClick={onNewRequest} title="Start with a blank request">
          <I.Plus /> New
        </button>
        <button className="btn" onClick={onImportCurl} title="Paste a cURL command">
          <I.Import /> Import cURL
        </button>
        <button className="btn primary" onClick={onGenerateCases} disabled={generating} title="Generate test cases with Ollama">
          {generating ? <span className="spinner" /> : <I.Sparkles />}
          Generate
        </button>
        <button className="btn outline-acid" onClick={onRunAll} disabled={runningAll || testsCount === 0}>
          {runningAll ? <span className="spinner" /> : <I.Play />}
          Run All <span className="kbd" style={{ marginLeft: 4 }}>{testsCount}</span>
        </button>
        <button className="btn ghost" onClick={onExportCsv} disabled={testsCount === 0} title="Export test cases as CSV">
          <I.Download /> CSV
        </button>
      </div>
      <div className="right-side">
        <span className="label-mono">env</span>
        <select
          className="btn"
          value={activeEnvId ?? ''}
          onChange={e => onSelectEnv(e.target.value || null)}
          style={{ minWidth: 130, paddingRight: 26 }}
          title="Active environment"
        >
          <option value="">No environment</option>
          {environments.map(env => (
            <option key={env.id} value={env.id}>{env.name}</option>
          ))}
        </select>
        <span className="label-mono">model</span>
        <select
          className="btn"
          value={selectedModel}
          onChange={e => onSelectModel(e.target.value)}
          style={{ minWidth: 140, paddingRight: 26 }}
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
