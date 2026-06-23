import { useState } from 'react';
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="card has-divider">
      <div className="card-header">
        <h3>
          Test Cases
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--mute)' }}>
            {cases.length}
          </span>
        </h3>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn xs" onClick={onAdd}>
            <I.Plus size={11} /> Add
          </button>
          <button className="btn xs ghost" onClick={onExportCsv} disabled={cases.length === 0}>
            <I.Download size={11} /> CSV
          </button>
          <button className="btn xs danger-ghost" onClick={onClear} disabled={cases.length === 0}>
            <I.Trash size={11} /> Clear
          </button>
        </div>
      </div>
      <div className="card-body" style={{ paddingTop: 16 }}>
        {cases.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: 0 }}>
            <span className="label">Empty</span>
            <div className="title">Click Generate to create test cases.</div>
            <span style={{ fontSize: 12.5 }}>
              Choose how many positive, negative, and edge cases to generate.
            </span>
          </div>
        ) : (
          <div className="tc-list">
            {cases.map((tc, idx) => {
              const result = results[tc.id];
              const isRunning = !!running[tc.id];
              const isExpanded = !!expanded[tc.id];
              const statusClass = !result ? 'pending' : result.passed ? 'pass' : 'fail';
              const wrapperClass = !result
                ? 'tc-card pending-status'
                : result.passed
                  ? 'tc-card passed'
                  : 'tc-card failed';
              const statusIcon = !result ? '·' : result.passed ? '✓' : result.error ? '!' : '✕';
              const statusLabel = !result ? 'Pending' : result.passed ? 'Passed' : result.error ? 'Error' : 'Failed';
              const assertions = result?.assertions ?? [];
              const failedCount = assertions.filter(a => !a.passed).length;
              const passedCount = assertions.filter(a => a.passed).length;
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
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--mute)' }}>
                          {result.status} · {result.duration}ms · {assertions.length > 0 && `${passedCount}/${assertions.length} checks`}
                        </span>
                      )}
                      {result && result.error && (
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--err)' }}>
                          {result.error}
                        </span>
                      )}
                      <div className="actions" style={{ marginLeft: 'auto' }}>
                        {assertions.length > 0 && (
                          <button
                            className="btn xs ghost"
                            onClick={() => toggle(tc.id)}
                            title={isExpanded ? 'Hide details' : 'Show assertions'}
                          >
                            {isExpanded ? 'Hide' : 'Details'}
                            {failedCount > 0 && (
                              <span style={{ color: 'var(--err)', marginLeft: 2 }}>· {failedCount}</span>
                            )}
                          </button>
                        )}
                        <button className="btn xs" onClick={() => onRun(tc.id)} disabled={isRunning}>
                          {isRunning ? <span className="spinner" /> : <I.Play size={10} />}
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

                    {isExpanded && assertions.length > 0 && (
                      <div className="tc-assertions">
                        {assertions.map((a, i) => (
                          <div key={i} className={`tc-assertion ${a.passed ? 'pass' : 'fail'}`}>
                            <span className="mark">{a.passed ? '✓' : '✕'}</span>
                            <span className="label" title={a.message}>{a.name}</span>
                            <span className="detail">
                              {a.passed
                                ? a.actual
                                : `expected ${a.expected} · got ${a.actual}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
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
