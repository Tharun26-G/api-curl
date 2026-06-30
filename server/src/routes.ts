import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import { parseMultipleCurls } from './curlParser';
import { runTestCase, runRequest } from './runner';
import {
  generateCases,
  buildPrompt,
  extractJsonArray,
  fromOllama,
  profileRequest,
  buildDeterministicCase,
  defaultSteps,
  OllamaGenerated,
  deterministicCases
} from './aiGenerator';
import { getConfig, updateConfig } from './config';
import { TestCase, TestCategory } from './types';

const router = Router();

const MAX_BATCH_TESTS = 200;
const MAX_RUN_CONCURRENCY = 6;

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asHeaders(v: unknown): Record<string, string> {
  if (!isPlainObject(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof k === 'string' && typeof val === 'string') out[k] = val;
  }
  return out;
}

async function mapWithConcurrency<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

router.post('/parse-curl', (req: Request, res: Response) => {
  const { curl } = req.body || {};
  if (!isString(curl) || curl.trim().length === 0) {
    res.status(400).json({ error: 'curl command is required' });
    return;
  }
  if (curl.length > 100_000) {
    res.status(413).json({ error: 'curl payload too large' });
    return;
  }
  try {
    const testCases = parseMultipleCurls(curl);
    res.json({ testCases });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to parse curl command' });
  }
});

router.post('/send', async (req: Request, res: Response) => {
  const { method, url, headers, body } = req.body || {};
  if (!isString(url) || url.trim().length === 0) {
    res.status(400).json({ error: 'url is required' });
    return;
  }
  try {
    const response = await runRequest({
      method: isString(method) ? method.toUpperCase() : 'GET',
      url,
      headers: asHeaders(headers),
      body: body == null ? null : isString(body) ? body : JSON.stringify(body),
    });
    res.json({ response });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to send request' });
  }
});

router.post('/run-test', async (req: Request, res: Response) => {
  const { testCase } = req.body || {};
  if (!isPlainObject(testCase) || !isString((testCase as any).url)) {
    res.status(400).json({ error: 'testCase with at least { url } is required' });
    return;
  }
  try {
    const result = await runTestCase(testCase as unknown as TestCase);
    res.json({ result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to run test' });
  }
});

router.post('/run-all', async (req: Request, res: Response) => {
  const { testCases } = req.body || {};
  if (!Array.isArray(testCases) || testCases.length === 0) {
    res.status(400).json({ error: 'testCases array is required' });
    return;
  }
  if (testCases.length > MAX_BATCH_TESTS) {
    res.status(413).json({ error: `Batch exceeds maximum of ${MAX_BATCH_TESTS} cases` });
    return;
  }
  try {
    const results = await mapWithConcurrency(testCases as TestCase[], MAX_RUN_CONCURRENCY, tc => runTestCase(tc));
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to run tests' });
  }
});

router.post('/generate-cases', async (req: Request, res: Response) => {
  const { method, url, headers, body, counts, customPrompt, customCount } = req.body || {};
  if (!isString(url) || url.trim().length === 0) {
    res.status(400).json({ error: 'url is required' });
    return;
  }
  try {
    const result = await generateCases(
      {
        method: isString(method) ? method.toUpperCase() : 'GET',
        url,
        headers: asHeaders(headers),
        body: body == null ? null : isString(body) ? body : JSON.stringify(body),
      },
      {
        counts: isPlainObject(counts) ? (counts as any) : {},
        customPrompt: isString(customPrompt) ? customPrompt : '',
        customCount: typeof customCount === 'number' && customCount >= 0 ? customCount : 0,
      },
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to generate cases' });
  }
});

router.get('/ollama-status', async (_req: Request, res: Response) => {
  const cfg = getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const r = await fetch(`${cfg.url.replace(/\/$/, '')}/api/tags`, { signal: controller.signal as any });
    clearTimeout(timer);
    if (!r.ok) {
      res.json({ connected: false, error: `HTTP ${r.status}` });
      return;
    }
    const data: any = await r.json();
    const models: string[] = Array.isArray(data?.models)
      ? data.models.map((m: any) => m?.name).filter((n: any) => typeof n === 'string')
      : [];
    res.json({ connected: true, models });
  } catch (err: any) {
    clearTimeout(timer);
    const aborted = err?.name === 'AbortError';
    res.json({ connected: false, error: aborted ? 'timeout' : (err?.message || 'unreachable') });
  }
});

router.get('/config', (_req: Request, res: Response) => {
  res.json({ config: getConfig() });
});

router.post('/config', (req: Request, res: Response) => {
  const { url, model } = req.body || {};
  const patch: { url?: string; model?: string } = {};
  if (isString(url) && url.trim().length > 0) patch.url = url.trim();
  if (isString(model) && model.trim().length > 0) patch.model = model.trim();
  const updated = updateConfig(patch);
  res.json({ config: updated });
});

router.post('/ai/build-prompt', (req: Request, res: Response) => {
  const { spec, opts } = req.body || {};
  if (!spec || !isString(spec.url)) {
    res.status(400).json({ error: 'Request spec with url is required' });
    return;
  }
  try {
    const prompt = buildPrompt(spec, opts || {});
    res.json({ prompt });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to build prompt' });
  }
});

router.post('/ai/parse-cases', (req: Request, res: Response) => {
  const { spec, opts, responseText } = req.body || {};
  if (!spec || !isString(spec.url)) {
    res.status(400).json({ error: 'Request spec with url is required' });
    return;
  }

  function randomId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  try {
    const arr = extractJsonArray(responseText || '');
    if (!arr || arr.length === 0) {
      const fallback = deterministicCases(spec, opts || {});
      res.json({ cases: fallback, source: 'fallback', note: 'Model returned no parseable cases' });
      return;
    }

    const cases = fromOllama(arr as OllamaGenerated[], spec);
    if (cases.length === 0) {
      const fallback = deterministicCases(spec, opts || {});
      res.json({ cases: fallback, source: 'fallback', note: 'No valid cases extracted' });
      return;
    }

    // Top up with deterministic cases per category if Ollama under-delivered.
    const haveByCat: Partial<Record<TestCategory, number>> = {};
    for (const c of cases) haveByCat[c.category] = (haveByCat[c.category] || 0) + 1;
    const supplements: TestCase[] = [];
    const profile = profileRequest(spec);
    const deterministicCategories: TestCategory[] = [
      'positive',
      'negative',
      'missing-field',
      'empty',
      'boundary',
      'special-characters',
      'security',
      'large-payload',
      'duplicate',
    ];
    for (const cat of deterministicCategories) {
      const wanted = (opts.counts || {})[cat] || 0;
      const have = haveByCat[cat] || 0;
      const need = Math.max(0, wanted - have);
      for (let i = 0; i < need; i++) {
        const c = buildDeterministicCase(spec, cat, i, profile);
        if (c) supplements.push(c);
      }
    }

    if (opts.customPrompt && (opts.customCount || 0) > (haveByCat['custom'] || 0)) {
      const need = (opts.customCount as number) - (haveByCat['custom'] || 0);
      for (let i = 0; i < need; i++) {
        supplements.push({
          id: randomId(),
          name: `Verify custom scenario: ${opts.customPrompt.slice(0, 60)}${i > 0 ? ` (variant ${i + 1})` : ''}`,
          category: 'custom',
          method: spec.method,
          url: spec.url,
          headers: spec.headers,
          body: spec.body,
          expectedStatus: 200,
          description: opts.customPrompt,
          stepsToReproduce: defaultSteps(spec, `Apply the custom hint: ${opts.customPrompt}`),
          expectedResult: 'API behaviour matches the described custom scenario.',
          assertions: {
            expectStatusClass: ['2xx', '4xx'],
            disallowStatus: [500, 502, 503, 504],
            maxResponseTimeMs: 5_000,
          },
        });
      }
    }

    if (supplements.length === 0) {
      res.json({ cases, source: 'ollama' });
    } else {
      res.json({
        cases: [...cases, ...supplements],
        source: 'mixed',
        note: `Ollama returned ${cases.length}; topped up with ${supplements.length} deterministic case(s)`,
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to parse cases' });
  }
});

export default router;
