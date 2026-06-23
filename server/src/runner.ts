import fetch from 'node-fetch';
import { TestCase, TestResult, RequestSpec, ResponseData, OllamaConfig } from './types';
import { getConfig } from './config';
import { evaluate } from './assertions';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8MB hard cap to protect memory

function substitute(value: string, cfg: OllamaConfig): string {
  return value.replace(/\{\{OLLAMA_URL\}\}/g, cfg.url).replace(/\{\{MODEL\}\}/g, cfg.model);
}

function validateUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Malformed URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Unsupported protocol "${url.protocol}"` };
  }
  if (!url.hostname) {
    return { ok: false, reason: 'URL is missing a host' };
  }
  return { ok: true, url };
}

async function readBodyCapped(response: import('node-fetch').Response): Promise<string> {
  // node-fetch v2 returns a Node Readable; read it in chunks and abort if we exceed cap.
  const stream = response.body as unknown as NodeJS.ReadableStream | null;
  if (!stream) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  return await new Promise<string>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_RESPONSE_BYTES) {
        (stream as any).destroy?.(new Error(`Response exceeded ${MAX_RESPONSE_BYTES} byte cap`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', err => reject(err));
  });
}

export async function runRequest(
  spec: RequestSpec,
  config?: OllamaConfig,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<ResponseData> {
  const cfg = config || getConfig();
  const start = Date.now();

  const validated = validateUrl(substitute(spec.url, cfg));
  if (!validated.ok) {
    return {
      status: 0,
      statusText: 'Invalid URL',
      headers: {},
      body: '',
      duration: 0,
      size: 0,
      error: validated.reason,
    };
  }

  const requestHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec.headers || {})) {
    if (typeof k !== 'string' || typeof v !== 'string') continue;
    if (k.trim() === '') continue;
    // Strip headers the runtime will set itself.
    const lower = k.toLowerCase();
    if (lower === 'host' || lower === 'content-length') continue;
    requestHeaders[k] = substitute(v, cfg);
  }

  let body: string | undefined;
  const methodUpper = (spec.method || 'GET').toUpperCase();
  if (spec.body != null && methodUpper !== 'GET' && methodUpper !== 'HEAD') {
    const processed = substitute(spec.body, cfg);
    // Re-stringify JSON when possible (canonicalises whitespace), but preserve
    // the original bytes when the user is intentionally sending malformed JSON.
    try {
      body = JSON.stringify(JSON.parse(processed));
    } catch {
      body = processed;
    }
    if (!Object.keys(requestHeaders).some(k => k.toLowerCase() === 'content-type')) {
      requestHeaders['Content-Type'] = 'application/json';
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(validated.url.toString(), {
      method: methodUpper,
      headers: requestHeaders,
      body,
      signal: controller.signal as any,
      redirect: 'follow',
    });
    clearTimeout(timer);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const responseBody = await readBodyCapped(response);
    const duration = Date.now() - start;

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      duration,
      size: Buffer.byteLength(responseBody, 'utf8'),
    };
  } catch (err: any) {
    clearTimeout(timer);
    const aborted = err?.name === 'AbortError';
    return {
      status: 0,
      statusText: aborted ? 'Timeout' : 'Error',
      headers: {},
      body: '',
      duration: Date.now() - start,
      size: 0,
      error: aborted ? `Request timed out after ${timeoutMs}ms` : (err?.message || 'Unknown network error'),
    };
  }
}

export async function runTestCase(testCase: TestCase, config?: OllamaConfig): Promise<TestResult> {
  const resp = await runRequest(
    {
      method: testCase.method,
      url: testCase.url,
      headers: testCase.headers,
      body: testCase.body,
    },
    config,
  );

  const { assertions, passed, failureSummary } = evaluate(testCase, resp);

  return {
    testCase,
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
    body: resp.body,
    duration: resp.duration,
    size: resp.size,
    passed,
    error: resp.error,
    assertions,
    failureSummary,
  };
}
