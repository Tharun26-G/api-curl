import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import { parseMultipleCurls } from './curlParser';
import { runTestCase, runRequest } from './runner';
import { generateCases } from './aiGenerator';
import { getConfig, updateConfig } from './config';

const router = Router();

router.post('/parse-curl', (req: Request, res: Response) => {
  const { curl } = req.body;
  if (!curl || typeof curl !== 'string') {
    res.status(400).json({ error: 'curl command is required' });
    return;
  }
  try {
    const testCases = parseMultipleCurls(curl);
    res.json({ testCases });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to parse curl command' });
  }
});

router.post('/send', async (req: Request, res: Response) => {
  const { method, url, headers, body } = req.body || {};
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }
  try {
    const response = await runRequest({
      method: (method || 'GET').toUpperCase(),
      url,
      headers: headers || {},
      body: body ?? null,
    });
    res.json({ response });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to send request' });
  }
});

router.post('/run-test', async (req: Request, res: Response) => {
  const { testCase } = req.body;
  if (!testCase) {
    res.status(400).json({ error: 'testCase is required' });
    return;
  }
  try {
    const result = await runTestCase(testCase);
    res.json({ result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to run test' });
  }
});

router.post('/run-all', async (req: Request, res: Response) => {
  const { testCases } = req.body;
  if (!Array.isArray(testCases) || testCases.length === 0) {
    res.status(400).json({ error: 'testCases array is required' });
    return;
  }
  try {
    const results = await Promise.all(testCases.map(tc => runTestCase(tc)));
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to run tests' });
  }
});

router.post('/generate-cases', async (req: Request, res: Response) => {
  const { method, url, headers, body, counts, customPrompt, customCount } = req.body || {};
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }
  try {
    const result = await generateCases(
      {
        method: (method || 'GET').toUpperCase(),
        url,
        headers: headers || {},
        body: body ?? null,
      },
      {
        counts: counts || {},
        customPrompt: typeof customPrompt === 'string' ? customPrompt : '',
        customCount: typeof customCount === 'number' ? customCount : 0,
      },
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate cases' });
  }
});

router.get('/ollama-status', async (_req: Request, res: Response) => {
  const cfg = getConfig();
  try {
    const r = await fetch(`${cfg.url.replace(/\/$/, '')}/api/tags`);
    if (!r.ok) {
      res.json({ connected: false, error: `HTTP ${r.status}` });
      return;
    }
    const data: any = await r.json();
    const models: string[] = Array.isArray(data?.models)
      ? data.models.map((m: any) => m.name).filter(Boolean)
      : [];
    res.json({ connected: true, models });
  } catch (err: any) {
    res.json({ connected: false, error: err?.message || 'unreachable' });
  }
});

router.get('/config', (_req: Request, res: Response) => {
  res.json({ config: getConfig() });
});

router.post('/config', (req: Request, res: Response) => {
  const { url, model } = req.body;
  const updated = updateConfig({ url, model });
  res.json({ config: updated });
});

export default router;
