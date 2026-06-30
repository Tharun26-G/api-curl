import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api';
import {
  CategoryCounts,
  Collection,
  Environment,
  OllamaConfig,
  OllamaStatus,
  ResponseData,
  SavedRequest,
  TestCase,
  TestResult,
} from './types';
import Navbar from './components/Navbar';
import Sidebar, { SidebarKey } from './components/Sidebar';
import RequestBuilder, { RequestState } from './components/RequestBuilder';
import ResponsePanel from './components/ResponsePanel';
import TestCasePanel from './components/TestCasePanel';
import TestRunSummary from './components/TestRunSummary';
import CurlModal from './components/CurlModal';
import GenerateModal from './components/GenerateModal';
import CollectionsView from './components/CollectionsView';
import EnvironmentsView from './components/EnvironmentsView';
import { loadJSON, saveJSON } from './storage';
import { substitute, substituteHeaders } from './vars';
import { downloadCSV, testCasesToCSV } from './csv';

const DEFAULT_REQUEST: RequestState = {
  method: 'POST',
  url: 'https://api.acme.co/v1/users',
  headers: { 'Content-Type': 'application/json' },
  params: {},
  body: JSON.stringify({ name: 'Olivia Park', role: 'designer' }, null, 2),
  auth: '',
};

function randomId() {
  return Math.random().toString(36).substring(2, 10);
}

function appendQuery(url: string, params: Record<string, string>): string {
  const keys = Object.keys(params);
  if (keys.length === 0) return url;
  try {
    const u = new URL(url);
    for (const k of keys) u.searchParams.set(k, params[k]);
    return u.toString();
  } catch {
    const qs = keys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
  }
}

function mergeAuth(headers: Record<string, string>, auth: string): Record<string, string> {
  const trimmed = auth.trim();
  if (!trimmed) return headers;
  if (trimmed.toLowerCase().startsWith('authorization:')) {
    return { ...headers, Authorization: trimmed.substring(trimmed.indexOf(':') + 1).trim() };
  }
  return { ...headers, Authorization: trimmed };
}

function pageTitle(active: SidebarKey): { title: string; sub: string } {
  switch (active) {
    case 'request':
      return { title: 'Request', sub: 'Build, send, and inspect a single API call.' };
    case 'tests':
      return { title: 'Test cases', sub: 'Generated assertions and run history.' };
    case 'collections':
      return { title: 'Collections', sub: 'Save and reuse named requests.' };
    case 'environments':
      return { title: 'Environments', sub: 'Variables substituted into URLs, headers, and bodies.' };
  }
}

export default function App() {
  const [activeNav, setActiveNav] = useState<SidebarKey>('request');
  const [request, setRequest] = useState<RequestState>(() => {
    const raw = loadJSON<any>('request', DEFAULT_REQUEST);
    // Migrate from older shape that included preScript/tests
    const { preScript: _p, tests: _t, ...clean } = raw || {};
    return { ...DEFAULT_REQUEST, ...clean };
  });
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [sending, setSending] = useState(false);

  const [testCases, setTestCases] = useState<TestCase[]>(() => loadJSON('testCases', [] as TestCase[]));
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [runningAll, setRunningAll] = useState(false);

  const [collections, setCollections] = useState<Collection[]>(() => loadJSON('collections', [] as Collection[]));
  const [environments, setEnvironments] = useState<Environment[]>(() => loadJSON('environments', [] as Environment[]));
  const [activeEnvId, setActiveEnvId] = useState<string | null>(() => loadJSON<string | null>('activeEnv', null));

  const [config, setConfig] = useState<OllamaConfig>(() =>
    loadJSON('ollama', { url: 'http://localhost:11434', model: 'llama3' } as OllamaConfig),
  );
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({ connected: false });

  const [curlOpen, setCurlOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [toast, setToast] = useState<{ msg: string; kind: 'info' | 'error' } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string, kind: 'info' | 'error' = 'info') => {
    setToast({ msg, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => { saveJSON('request', request); }, [request]);
  useEffect(() => { saveJSON('testCases', testCases); }, [testCases]);
  useEffect(() => { saveJSON('collections', collections); }, [collections]);
  useEffect(() => { saveJSON('environments', environments); }, [environments]);
  useEffect(() => { saveJSON('activeEnv', activeEnvId); }, [activeEnvId]);
  useEffect(() => { saveJSON('ollama', config); }, [config]);

  useEffect(() => {
    api.getConfig().then(srv => {
      const stored = loadJSON<OllamaConfig | null>('ollama', null as any);
      if (!stored) setConfig(srv);
    }).catch(() => {});
  }, []);

  const refreshStatus = useCallback(() => {
    api.getOllamaStatus(config.url).then(setOllamaStatus).catch(() => setOllamaStatus({ connected: false }));
  }, [config.url]);

  useEffect(() => {
    refreshStatus();
    const id = window.setInterval(refreshStatus, 15000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  const activeEnv = useMemo(
    () => environments.find(e => e.id === activeEnvId) || null,
    [environments, activeEnvId],
  );
  const vars = useMemo(() => activeEnv?.vars ?? {}, [activeEnv]);

  const handleConfigChange = useCallback(
    (cfg: OllamaConfig) => {
      setConfig(cfg);
      api.updateConfig(cfg).then(() => refreshStatus()).catch(() => {});
    },
    [refreshStatus],
  );

  const buildSendArgs = useCallback((): api.SendArgs => {
    const resolvedUrl = substitute(request.url.trim(), vars);
    const url = appendQuery(resolvedUrl, request.params);
    const headers = substituteHeaders(mergeAuth(request.headers, request.auth), vars);
    const body = ['GET', 'HEAD'].includes(request.method.toUpperCase())
      ? null
      : substitute(request.body || '', vars) || null;
    return { method: request.method.toUpperCase(), url, headers, body };
  }, [request, vars]);

  const handleSend = useCallback(async () => {
    if (!request.url.trim()) return;
    setSending(true);
    try {
      const resp = await api.sendRequest(buildSendArgs());
      setResponse(resp);
      if (resp.error) showToast(`Send failed — ${resp.error}`, 'error');
    } catch (err: any) {
      showToast(err.message || 'Failed to send', 'error');
    } finally {
      setSending(false);
    }
  }, [buildSendArgs, request.url, showToast]);

  const handleGenerate = useCallback(
    async (counts: CategoryCounts, customPrompt: string, customCount: number) => {
      if (!request.url.trim()) {
        showToast('Set a URL first', 'error');
        return;
      }
      setGenerating(true);
      try {
        const result = await api.generateCases(
          {
            ...buildSendArgs(),
            counts: counts as Record<string, number>,
            customPrompt,
            customCount,
          },
          config
        );
        setTestCases(prev => [...result.cases, ...prev]);
        setResults({});
        setActiveNav('tests');
        setGenOpen(false);
        if (result.source === 'fallback') {
          showToast(`Generated ${result.cases.length} cases (fallback · ${result.note || 'Ollama offline'})`);
        } else {
          showToast(`Generated ${result.cases.length} cases via Ollama`);
        }
      } catch (err: any) {
        showToast(err.message || 'Failed to generate', 'error');
      } finally {
        setGenerating(false);
      }
    },
    [buildSendArgs, request.url, showToast],
  );

  const handleAddCase = useCallback(() => {
    const args = buildSendArgs();
    const newCase: TestCase = {
      id: randomId(),
      name: `Verify ${args.method} ${args.url}`.slice(0, 100),
      category: 'custom',
      method: args.method,
      url: args.url,
      headers: args.headers,
      body: args.body,
    };
    setTestCases(prev => [newCase, ...prev]);
    showToast('Added current request as a custom case');
    setActiveNav('tests');
  }, [buildSendArgs, showToast]);

  const handleDelete = useCallback((id: string) => {
    setTestCases(prev => prev.filter(tc => tc.id !== id));
    setResults(prev => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const handleDuplicate = useCallback((id: string) => {
    setTestCases(prev => {
      const idx = prev.findIndex(tc => tc.id === id);
      if (idx === -1) return prev;
      const original = prev[idx];
      const copy: TestCase = { ...original, id: randomId(), name: `${original.name} (copy)` };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  }, []);

  const handleEdit = useCallback(
    (id: string) => {
      const tc = testCases.find(t => t.id === id);
      if (!tc) return;
      setRequest(prev => ({
        ...prev,
        method: tc.method,
        url: tc.url,
        headers: tc.headers,
        body: tc.body || '',
      }));
      setActiveNav('request');
      showToast(`Loaded "${tc.name}" into builder`);
    },
    [testCases, showToast],
  );

  const handleRunOne = useCallback(async (id: string) => {
    const tc = testCases.find(t => t.id === id);
    if (!tc) return;
    setRunning(prev => ({ ...prev, [id]: true }));
    try {
      const resolved: TestCase = {
        ...tc,
        url: substitute(tc.url, vars),
        headers: substituteHeaders(tc.headers, vars),
        body: tc.body ? substitute(tc.body, vars) : null,
      };
      const result = await api.runTest(resolved);
      setResults(prev => ({ ...prev, [id]: { ...result, testCase: tc } }));
    } catch (err: any) {
      showToast(err.message || 'Run failed', 'error');
    } finally {
      setRunning(prev => ({ ...prev, [id]: false }));
    }
  }, [testCases, vars, showToast]);

  const handleRunAll = useCallback(async () => {
    if (testCases.length === 0) {
      showToast('No test cases to run', 'error');
      return;
    }
    setRunningAll(true);
    try {
      const resolved = testCases.map(tc => ({
        ...tc,
        url: substitute(tc.url, vars),
        headers: substituteHeaders(tc.headers, vars),
        body: tc.body ? substitute(tc.body, vars) : null,
      }));
      const all = await api.runAll(resolved);
      const map: Record<string, TestResult> = {};
      all.forEach((r, i) => {
        const original = testCases[i];
        map[original.id] = { ...r, testCase: original };
      });
      setResults(map);
      const passed = all.filter(r => r.passed).length;
      showToast(`Ran ${all.length} cases · ${passed} passed`);
    } catch (err: any) {
      showToast(err.message || 'Run all failed', 'error');
    } finally {
      setRunningAll(false);
    }
  }, [testCases, vars, showToast]);

  const handleClearCases = useCallback(() => {
    if (testCases.length === 0) return;
    if (!window.confirm(`Remove all ${testCases.length} test case(s)?`)) return;
    setTestCases([]);
    setResults({});
    showToast('Cleared test cases');
  }, [testCases.length, showToast]);

  const handleExportCsv = useCallback(() => {
    if (testCases.length === 0) {
      showToast('Nothing to export', 'error');
      return;
    }
    const csv = testCasesToCSV(testCases);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadCSV(`api-workbench-tests-${stamp}.csv`, csv);
    showToast(`Exported ${testCases.length} cases to CSV`);
  }, [testCases, showToast]);

  const handleImportCurl = useCallback(async (curl: string) => {
    setParsing(true);
    try {
      const parsed = await api.parseCurl(curl);
      if (parsed.length === 0) {
        showToast('No valid curl command found', 'error');
        return;
      }
      const first = parsed[0];
      setRequest({
        method: first.method,
        url: first.url,
        headers: first.headers,
        params: {},
        body: first.body || '',
        auth: '',
      });
      if (parsed.length > 1) {
        const extras: TestCase[] = parsed.slice(1).map(tc => ({ ...tc, id: randomId() }));
        setTestCases(prev => [...extras, ...prev]);
        showToast(`Loaded first request; added ${extras.length} more as cases`);
      } else {
        showToast('Loaded request from cURL');
      }
      setCurlOpen(false);
      setActiveNav('request');
    } catch (err: any) {
      showToast(err.message || 'Failed to parse cURL', 'error');
    } finally {
      setParsing(false);
    }
  }, [showToast]);

  const handleNewRequest = useCallback(() => {
    setRequest(DEFAULT_REQUEST);
    setResponse(null);
    setActiveNav('request');
  }, []);

  // Collections
  const handleCreateCollection = useCallback((name: string) => {
    const col: Collection = { id: randomId(), name, requests: [] };
    setCollections(prev => [col, ...prev]);
  }, []);
  const handleRenameCollection = useCallback((id: string, name: string) => {
    setCollections(prev => prev.map(c => (c.id === id ? { ...c, name } : c)));
  }, []);
  const handleDeleteCollection = useCallback((id: string) => {
    if (!window.confirm('Delete this collection?')) return;
    setCollections(prev => prev.filter(c => c.id !== id));
  }, []);
  const handleSaveCurrentToCollection = useCallback(
    (collectionId: string, name: string) => {
      const saved: SavedRequest = {
        id: randomId(),
        name,
        method: request.method,
        url: request.url,
        headers: request.headers,
        params: request.params,
        body: request.body,
        auth: request.auth,
        updatedAt: Date.now(),
      };
      setCollections(prev =>
        prev.map(c => (c.id === collectionId ? { ...c, requests: [saved, ...c.requests] } : c)),
      );
      showToast(`Saved "${name}"`);
    },
    [request, showToast],
  );
  const handleLoadSavedRequest = useCallback((req: SavedRequest) => {
    setRequest({
      method: req.method,
      url: req.url,
      headers: req.headers,
      params: req.params,
      body: req.body,
      auth: req.auth,
    });
    setActiveNav('request');
    showToast(`Loaded "${req.name}"`);
  }, [showToast]);
  const handleRemoveRequest = useCallback((collectionId: string, requestId: string) => {
    setCollections(prev =>
      prev.map(c => (c.id === collectionId ? { ...c, requests: c.requests.filter(r => r.id !== requestId) } : c)),
    );
  }, []);

  // Environments
  const handleCreateEnv = useCallback((name: string) => {
    const env: Environment = { id: randomId(), name, vars: {} };
    setEnvironments(prev => [env, ...prev]);
  }, []);
  const handleRenameEnv = useCallback((id: string, name: string) => {
    setEnvironments(prev => prev.map(e => (e.id === id ? { ...e, name } : e)));
  }, []);
  const handleDeleteEnv = useCallback((id: string) => {
    if (!window.confirm('Delete this environment?')) return;
    setEnvironments(prev => prev.filter(e => e.id !== id));
    if (activeEnvId === id) setActiveEnvId(null);
  }, [activeEnvId]);
  const handleUpdateVars = useCallback((id: string, varsMap: Record<string, string>) => {
    setEnvironments(prev => prev.map(e => (e.id === id ? { ...e, vars: varsMap } : e)));
  }, []);

  const summary = useMemo(() => {
    const total = testCases.length;
    let passed = 0;
    let failed = 0;
    for (const tc of testCases) {
      const r = results[tc.id];
      if (!r) continue;
      if (r.passed) passed++; else failed++;
    }
    const skipped = total - passed - failed;
    return { total, passed, failed, skipped };
  }, [testCases, results]);

  const title = pageTitle(activeNav);

  return (
    <div className="app">
      <Navbar
        models={ollamaStatus.models || []}
        selectedModel={config.model}
        onSelectModel={m => handleConfigChange({ ...config, model: m })}
        environments={environments}
        activeEnvId={activeEnvId}
        onSelectEnv={setActiveEnvId}
        onNewRequest={handleNewRequest}
        onImportCurl={() => setCurlOpen(true)}
        onGenerateCases={() => setGenOpen(true)}
        onRunAll={handleRunAll}
        onExportCsv={handleExportCsv}
        generating={generating}
        runningAll={runningAll}
        testsCount={testCases.length}
      />
      <div className="shell">
        <Sidebar
          active={activeNav}
          onSelect={setActiveNav}
          config={config}
          status={ollamaStatus}
          models={ollamaStatus.models || []}
          onConfigChange={handleConfigChange}
          testsCount={testCases.length}
          collectionsCount={collections.length}
          environmentsCount={environments.length}
        />
        <div className="main">
          <div className="center">
            <div className="page-head">
              <div>
                <h1>{title.title}</h1>
                <div className="sub">{title.sub}</div>
              </div>
              <span className="crumb">
                {activeEnv ? <>env <b>{activeEnv.name}</b></> : 'no env'}
              </span>
            </div>

            {activeNav === 'request' && (
              <>
                <RequestBuilder
                  state={request}
                  onChange={setRequest}
                  onSend={handleSend}
                  sending={sending}
                />
                <ResponsePanel response={response} sending={sending} />
              </>
            )}

            {activeNav === 'tests' && (
              <TestCasePanel
                cases={testCases}
                results={results}
                running={running}
                onAdd={handleAddCase}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onDuplicate={handleDuplicate}
                onRun={handleRunOne}
                onClear={handleClearCases}
                onExportCsv={handleExportCsv}
              />
            )}

            {activeNav === 'collections' && (
              <CollectionsView
                collections={collections}
                onCreate={handleCreateCollection}
                onRename={handleRenameCollection}
                onDelete={handleDeleteCollection}
                onSaveCurrent={handleSaveCurrentToCollection}
                onLoad={handleLoadSavedRequest}
                onRemoveRequest={handleRemoveRequest}
                currentRequest={request}
              />
            )}

            {activeNav === 'environments' && (
              <EnvironmentsView
                environments={environments}
                activeId={activeEnvId}
                onCreate={handleCreateEnv}
                onRename={handleRenameEnv}
                onDelete={handleDeleteEnv}
                onSetActive={setActiveEnvId}
                onUpdateVars={handleUpdateVars}
              />
            )}
          </div>

          <div className="right">
            {activeNav !== 'tests' && (
              <TestCasePanel
                cases={testCases}
                results={results}
                running={running}
                onAdd={handleAddCase}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onDuplicate={handleDuplicate}
                onRun={handleRunOne}
                onClear={handleClearCases}
                onExportCsv={handleExportCsv}
              />
            )}
            <TestRunSummary
              total={summary.total}
              passed={summary.passed}
              failed={summary.failed}
              skipped={summary.skipped}
              onRunAll={handleRunAll}
              running={runningAll}
            />
          </div>
        </div>
      </div>

      <CurlModal
        open={curlOpen}
        onClose={() => setCurlOpen(false)}
        onImport={handleImportCurl}
        loading={parsing}
      />

      <GenerateModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        onGenerate={handleGenerate}
        loading={generating}
      />

      {toast && (
        <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`}>{toast.msg}</div>
      )}
    </div>
  );
}
