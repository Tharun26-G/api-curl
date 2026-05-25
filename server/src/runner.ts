import fetch from 'node-fetch';
import { TestCase, TestResult, RequestSpec, ResponseData, OllamaConfig } from './types';
import { getConfig } from './config';

function substitute(value: string, cfg: OllamaConfig): string {
  return value.replace(/\{\{OLLAMA_URL\}\}/g, cfg.url).replace(/\{\{MODEL\}\}/g, cfg.model);
}

export async function runRequest(spec: RequestSpec, config?: OllamaConfig): Promise<ResponseData> {
  const cfg = config || getConfig();
  const start = Date.now();

  try {
    const finalUrl = substitute(spec.url, cfg);
    const requestHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(spec.headers || {})) {
      requestHeaders[k] = substitute(v, cfg);
    }

    let body: string | undefined;
    if (spec.body && spec.method !== 'GET' && spec.method !== 'HEAD') {
      const processed = substitute(spec.body, cfg);
      try {
        body = JSON.stringify(JSON.parse(processed));
      } catch {
        body = processed;
      }
      if (!Object.keys(requestHeaders).some(k => k.toLowerCase() === 'content-type')) {
        requestHeaders['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(finalUrl, {
      method: spec.method,
      headers: requestHeaders,
      body,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const responseBody = await response.text();
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
    return {
      status: 0,
      statusText: 'Error',
      headers: {},
      body: '',
      duration: Date.now() - start,
      size: 0,
      error: err.message || 'Unknown error',
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

  const expected = testCase.expectedStatus;
  const passed =
    !resp.error &&
    (expected !== undefined
      ? resp.status === expected
      : testCase.category === 'positive'
        ? resp.status >= 200 && resp.status < 300
        : resp.status >= 400 && resp.status < 600);

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
  };
}
