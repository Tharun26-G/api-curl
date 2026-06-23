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
    <div className="card has-divider">
      <div className="card-header">
        <h3>Run summary</h3>
        <button className="btn primary sm" onClick={onRunAll} disabled={running || total === 0}>
          {running ? <span className="spinner" /> : <I.Play size={11} />}
          Run all
        </button>
      </div>
      <div className="card-body" style={{ paddingTop: 16 }}>
        <div className="summary">
          <svg className="chart" viewBox={`0 0 ${size} ${size}`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--ok)"
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
              stroke="var(--err)"
              strokeWidth={stroke}
              strokeDasharray={`${failDash} ${c}`}
              strokeDashoffset={-passDash}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
            <text
              x={size / 2}
              y={size / 2 - 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="Inter, sans-serif"
              fontSize="22"
              fontWeight="700"
              fill="var(--ink)"
            >
              {pct}%
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
              PASSED
            </text>
          </svg>
          <div className="stats">
            <div className="row">
              <span className="swatch" style={{ background: 'var(--ink)' }} />
              <span className="label">Total</span>
              <span className="value">{total}</span>
            </div>
            <div className="row">
              <span className="swatch" style={{ background: 'var(--ok)' }} />
              <span className="label">Passed</span>
              <span className="value" style={{ color: 'var(--ok)' }}>{passed}</span>
            </div>
            <div className="row">
              <span className="swatch" style={{ background: 'var(--err)' }} />
              <span className="label">Failed</span>
              <span className="value" style={{ color: 'var(--err)' }}>{failed}</span>
            </div>
            <div className="row">
              <span className="swatch" style={{ background: 'var(--line-strong)' }} />
              <span className="label">Pending</span>
              <span className="value" style={{ color: 'var(--mute)' }}>{skipped}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
