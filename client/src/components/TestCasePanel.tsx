import { TestCase, TestResult } from '../types';
import I from './Icons';

interface Props {
  cases: TestCase[];
  results: Record<string, TestResult>;
  running: Record<string, boolean>;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRun: (id: string) => void;
  onClear: () => void;
  onExportCsv: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  positive: 'Positive',
  negative: 'Negative',
  'missing-field': 'Missing',
  boundary: 'Boundary',
  empty: 'Empty',
  duplicate: 'Duplicate',
  security: 'Security',
  'large-payload': 'Large',
  'special-characters': 'Special',
  custom: 'Custom',
};

export default function TestCasePanel({
  cases,
  results,
  running,
  onAdd,
  onEdit,
  onDelete,
  onDuplicate,
  onRun,
  onClear,
  onExportCsv,
}: Props) {
  return (
    <div className="card spec" data-spec="C · cases">
      <div className="card-header">
        <h3>Test Cases · <span style={{ color: 'var(--acid)' }}>{cases.length.toString().padStart(2, '0')}</span></h3>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn sm" onClick={onAdd}>
            <I.Plus size={12} /> Add
          </button>
          <button className="btn sm ghost" onClick={onExportCsv} disabled={cases.length === 0}>
            <I.Download size={12} /> CSV
          </button>
          <button className="btn sm danger-ghost" onClick={onClear} disabled={cases.length === 0}>
            <I.Trash size={12} /> Clear
          </button>
        </div>
      </div>
      <div className="card-body">
        {cases.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: 0 }}>
            <span className="label">empty</span>
            <div className="title">Click <em>Generate</em> to compose a specimen.</div>
            <span style={{ fontSize: 12.5 }}>
              You choose how many positive, negative, and edge cases to ask the model for.
            </span>
          </div>
        ) : (
          <div className="tc-list">
            {cases.map((tc, idx) => {
              const result = results[tc.id];
              const isRunning = !!running[tc.id];
              const statusClass = !result ? 'pending' : result.passed ? 'pass' : 'fail';
              const wrapperClass = !result
                ? 'tc-card pending-status'
                : result.passed
                  ? 'tc-card passed'
                  : 'tc-card failed';
              const statusIcon = !result ? '·' : result.passed ? '✓' : result.error ? '⚠' : '✕';
              const statusLabel = !result ? 'Pending' : result.passed ? 'Passed' : result.error ? 'Error' : 'Failed';
              return (
                <div className={wrapperClass} key={tc.id}>
                  <div className="seq">{(idx + 1).toString().padStart(2, '0')}</div>
                  <div className="body">
                    <div className="top">
                      <span className={`method-pill ${tc.method}`}>{tc.method}</span>
                      <span className="name" title={tc.name}>{tc.name}</span>
                      <span className={`status-pill ${statusClass}`}>
                        {statusIcon} {statusLabel}
                      </span>
                    </div>
                    <div className="endpoint" title={tc.url}>{tc.url}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="cat-tag">{CATEGORY_LABELS[tc.category] || tc.category}</span>
                      {result && !result.error && (
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--mute-2)', letterSpacing: '0.06em' }}>
                          {result.status} · {result.duration}ms
                        </span>
                      )}
                      <div className="actions" style={{ marginLeft: 'auto' }}>
                        <button className="btn sm" onClick={() => onRun(tc.id)} disabled={isRunning}>
                          {isRunning ? <span className="spinner" /> : <I.Play size={11} />}
                          Run
                        </button>
                        <button className="icon-btn" onClick={() => onEdit(tc.id)} title="Edit / load to builder">
                          <I.Edit />
                        </button>
                        <button className="icon-btn" onClick={() => onDuplicate(tc.id)} title="Duplicate">
                          <I.Copy />
                        </button>
                        <button className="icon-btn" onClick={() => onDelete(tc.id)} title="Delete">
                          <I.Trash />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
