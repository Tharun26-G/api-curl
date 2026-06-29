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
): Promise<{ cases: TestCase[]; source: 'ollama' | 'fallback' | 'mixed'; note?: string }> {
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

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const res = await fetch(`${BASE}/ollama-status`);
  return asJson(res);
}
