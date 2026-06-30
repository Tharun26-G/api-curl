import { TestCase, TestResult, OllamaConfig, OllamaStatus, ResponseData } from '../types';

// If VITE_API_URL is set (production), use that as the backend base (append /api).
// Otherwise fall back to the dev proxy path `/api` which Vite forwards to the server.
const API_URL = (import.meta.env.VITE_API_URL as string) || '';
const BASE = API_URL ? `${API_URL.replace(/\/$/, '')}/api` : '/api';

async function asJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error) || `Request failed: ${res.status}`);
  return data as T;
}

export async function parseCurl(curl: string): Promise<TestCase[]> {
  const res = await fetch(`${BASE}/parse-curl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ curl }),
  });
  const data = await asJson<{ testCases: TestCase[] }>(res);
  return data.testCases;
}

export interface SendArgs {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export async function sendRequest(args: SendArgs): Promise<ResponseData> {
  const res = await fetch(`${BASE}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await asJson<{ response: ResponseData }>(res);
  return data.response;
}

export interface GenerateArgs extends SendArgs {
  counts: Record<string, number>;
  customPrompt?: string;
  customCount?: number;
}

export async function generateCases(
  args: GenerateArgs,
  config?: OllamaConfig,
): Promise<{ cases: TestCase[]; source: 'ollama' | 'fallback' | 'mixed'; note?: string }> {
  // If we have an Ollama configuration, try querying it directly from the client browser
  // to avoid cloud deployment network blocks (e.g. Vercel backend blocking local access).
  if (config && config.url) {
    try {
      // 1. Build the prompt using server-side logic
      const promptRes = await fetch(`${BASE}/ai/build-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: {
            method: args.method,
            url: args.url,
            headers: args.headers,
            body: args.body,
          },
          opts: {
            counts: args.counts,
            customPrompt: args.customPrompt,
            customCount: args.customCount,
          },
        }),
      });
      const { prompt } = await asJson<{ prompt: string }>(promptRes);

      // 2. Query the user's local/configured Ollama directly from their browser
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000); // 2 minute timeout

      const ollamaRes = await fetch(`${config.url.replace(/\/$/, '')}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          prompt,
          stream: false,
          options: { temperature: 0.35, top_p: 0.9 },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!ollamaRes.ok) {
        throw new Error(`Ollama returned HTTP status ${ollamaRes.status}`);
      }

      const ollamaData = await ollamaRes.json();
      const responseText = ollamaData?.response || '';

      // 3. Send raw Ollama response back to the server to parse and top up with deterministic cases
      const parseRes = await fetch(`${BASE}/ai/parse-cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: {
            method: args.method,
            url: args.url,
            headers: args.headers,
            body: args.body,
          },
          opts: {
            counts: args.counts,
            customPrompt: args.customPrompt,
            customCount: args.customCount,
          },
          responseText,
        }),
      });

      return asJson(parseRes);
    } catch (err: any) {
      console.warn('Direct client-side Ollama generation failed. Falling back to server-side:', err);
    }
  }

  // Fallback: standard server-side generation
  const res = await fetch(`${BASE}/generate-cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return asJson(res);
}

export async function runTest(testCase: TestCase): Promise<TestResult> {
  const res = await fetch(`${BASE}/run-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testCase }),
  });
  const data = await asJson<{ result: TestResult }>(res);
  return data.result;
}

export async function runAll(testCases: TestCase[]): Promise<TestResult[]> {
  const res = await fetch(`${BASE}/run-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testCases }),
  });
  const data = await asJson<{ results: TestResult[] }>(res);
  return data.results;
}

export async function getConfig(): Promise<OllamaConfig> {
  const res = await fetch(`${BASE}/config`);
  const data = await asJson<{ config: OllamaConfig }>(res);
  return data.config;
}

export async function updateConfig(config: Partial<OllamaConfig>): Promise<OllamaConfig> {
  const res = await fetch(`${BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = await asJson<{ config: OllamaConfig }>(res);
  return data.config;
}

export async function getOllamaStatus(url?: string): Promise<OllamaStatus> {
  if (url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        return { connected: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      const models = Array.isArray(data?.models)
        ? data.models.map((m: any) => m?.name).filter((n: any) => typeof n === 'string')
        : [];
      return { connected: true, models };
    } catch (err: any) {
      clearTimeout(timer);
      const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
      const errorMsg = err?.name === 'AbortError'
        ? 'Connection timeout'
        : `${err.message || 'unreachable'}${isLocal ? ' (Tip: Run Ollama with OLLAMA_ORIGINS=* environment variable to enable CORS)' : ''}`;
      return { connected: false, error: errorMsg };
    }
  }

  const res = await fetch(`${BASE}/ollama-status`);
  return asJson(res);
}
