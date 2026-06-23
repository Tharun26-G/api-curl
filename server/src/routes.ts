import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import { parseMultipleCurls } from './curlParser';
import { runTestCase, runRequest } from './runner';
import { generateCases } from './aiGenerator';
import { getConfig, updateConfig } from './config';
import { TestCase } from './types';

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

export default router;
