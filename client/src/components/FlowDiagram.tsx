import I from './Icons';

const STEPS: { title: string; desc: string }[] = [
  { title: 'Import cURL', desc: 'Paste a command and load it into the builder.' },
  { title: 'Parse & Build', desc: 'Method, URL, headers and body are filled in.' },
  { title: 'Send', desc: 'Execute the request and inspect the response.' },
  { title: 'Generate', desc: 'Ask Ollama for cases per category.' },
  { title: 'Manage', desc: 'Edit, duplicate, or delete generated cases.' },
  { title: 'Run', desc: 'Run a single case or the full suite.' },
  { title: 'Export', desc: 'Download structured CSV for QA tooling.' },
];

export default function FlowDiagram() {
  return (
    <div className="card spec" data-spec="E · flow">
      <div className="card-header">
        <h3>Workflow</h3>
        <span className="h-meta">7 stations</span>
      </div>
      <div className="card-body">
        <div className="flow">
          {STEPS.map((s, i) => (
            <div className="step" key={s.title}>
              <span className="num">{(i + 1).toString().padStart(2, '0')}</span>
              <div className="title">{s.title}</div>
              <div className="desc">{s.desc}</div>
              <span className="arrow"><I.ArrowRight size={12} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
