import I from './Icons';

interface Props {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  onRunAll: () => void;
  running: boolean;
}

export default function TestRunSummary({ total, passed, failed, skipped, onRunAll, running }: Props) {
  const completed = passed + failed;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

  const size = 112;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const passDash = total === 0 ? 0 : (passed / total) * c;
  const failDash = total === 0 ? 0 : (failed / total) * c;

  return (
    <div className="card spec" data-spec="D · summary">
      <div className="card-header">
        <h3>Run Summary</h3>
        <button className="btn primary sm" onClick={onRunAll} disabled={running || total === 0}>
          {running ? <span className="spinner" /> : <I.Play size={11} />}
          Run All
        </button>
      </div>
      <div className="card-body">
        <div className="summary">
          <svg className="chart" viewBox={`0 0 ${size} ${size}`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rule)" strokeWidth={stroke} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--mint)"
              strokeWidth={stroke}
              strokeDasharray={`${passDash} ${c}`}
              strokeDashoffset={0}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--coral)"
              strokeWidth={stroke}
              strokeDasharray={`${failDash} ${c}`}
              strokeDashoffset={-passDash}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
            <text
              x={size / 2}
              y={size / 2 - 4}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="Fraunces, serif"
              fontStyle="italic"
              fontSize="26"
              fontWeight="500"
              fill="var(--cream)"
            >
              {pct}
            </text>
            <text
              x={size / 2}
              y={size / 2 + 18}
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
              fontSize="9"
              letterSpacing="2"
              fill="var(--mute)"
            >
              PCT
            </text>
          </svg>
          <div className="stats">
            <div className="row">
              <span className="swatch" style={{ background: 'var(--cream-2)' }} />
              <span className="label">Total</span>
              <span className="value">{total.toString().padStart(2, '0')}</span>
            </div>
            <div className="row">
              <span className="swatch" style={{ background: 'var(--mint)' }} />
              <span className="label">Passed</span>
              <span className="value" style={{ color: 'var(--mint)' }}>{passed.toString().padStart(2, '0')}</span>
            </div>
            <div className="row">
              <span className="swatch" style={{ background: 'var(--coral)' }} />
              <span className="label">Failed</span>
              <span className="value" style={{ color: 'var(--coral)' }}>{failed.toString().padStart(2, '0')}</span>
            </div>
            <div className="row">
              <span className="swatch" style={{ background: 'var(--rule-strong)' }} />
              <span className="label">Skipped</span>
              <span className="value" style={{ color: 'var(--mute-2)' }}>{skipped.toString().padStart(2, '0')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
