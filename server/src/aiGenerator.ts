import fetch from 'node-fetch';
import {
  TestCase,
  TestCategory,
  RequestSpec,
  OllamaConfig,
  CategoryCounts,
  GenerateOptions,
} from './types';
import { getConfig } from './config';

function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function tryParseBody(body: string | null): any | null {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

const CATEGORY_LABELS: Record<TestCategory, string> = {
  positive: 'Positive',
  negative: 'Negative',
  'missing-field': 'Missing field',
  boundary: 'Boundary',
  empty: 'Empty value',
  duplicate: 'Duplicate value',
  security: 'Security edge',
  'large-payload': 'Large payload',
  'special-characters': 'Special characters',
  custom: 'Custom',
};

function buildPrompt(spec: RequestSpec, opts: GenerateOptions): string {
  const counts = opts.counts || {};
  const lines: string[] = [];
  lines.push(
    'You are an API QA engineer. Generate concrete API test cases for the given request.',
    '',
    'Base request:',
    `  Method: ${spec.method}`,
    `  URL: ${spec.url}`,
    `  Headers: ${JSON.stringify(spec.headers)}`,
    `  Body: ${spec.body ?? 'null'}`,
    '',
    'Generate the following counts per category:',
  );
  for (const [cat, n] of Object.entries(counts)) {
    if ((n as number) > 0) lines.push(`  - ${cat}: ${n}`);
  }
  if (opts.customPrompt && (opts.customCount || 0) > 0) {
    lines.push(`  - custom: ${opts.customCount}`);
    lines.push('');
    lines.push('Custom hint for the "custom" category:');
    lines.push(`  "${opts.customPrompt}"`);
  }
  lines.push(
    '',
    'Respond with ONLY a JSON array — no prose, no markdown fences. Each element must match this schema:',
    '{',
    '  "name": "short imperative label",',
    '  "category": "positive|negative|missing-field|boundary|empty|duplicate|security|large-payload|special-characters|custom",',
    '  "method": "POST",',
    '  "url": "...",',
    '  "headers": { ... },',
    '  "body": "<stringified JSON or null>",',
    '  "expectedStatus": 200,',
    '  "description": "1-2 sentence summary of what this case verifies",',
    '  "stepsToReproduce": ["Step 1...", "Step 2..."],',
    '  "expectedResult": "What the API should return"',
    '}',
    '',
    'Rules:',
    '- "body" must be a STRING (already JSON-encoded) or null.',
    '- Use the base URL unless the test is specifically about URL mutation.',
    '- expectedStatus: 2xx for positive, 4xx for client errors, 5xx only when truly expected.',
    '- Steps should each begin with an imperative verb.',
  );
  return lines.join('\n');
}

interface OllamaGenerated {
  name?: string;
  category?: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | object | null;
  expectedStatus?: number;
  description?: string;
  stepsToReproduce?: string[] | string;
  expectedResult?: string;
}

function extractJsonArray(text: string): any[] | null {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = candidate.substring(start, end + 1);
  try {
    const parsed = JSON.parse(slice);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeCategory(raw: string | undefined): TestCategory {
  if (!raw) return 'custom';
  const key = raw.toLowerCase().replace(/[_\s]/g, '-');
  const allowed: TestCategory[] = [
    'positive',
    'negative',
    'missing-field',
    'boundary',
    'empty',
    'duplicate',
    'security',
    'large-payload',
    'special-characters',
    'custom',
  ];
  return (allowed.includes(key as TestCategory) ? key : 'custom') as TestCategory;
}

function stringifyBody(body: string | object | null | undefined): string | null {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return null;
  }
}

function normalizeSteps(steps: string[] | string | undefined): string[] | undefined {
  if (!steps) return undefined;
  if (Array.isArray(steps)) return steps.filter(s => typeof s === 'string' && s.trim().length > 0);
  if (typeof steps === 'string') {
    return steps
      .split(/\n+/)
      .map(s => s.replace(/^\s*[\d\.\-\*]+\s*/, '').trim())
      .filter(Boolean);
  }
  return undefined;
}

function fromOllama(items: OllamaGenerated[], spec: RequestSpec): TestCase[] {
  return items
    .map(item => {
      const method = (item.method || spec.method || 'GET').toUpperCase();
      const url = item.url || spec.url;
      const headers =
        item.headers && typeof item.headers === 'object' ? (item.headers as Record<string, string>) : spec.headers;
      const body = stringifyBody(item.body ?? null);
      const category = normalizeCategory(item.category);
      const name = (item.name || CATEGORY_LABELS[category]).toString().slice(0, 120);
      return {
        id: randomId(),
        name,
        category,
        method,
        url,
        headers,
        body,
        expectedStatus: typeof item.expectedStatus === 'number' ? item.expectedStatus : undefined,
        description: typeof item.description === 'string' ? item.description : undefined,
        stepsToReproduce: normalizeSteps(item.stepsToReproduce),
        expectedResult: typeof item.expectedResult === 'string' ? item.expectedResult : undefined,
      } as TestCase;
    })
    .filter(tc => tc.url);
}

function summarizeBody(body: string | null): string {
  if (!body) return 'no body';
  if (body.length > 100) return `${body.slice(0, 97)}…`;
  return body;
}

function defaultSteps(spec: RequestSpec, mutation: string): string[] {
  return [
    `Set HTTP method to ${spec.method.toUpperCase()}`,
    `Set request URL to ${spec.url}`,
    ...(Object.keys(spec.headers).length ? [`Set headers: ${Object.keys(spec.headers).join(', ')}`] : []),
    mutation,
    'Send the request',
    'Inspect the response status and body',
  ];
}

function buildDeterministicCase(
  spec: RequestSpec,
  category: TestCategory,
  variant: number,
  baseObj: any,
  keys: string[],
): TestCase | null {
  const baseHeaders = spec.headers || {};
  const id = randomId();
  const positiveStatus = 200;
  const clientErr = 400;

  switch (category) {
    case 'positive': {
      if (variant === 0) {
        return {
          id,
          name: `Verify happy path with original payload`,
          category,
          method: spec.method,
          url: spec.url,
          headers: baseHeaders,
          body: spec.body,
          expectedStatus: positiveStatus,
          description: 'Sends the original request unchanged to confirm the happy path succeeds.',
          stepsToReproduce: defaultSteps(spec, `Use the body: ${summarizeBody(spec.body)}`),
          expectedResult: `API responds with HTTP ${positiveStatus} and a successful payload.`,
        };
      }
      const minimal = baseObj ? { ...baseObj } : {};
      return {
        id,
        name: `Verify request with valid alternate value (variant ${variant})`,
        category,
        method: spec.method,
        url: spec.url,
        headers: baseHeaders,
        body: baseObj ? JSON.stringify(minimal) : spec.body,
        expectedStatus: positiveStatus,
        description: 'Confirms the endpoint accepts a structurally equivalent payload.',
        stepsToReproduce: defaultSteps(spec, 'Send the same body again to confirm idempotent acceptance'),
        expectedResult: `API responds with HTTP ${positiveStatus}.`,
      };
    }
    case 'missing-field': {
      if (keys.length === 0) return null;
      const key = keys[variant % keys.length];
      const mutated = { ...baseObj };
      delete mutated[key];
      return {
        id,
        name: `Verify request fails when "${key}" is missing`,
        category,
        method: spec.method,
        url: spec.url,
        headers: baseHeaders,
        body: JSON.stringify(mutated),
        expectedStatus: clientErr,
        description: `Removes the "${key}" field from the request body to confirm server rejects incomplete payloads.`,
        stepsToReproduce: defaultSteps(spec, `Remove the "${key}" field from the request body`),
        expectedResult: `API responds with HTTP ${clientErr} indicating "${key}" is required.`,
      };
    }
    case 'empty': {
      if (keys.length === 0) return null;
      const key = keys[variant % keys.length];
      return {
        id,
        name: `Verify request fails when "${key}" is empty`,
        category,
        method: spec.method,
        url: spec.url,
        headers: baseHeaders,
        body: JSON.stringify({ ...baseObj, [key]: '' }),
        expectedStatus: clientErr,
        description: `Sets "${key}" to an empty string to verify the API rejects empty values.`,
        stepsToReproduce: defaultSteps(spec, `Set "${key}" to an empty string ""`),
        expectedResult: `API responds with HTTP ${clientErr} indicating "${key}" cannot be empty.`,
      };
    }
    case 'boundary': {
      if (keys.length === 0) return null;
      const key = keys[variant % keys.length];
      const long = 'A'.repeat(5000 * (variant + 1));
      return {
        id,
        name: `Verify request fails when "${key}" exceeds length limit`,
        category,
        method: spec.method,
        url: spec.url,
        headers: baseHeaders,
        body: JSON.stringify({ ...baseObj, [key]: long }),
        expectedStatus: clientErr,
        description: `Sets "${key}" to a very long string (${long.length} chars) to verify length validation.`,
        stepsToReproduce: defaultSteps(spec, `Set "${key}" to a ${long.length}-character string`),
        expectedResult: `API responds with HTTP ${clientErr} indicating value too long.`,
      };
    }
    case 'special-characters': {
      if (keys.length === 0) return null;
      const key = keys[variant % keys.length];
      const samples = ['éà漢字💥', '<script>alert(1)</script>', '<>&"\'\\/'];
      const sample = samples[variant % samples.length];
      return {
        id,
        name: `Verify request handles special characters in "${key}"`,
        category,
        method: spec.method,
        url: spec.url,
        headers: baseHeaders,
        body: JSON.stringify({ ...baseObj, [key]: sample }),
        expectedStatus: 200,
        description: `Submits special / unicode characters in "${key}" to verify safe handling and encoding.`,
        stepsToReproduce: defaultSteps(spec, `Set "${key}" to "${sample}"`),
        expectedResult: 'API accepts the request and round-trips the value safely without breaking.',
      };
    }
    case 'security': {
      if (keys.length === 0) return null;
      const key = keys[variant % keys.length];
      const payloads = ["' OR 1=1 --", '"; DROP TABLE users; --', '<svg onload=alert(1)>'];
      const sample = payloads[variant % payloads.length];
      return {
        id,
        name: `Verify "${key}" is safe against injection`,
        category,
        method: spec.method,
        url: spec.url,
        headers: baseHeaders,
        body: JSON.stringify({ ...baseObj, [key]: sample }),
        expectedStatus: 400,
        description: `Injects a known attack pattern (${sample}) in "${key}" to ensure the API does not execute it.`,
        stepsToReproduce: defaultSteps(spec, `Set "${key}" to a malicious payload: ${sample}`),
        expectedResult: 'API sanitises or rejects the payload; no data leak or 5xx.',
      };
    }
    case 'large-payload': {
      const huge: Record<string, any> = baseObj ? { ...baseObj } : {};
      const fieldsToAdd = 50 * (variant + 1);
      for (let i = 0; i < fieldsToAdd; i++) huge[`extra_${i}`] = 'x'.repeat(200);
      return {
        id,
        name: `Verify request rejects oversized payload (${fieldsToAdd} extra fields)`,
        category,
        method: spec.method,
        url: spec.url,
        headers: baseHeaders,
        body: JSON.stringify(huge),
        expectedStatus: 413,
        description: `Adds ${fieldsToAdd} extra fields to push the payload past expected limits.`,
        stepsToReproduce: defaultSteps(spec, `Add ${fieldsToAdd} large dummy fields to the body`),
        expectedResult: 'API responds with HTTP 413 Payload Too Large or similar 4xx.',
      };
    }
    case 'duplicate': {
      return {
        id,
        name: `Verify duplicate submission is handled (variant ${variant + 1})`,
        category,
        method: spec.method,
        url: spec.url,
        headers: baseHeaders,
        body: spec.body,
        expectedStatus: 409,
        description: 'Submits the exact same payload twice in a row to verify duplicate detection.',
        stepsToReproduce: [
          ...defaultSteps(spec, 'Send the original request'),
          'Send the identical request a second time',
        ],
        expectedResult: 'Second submission returns HTTP 409 Conflict or business-rule error.',
      };
    }
    case 'negative': {
      const variations = [
        {
          name: 'Verify request rejects malformed JSON body',
          body: '{not json',
          desc: 'Sends a body that is not valid JSON.',
          step: 'Set body to invalid JSON: "{not json"',
          expected: 'API responds with HTTP 400 Bad Request.',
          status: 400,
        },
        {
          name: 'Verify request rejects wrong content type',
          body: spec.body,
          headers: { ...baseHeaders, 'Content-Type': 'text/plain' },
          desc: 'Submits a JSON body with text/plain content type.',
          step: 'Set Content-Type header to text/plain',
          expected: 'API responds with HTTP 415 Unsupported Media Type.',
          status: 415,
        },
        {
          name: 'Verify endpoint rejects unsupported method',
          method: spec.method === 'GET' ? 'TRACE' : 'PUT',
          body: spec.body,
          desc: 'Calls the endpoint with an unsupported HTTP method.',
          step: `Change HTTP method to ${spec.method === 'GET' ? 'TRACE' : 'PUT'}`,
          expected: 'API responds with HTTP 405 Method Not Allowed.',
          status: 405,
        },
      ];
      const v = variations[variant % variations.length];
      return {
        id,
        name: v.name,
        category,
        method: (v as any).method || spec.method,
        url: spec.url,
        headers: (v as any).headers || baseHeaders,
        body: v.body ?? null,
        expectedStatus: v.status,
        description: v.desc,
        stepsToReproduce: defaultSteps(spec, v.step),
        expectedResult: v.expected,
      };
    }
    case 'custom':
    default:
      return null;
  }
}

function deterministicCases(spec: RequestSpec, opts: GenerateOptions): TestCase[] {
  const baseObj = tryParseBody(spec.body);
  const keys = baseObj && typeof baseObj === 'object' ? Object.keys(baseObj) : [];
  const counts = opts.counts || {};
  const out: TestCase[] = [];

  const categories: TestCategory[] = [
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

  for (const cat of categories) {
    const n = counts[cat] || 0;
    for (let i = 0; i < n; i++) {
      const c = buildDeterministicCase(spec, cat, i, baseObj, keys);
      if (c) out.push(c);
    }
  }

  if (opts.customPrompt && (opts.customCount || 0) > 0) {
    for (let i = 0; i < (opts.customCount as number); i++) {
      out.push({
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
      });
    }
  }

  return out;
}

export async function generateCases(
  spec: RequestSpec,
  opts: GenerateOptions = {},
  config?: OllamaConfig,
): Promise<{ cases: TestCase[]; source: 'ollama' | 'fallback' | 'mixed'; note?: string }> {
  const cfg = config || getConfig();
  const counts = opts.counts || {};
  const hasAnyCount =
    Object.values(counts).some(n => (n as number) > 0) || ((opts.customCount || 0) > 0 && !!opts.customPrompt);

  if (!hasAnyCount) {
    return { cases: [], source: 'fallback', note: 'No categories selected' };
  }

  const fallback = deterministicCases(spec, opts);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    const resp = await fetch(`${cfg.url.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        prompt: buildPrompt(spec, opts),
        stream: false,
        options: { temperature: 0.4 },
      }),
      signal: controller.signal as any,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { cases: fallback, source: 'fallback', note: `Ollama HTTP ${resp.status}` };
    }
    const data: any = await resp.json();
    const arr = extractJsonArray(data?.response || '');
    if (!arr || arr.length === 0) {
      return { cases: fallback, source: 'fallback', note: 'Model returned no parseable cases' };
    }
    const cases = fromOllama(arr as OllamaGenerated[], spec);
    if (cases.length === 0) {
      return { cases: fallback, source: 'fallback', note: 'No valid cases extracted' };
    }

    // Top up with deterministic cases per category if Ollama under-delivered.
    const haveByCat: Partial<Record<TestCategory, number>> = {};
    for (const c of cases) haveByCat[c.category] = (haveByCat[c.category] || 0) + 1;
    const supplements: TestCase[] = [];
    const baseObj = tryParseBody(spec.body);
    const keys = baseObj && typeof baseObj === 'object' ? Object.keys(baseObj) : [];
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
        const c = buildDeterministicCase(spec, cat, i, baseObj, keys);
        if (c) supplements.push(c);
      }
    }
    // Custom top-up
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
        });
      }
    }

    if (supplements.length === 0) {
      return { cases, source: 'ollama' };
    }
    return {
      cases: [...cases, ...supplements],
      source: 'mixed',
      note: `Ollama returned ${cases.length}; topped up with ${supplements.length} deterministic case(s)`,
    };
  } catch (err: any) {
    return {
      cases: fallback,
      source: 'fallback',
      note: err?.name === 'AbortError' ? 'Ollama request timed out' : err?.message || 'Ollama unreachable',
    };
  }
}
