import fetch from 'node-fetch';
import {
  TestCase,
  TestCategory,
  RequestSpec,
  OllamaConfig,
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

// ---------- Request semantic analysis ----------

type FieldKind = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null' | 'date' | 'email' | 'url' | 'uuid' | 'enum';

interface FieldDescriptor {
  path: string;
  kind: FieldKind;
  sample: any;
  required: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+\-]\d{2}:?\d{2})?)?$/;

function classifyValue(v: any): FieldKind {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  if (typeof v === 'string') {
    if (EMAIL_RE.test(v)) return 'email';
    if (URL_RE.test(v)) return 'url';
    if (UUID_RE.test(v)) return 'uuid';
    if (ISO_DATE_RE.test(v)) return 'date';
    return 'string';
  }
  return 'string';
}

function analyzeFields(obj: any, basePath = '', acc: FieldDescriptor[] = []): FieldDescriptor[] {
  if (obj == null || typeof obj !== 'object') return acc;
  if (Array.isArray(obj)) {
    if (obj.length > 0) analyzeFields(obj[0], `${basePath}[0]`, acc);
    return acc;
  }
  for (const [k, v] of Object.entries(obj)) {
    const path = basePath ? `${basePath}.${k}` : k;
    acc.push({ path, kind: classifyValue(v), sample: v, required: true });
    if (v && typeof v === 'object') analyzeFields(v, path, acc);
  }
  return acc;
}

export interface RequestProfile {
  method: string;
  url: string;
  hasBody: boolean;
  bodyKind: FieldKind | 'invalid' | 'absent';
  resource: string;
  hasIdInPath: boolean;
  authScheme: 'bearer' | 'basic' | 'apikey' | 'none';
  contentType: string | null;
  fields: FieldDescriptor[];
  topLevelKeys: string[];
  semantics: string[];
}

export function profileRequest(spec: RequestSpec): RequestProfile {
  const method = (spec.method || 'GET').toUpperCase();
  const url = spec.url || '';
  let resource = '';
  let hasIdInPath = false;
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    resource = segments[segments.length - 2] || segments[segments.length - 1] || u.hostname;
    hasIdInPath = segments.some(s => UUID_RE.test(s) || /^\d+$/.test(s));
  } catch {
    resource = url;
  }

  const headersLower: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec.headers || {})) headersLower[k.toLowerCase()] = v;

  let authScheme: RequestProfile['authScheme'] = 'none';
  const auth = headersLower['authorization'] || '';
  if (/^bearer\s/i.test(auth)) authScheme = 'bearer';
  else if (/^basic\s/i.test(auth)) authScheme = 'basic';
  else if (headersLower['x-api-key'] || headersLower['api-key']) authScheme = 'apikey';

  const contentType = headersLower['content-type'] || null;

  const parsed = tryParseBody(spec.body);
  let bodyKind: RequestProfile['bodyKind'] = 'absent';
  let fields: FieldDescriptor[] = [];
  let topLevelKeys: string[] = [];
  if (spec.body != null && spec.body.trim() !== '') {
    if (parsed === null && spec.body.trim() !== 'null') {
      bodyKind = 'invalid';
    } else {
      bodyKind = classifyValue(parsed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        topLevelKeys = Object.keys(parsed);
      }
      fields = analyzeFields(parsed);
    }
  }

  const semantics: string[] = [];
  if (method === 'POST' && !hasIdInPath) semantics.push('CREATE (POST collection)');
  if (method === 'POST' && hasIdInPath) semantics.push('ACTION on resource');
  if (method === 'GET' && hasIdInPath) semantics.push('READ single resource');
  if (method === 'GET' && !hasIdInPath) semantics.push('LIST collection');
  if (method === 'PUT') semantics.push('REPLACE resource (idempotent)');
  if (method === 'PATCH') semantics.push('UPDATE resource (partial)');
  if (method === 'DELETE') semantics.push('DELETE resource (idempotent)');
  if (method === 'HEAD') semantics.push('Metadata-only fetch');
  if (method === 'OPTIONS') semantics.push('CORS / capability discovery');

  return {
    method,
    url,
    hasBody: bodyKind !== 'absent' && bodyKind !== 'invalid',
    bodyKind,
    resource,
    hasIdInPath,
    authScheme,
    contentType,
    fields,
    topLevelKeys,
    semantics,
  };
}

// ---------- Prompt construction ----------

function categoryPlaybook(): string {
  return [
    'CATEGORY PLAYBOOK (apply rigorously):',
    '• positive — Happy path. expectedStatus 200/201/204 per verb. Assert response shape (jsonPathExists for canonical fields, expectJson true, expectStatusClass 2xx, contentTypeStartsWith application/json, maxResponseTimeMs <= 3000).',
    '• negative — Wrong method (405), malformed JSON body (400), unsupported media type (415), missing/invalid auth (401/403), missing required header. Assert expectStatusClass 4xx and disallow 5xx. Use bodyNotContains for stack-trace markers.',
    '• missing-field — Remove ONE required field at a time. expectedStatus 400 or 422. Assert validation error mentions the field (bodyContains "<field>"). Disallow 5xx.',
    '• empty — Send "", null, 0, [], {} for each typed field. Strings → "". Numbers → 0 / negative. Arrays → []. Booleans → null. Assert 400/422 or business-defined behaviour, never 5xx.',
    '• boundary — String length: 1, 254, 255, 256, 1024, 10_000 chars. Integers: -1, 0, INT32_MAX (2147483647), INT64_MAX. Floats: NaN, Infinity, -0, 1e308. Arrays: 0, 1, 1000, 10_000 items. Probe one boundary per case. Expect 200 or 4xx, never 5xx.',
    '• duplicate — Idempotency: POST same payload twice → expect 409 Conflict or business-rule rejection. For PUT/DELETE → second call must produce same 2xx/4xx outcome (idempotency). Two cases minimum.',
    '• security — One vector per case: SQL injection (\' OR 1=1 --, ; DROP TABLE), NoSQL injection ({$ne: null}), XSS (<script>alert(1)</script>, <svg onload=...>), SSRF (http://169.254.169.254/, file:///etc/passwd), command injection (; cat /etc/passwd, $(whoami)), path traversal (../../../etc/passwd), header injection (CRLF), prototype pollution ({"__proto__":{"isAdmin":true}}), JWT none-alg, IDOR (change id to another tenant). Assert 4xx, disallow 5xx, bodyNotContains "Traceback", "SQL syntax", "ORA-", "at " stack frames, and any echo of the raw payload that suggests reflected execution.',
    '• large-payload — Body with 1MB / 5MB / 10MB of data, or 10_000-deep nesting, or huge array of objects. Expect 413 Payload Too Large or 400. maxResponseTimeMs 10000. Disallow 5xx and connection drops.',
    '• special-characters — Unicode (你好, مرحبا, 🚀, RTL overrides U+202E), emoji, null byte \\u0000, zero-width space, combining diacritics (café vs café), JSON escape edge cases (\\", \\\\), control chars. Assert 2xx with round-trip preservation OR clean 4xx.',
    '• custom — Follow the user hint precisely while keeping the same rigour.',
  ].join('\n');
}

export function buildPrompt(spec: RequestSpec, opts: GenerateOptions): string {
  const profile = profileRequest(spec);
  const counts = opts.counts || {};
  const lines: string[] = [];

  lines.push(
    'ROLE: You are a Principal SDET at a Tier-1 tech company with 15+ years experience designing API test suites (Postman, Karate, REST Assured, k6). You think like an adversary, a customer, and a compliance auditor at once.',
    '',
    'OBJECTIVE: Produce concrete, executable API test cases for the request below. Each case must be runnable as-is (real method, URL, headers, body), with explicit assertions a test runner can verify.',
    '',
    '======== REQUEST UNDER TEST ========',
    `Method:        ${profile.method}`,
    `URL:           ${profile.url}`,
    `Resource:      ${profile.resource}`,
    `Semantics:     ${profile.semantics.join(', ') || 'n/a'}`,
    `Has path id:   ${profile.hasIdInPath ? 'yes' : 'no'}`,
    `Auth:          ${profile.authScheme}`,
    `Content-Type:  ${profile.contentType || '(not set)'}`,
    `Headers:       ${JSON.stringify(spec.headers)}`,
    `Body kind:     ${profile.bodyKind}`,
    `Body (raw):    ${spec.body ?? 'null'}`,
  );

  if (profile.fields.length > 0) {
    lines.push('', 'FIELD MAP (path · kind · sample):');
    for (const f of profile.fields.slice(0, 40)) {
      const sample = typeof f.sample === 'string' && f.sample.length > 40
        ? `${f.sample.slice(0, 40)}…`
        : JSON.stringify(f.sample);
      lines.push(`  - ${f.path} · ${f.kind} · ${sample}`);
    }
  }

  lines.push('', '======== HOW MANY PER CATEGORY ========');
  for (const [cat, n] of Object.entries(counts)) {
    if ((n as number) > 0) lines.push(`  - ${cat}: ${n}`);
  }
  if (opts.customPrompt && (opts.customCount || 0) > 0) {
    lines.push(`  - custom: ${opts.customCount}`);
    lines.push('');
    lines.push(`CUSTOM HINT (for "custom" category): "${opts.customPrompt}"`);
  }

  lines.push('', '======== PLAYBOOK ========', categoryPlaybook());

  lines.push(
    '',
    '======== OUTPUT CONTRACT ========',
    'Respond with ONLY a JSON array — no prose, no markdown fences, no preamble. Each element MUST match this schema:',
    '{',
    '  "name": "imperative, specific, <=120 chars (e.g. \'Reject POST when email field is missing\')",',
    '  "category": "positive|negative|missing-field|boundary|empty|duplicate|security|large-payload|special-characters|custom",',
    '  "method": "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS",',
    '  "url": "fully-qualified URL (use base URL unless the test mutates the path/query)",',
    '  "headers": { "Header-Name": "value" },',
    '  "body": "<STRING — already JSON-encoded — or null for GET/HEAD/DELETE>",',
    '  "expectedStatus": 200,',
    '  "description": "1-2 sentences: WHAT this case probes and WHY it matters.",',
    '  "stepsToReproduce": ["Step 1 (imperative verb)…", "Step 2…", "Step 3…"],',
    '  "expectedResult": "Precise observable outcome: status, key response fields, side effects.",',
    '  "assertions": {',
    '    "expectStatus": 200,',
    '    "expectStatusClass": ["2xx"],',
    '    "disallowStatus": [500, 502, 503, 504],',
    '    "maxResponseTimeMs": 3000,',
    '    "bodyContains": ["id"],',
    '    "bodyNotContains": ["Traceback", "SQL syntax"],',
    '    "contentTypeStartsWith": "application/json",',
    '    "expectJson": true,',
    '    "jsonPathExists": ["id", "createdAt"],',
    '    "jsonPathEquals": [{ "path": "role", "value": "designer" }],',
    '    "expectHeaders": [{ "name": "Content-Type" }, { "name": "X-Request-Id" }]',
    '  }',
    '}',
    '',
    '======== HARD RULES ========',
    '- body MUST be a JSON-encoded STRING or null. NEVER an object literal.',
    '- Use the original URL unless the test specifically mutates path/query.',
    '- Pick expectedStatus deterministically based on category: positive→200/201/204, missing-field→400/422, negative→400/401/403/405/415, boundary→200 or 400, duplicate→409 (or 200 for idempotent PUT/DELETE), security→400/401/403, large-payload→413, special-characters→200.',
    '- ALWAYS include "assertions". Always set "disallowStatus":[500,502,503,504] except when 5xx is itself the contract under test. Always include "maxResponseTimeMs".',
    '- For security cases: ALWAYS add "bodyNotContains":["Traceback","SQL syntax","ORA-","stack trace","exception in"] (case-sensitive ok).',
    '- For positive JSON responses: set "expectJson":true and add at least one "jsonPathExists" for an identifying field.',
    '- Each "stepsToReproduce" step starts with an imperative verb (Set, Send, Assert, Wait, Modify, Remove, etc.).',
    '- NO duplicate cases. Each case must vary by ≥1 dimension (field touched, payload, header, method).',
    '- Be SPECIFIC: name the exact field, value, and expected error in description/expectedResult.',
  );

  return lines.join('\n');
}

export interface OllamaGenerated {
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
  assertions?: any;
}

export function extractJsonArray(text: string): any[] | null {
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

function normalizeAssertions(raw: any): TestCase['assertions'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: NonNullable<TestCase['assertions']> = {};
  if (typeof raw.expectStatus === 'number') out.expectStatus = raw.expectStatus;
  if (Array.isArray(raw.expectStatusClass)) {
    const valid = raw.expectStatusClass.filter((v: any) => ['2xx', '3xx', '4xx', '5xx'].includes(v));
    if (valid.length) out.expectStatusClass = valid;
  }
  if (Array.isArray(raw.disallowStatus)) {
    out.disallowStatus = raw.disallowStatus.filter((n: any) => typeof n === 'number');
  }
  if (typeof raw.maxResponseTimeMs === 'number' && raw.maxResponseTimeMs > 0) {
    out.maxResponseTimeMs = raw.maxResponseTimeMs;
  }
  if (Array.isArray(raw.bodyContains)) {
    out.bodyContains = raw.bodyContains.filter((s: any) => typeof s === 'string');
  }
  if (Array.isArray(raw.bodyNotContains)) {
    out.bodyNotContains = raw.bodyNotContains.filter((s: any) => typeof s === 'string');
  }
  if (typeof raw.contentTypeStartsWith === 'string') out.contentTypeStartsWith = raw.contentTypeStartsWith;
  if (Array.isArray(raw.jsonPathExists)) {
    out.jsonPathExists = raw.jsonPathExists.filter((s: any) => typeof s === 'string');
  }
  if (Array.isArray(raw.jsonPathEquals)) {
    out.jsonPathEquals = raw.jsonPathEquals
      .filter((e: any) => e && typeof e.path === 'string')
      .map((e: any) => ({ path: e.path, value: e.value }));
  }
  if (Array.isArray(raw.expectHeaders)) {
    out.expectHeaders = raw.expectHeaders
      .filter((h: any) => h && typeof h.name === 'string')
      .map((h: any) => ({ name: h.name, value: typeof h.value === 'string' ? h.value : undefined }));
  }
  if (typeof raw.expectJson === 'boolean') out.expectJson = raw.expectJson;
  return Object.keys(out).length > 0 ? out : undefined;
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

export function fromOllama(items: OllamaGenerated[], spec: RequestSpec): TestCase[] {
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
        assertions: normalizeAssertions(item.assertions),
      } as TestCase;
    })
    .filter(tc => tc.url);
}

// ---------- Deterministic fallback (type-aware, method-aware) ----------

function summarizeBody(body: string | null): string {
  if (!body) return 'no body';
  if (body.length > 100) return `${body.slice(0, 97)}…`;
  return body;
}

export function defaultSteps(spec: RequestSpec, mutation: string): string[] {
  return [
    `Set HTTP method to ${spec.method.toUpperCase()}`,
    `Set request URL to ${spec.url}`,
    ...(Object.keys(spec.headers).length ? [`Set headers: ${Object.keys(spec.headers).join(', ')}`] : []),
    mutation,
    'Send the request',
    'Inspect the response status, headers, and body',
  ];
}

function appendQuery(url: string, k: string, v: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(k, v);
    return u.toString();
  } catch {
    return url.includes('?') ? `${url}&${encodeURIComponent(k)}=${encodeURIComponent(v)}` : `${url}?${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  }
}

function statusFromMethod(method: string): number {
  switch (method.toUpperCase()) {
    case 'POST': return 201;
    case 'DELETE': return 204;
    case 'HEAD':
    case 'OPTIONS':
      return 200;
    default: return 200;
  }
}

function emptyValueForKind(kind: FieldKind): any {
  switch (kind) {
    case 'string':
    case 'email':
    case 'url':
    case 'uuid':
    case 'date':
    case 'enum':
      return '';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return null;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

function boundaryMutationsFor(kind: FieldKind, sample: any): { label: string; value: any }[] {
  switch (kind) {
    case 'string':
    case 'enum':
      return [
        { label: 'length 256 (just over varchar(255))', value: 'A'.repeat(256) },
        { label: 'length 10_000 (huge string)', value: 'A'.repeat(10_000) },
        { label: 'length 1 (minimum)', value: 'A' },
      ];
    case 'email':
      return [
        { label: 'missing @ symbol', value: 'plaintext' },
        { label: 'TLD only', value: 'a@b' },
        { label: '256-char local-part', value: `${'a'.repeat(256)}@example.com` },
      ];
    case 'url':
      return [
        { label: 'protocol missing', value: 'example.com/path' },
        { label: 'javascript: scheme', value: 'javascript:alert(1)' },
      ];
    case 'uuid':
      return [
        { label: 'malformed UUID', value: 'not-a-uuid' },
        { label: 'wrong-length hex', value: '12345678-1234-1234-1234-12345678' },
      ];
    case 'date':
      return [
        { label: 'invalid date 2025-02-30', value: '2025-02-30' },
        { label: 'non-ISO format', value: '13/45/2025' },
      ];
    case 'integer':
      return [
        { label: 'INT32_MAX', value: 2_147_483_647 },
        { label: 'INT32_MAX + 1', value: 2_147_483_648 },
        { label: 'negative', value: -1 },
        { label: 'zero', value: 0 },
      ];
    case 'number':
      return [
        { label: 'Infinity-like 1e308', value: 1e308 },
        { label: 'tiny negative', value: -0.00001 },
        { label: 'NaN-as-string', value: 'NaN' },
      ];
    case 'array': {
      const proto = Array.isArray(sample) && sample.length > 0 ? sample[0] : 'x';
      return [
        { label: 'empty array', value: [] },
        { label: '1000-item array', value: Array(1000).fill(proto) },
      ];
    }
    case 'object':
      return [
        { label: 'empty object', value: {} },
        { label: 'deeply nested object (50 levels)', value: nestObj(50) },
      ];
    case 'boolean':
      return [
        { label: 'string "true"', value: 'true' },
        { label: 'numeric 1', value: 1 },
      ];
    default:
      return [{ label: 'null', value: null }];
  }
}

function nestObj(depth: number): any {
  let cur: any = { leaf: true };
  for (let i = 0; i < depth; i++) cur = { nested: cur };
  return cur;
}

function specialCharSamples(): { label: string; value: string }[] {
  return [
    { label: 'CJK + emoji + RTL', value: '你好 مرحبا 🚀‮' },
    { label: 'null byte', value: 'pre post' },
    { label: 'zero-width space', value: 'fo​o' },
    { label: 'JSON-escape edge', value: 'quote " backslash \\ newline\n' },
    { label: 'combining diacritics', value: 'café' },
  ];
}

function securityPayloads(kind: FieldKind): { label: string; value: any }[] {
  const stringVectors = [
    { label: 'SQL injection — boolean tautology', value: "' OR 1=1 --" },
    { label: 'SQL injection — drop table', value: '"; DROP TABLE users; --' },
    { label: 'XSS — script tag', value: '<script>alert(1)</script>' },
    { label: 'XSS — svg onload', value: '<svg onload=alert(1)>' },
    { label: 'SSRF — AWS metadata', value: 'http://169.254.169.254/latest/meta-data/' },
    { label: 'SSRF — file:// scheme', value: 'file:///etc/passwd' },
    { label: 'Path traversal', value: '../../../../etc/passwd' },
    { label: 'Command injection', value: '; cat /etc/passwd' },
    { label: 'Header injection (CRLF)', value: 'value\r\nX-Injected: yes' },
  ];
  if (kind === 'object') {
    return [
      { label: 'Prototype pollution', value: { __proto__: { isAdmin: true } } },
      { label: 'NoSQL injection ($ne)', value: { $ne: null } },
    ];
  }
  if (kind === 'array') {
    return [{ label: 'mixed types in array', value: ['x', 1, null, { __proto__: { polluted: true } }] }];
  }
  return stringVectors;
}

export function buildDeterministicCase(
  spec: RequestSpec,
  category: TestCategory,
  variant: number,
  profile: RequestProfile,
): TestCase | null {
  const baseHeaders = spec.headers || {};
  const baseObj = tryParseBody(spec.body);
  const fields = profile.fields;
  const id = randomId();
  const method = spec.method.toUpperCase();
  const positiveStatus = statusFromMethod(method);
  const clientErr = 400;

  const positiveAssertions: NonNullable<TestCase['assertions']> = {
    expectStatusClass: ['2xx'],
    maxResponseTimeMs: 3_000,
    disallowStatus: [500, 502, 503, 504],
    ...(profile.hasBody && (profile.bodyKind === 'object' || profile.bodyKind === 'array')
      ? { expectJson: true, contentTypeStartsWith: 'application/json' }
      : {}),
    ...(method === 'GET' || method === 'POST'
      ? { jsonPathExists: profile.topLevelKeys.length > 0 ? profile.topLevelKeys.slice(0, 2) : undefined }
      : {}),
  };
  const clientErrAssertions: NonNullable<TestCase['assertions']> = {
    expectStatusClass: ['4xx'],
    maxResponseTimeMs: 5_000,
    disallowStatus: [500, 502, 503, 504],
    bodyNotContains: ['Traceback', 'SQL syntax', 'ORA-', 'stack trace'],
  };
  const securityAssertions: NonNullable<TestCase['assertions']> = {
    expectStatusClass: ['4xx'],
    disallowStatus: [500, 502, 503, 504],
    bodyNotContains: ['Traceback', 'SQL syntax', 'ORA-', 'stack trace', 'at line', '/etc/passwd', 'root:'],
    maxResponseTimeMs: 5_000,
  };

  switch (category) {
    case 'positive': {
      if (variant === 0) {
        return {
          id,
          name: `Verify ${method} ${profile.resource} happy path with valid payload`,
          category,
          method,
          url: spec.url,
          headers: baseHeaders,
          body: spec.body,
          expectedStatus: positiveStatus,
          assertions: positiveAssertions,
          description: `Sends the canonical ${method} request unchanged to confirm the happy path returns a ${positiveStatus} with the expected body shape.`,
          stepsToReproduce: defaultSteps(spec, `Use the original body: ${summarizeBody(spec.body)}`),
          expectedResult: `API responds with HTTP ${positiveStatus} within 3s and includes the canonical resource fields.`,
        };
      }
      if (variant === 1 && (method === 'GET' || method === 'HEAD')) {
        return {
          id,
          name: `Verify ${method} ${profile.resource} accepts JSON Accept header`,
          category,
          method,
          url: spec.url,
          headers: { ...baseHeaders, Accept: 'application/json' },
          body: null,
          expectedStatus: positiveStatus,
          assertions: { ...positiveAssertions, contentTypeStartsWith: 'application/json' },
          description: 'Explicitly negotiates JSON via the Accept header; server should honour it.',
          stepsToReproduce: defaultSteps(spec, 'Add header: Accept: application/json'),
          expectedResult: 'API responds with application/json content type and 2xx status.',
        };
      }
      return {
        id,
        name: `Verify request with structurally equivalent payload (variant ${variant})`,
        category,
        method,
        url: spec.url,
        headers: baseHeaders,
        body: baseObj ? JSON.stringify(baseObj) : spec.body,
        expectedStatus: positiveStatus,
        assertions: positiveAssertions,
        description: 'Re-encodes the body to confirm whitespace/key-order insensitivity.',
        stepsToReproduce: defaultSteps(spec, 'Re-encode the body with no whitespace'),
        expectedResult: `API responds with HTTP ${positiveStatus}.`,
      };
    }

    case 'missing-field': {
      if (!baseObj || fields.length === 0) return null;
      const topFields = fields.filter(f => !f.path.includes('.') && !f.path.includes('['));
      if (topFields.length === 0) return null;
      const f = topFields[variant % topFields.length];
      const mutated = { ...baseObj };
      delete mutated[f.path];
      return {
        id,
        name: `Reject ${method} when required field "${f.path}" is missing`,
        category,
        method,
        url: spec.url,
        headers: baseHeaders,
        body: JSON.stringify(mutated),
        expectedStatus: 400,
        assertions: { ...clientErrAssertions, bodyContains: [f.path] },
        description: `Removes the "${f.path}" (${f.kind}) field to confirm the server enforces presence and returns a descriptive 400/422.`,
        stepsToReproduce: defaultSteps(spec, `Remove the "${f.path}" field from the body`),
        expectedResult: `API responds with HTTP 400 or 422 and the error message mentions "${f.path}".`,
      };
    }

    case 'empty': {
      if (!baseObj || fields.length === 0) return null;
      const topFields = fields.filter(f => !f.path.includes('.') && !f.path.includes('['));
      if (topFields.length === 0) return null;
      const f = topFields[variant % topFields.length];
      const mutated = { ...baseObj, [f.path]: emptyValueForKind(f.kind) };
      return {
        id,
        name: `Reject ${method} when "${f.path}" is empty for its type (${f.kind})`,
        category,
        method,
        url: spec.url,
        headers: baseHeaders,
        body: JSON.stringify(mutated),
        expectedStatus: 400,
        assertions: { ...clientErrAssertions, bodyContains: [f.path] },
        description: `Sets "${f.path}" to a type-appropriate empty value (${JSON.stringify(emptyValueForKind(f.kind))}) to verify the API rejects empty inputs.`,
        stepsToReproduce: defaultSteps(spec, `Set "${f.path}" to ${JSON.stringify(emptyValueForKind(f.kind))}`),
        expectedResult: `API responds with HTTP 400 or 422 citing "${f.path}".`,
      };
    }

    case 'boundary': {
      if (!baseObj || fields.length === 0) return null;
      const topFields = fields.filter(f => !f.path.includes('.') && !f.path.includes('['));
      if (topFields.length === 0) return null;
      const f = topFields[variant % topFields.length];
      const mutations = boundaryMutationsFor(f.kind, f.sample);
      const m = mutations[Math.floor(variant / Math.max(1, topFields.length)) % mutations.length];
      return {
        id,
        name: `Probe "${f.path}" boundary: ${m.label}`,
        category,
        method,
        url: spec.url,
        headers: baseHeaders,
        body: JSON.stringify({ ...baseObj, [f.path]: m.value }),
        expectedStatus: 400,
        assertions: {
          expectStatusClass: ['2xx', '4xx'],
          disallowStatus: [500, 502, 503, 504],
          maxResponseTimeMs: 5_000,
          bodyNotContains: ['Traceback', 'SQL syntax', 'ORA-'],
        },
        description: `Pushes "${f.path}" (${f.kind}) to its boundary (${m.label}) to verify validation and avoid 5xx.`,
        stepsToReproduce: defaultSteps(spec, `Set "${f.path}" to ${m.label}`),
        expectedResult: 'API responds with 2xx (accepted) or 4xx (rejected) — never 5xx.',
      };
    }

    case 'special-characters': {
      if (!baseObj || fields.length === 0) return null;
      const stringFields = fields.filter(f => ['string', 'email', 'url', 'enum'].includes(f.kind) && !f.path.includes('.') && !f.path.includes('['));
      if (stringFields.length === 0) return null;
      const f = stringFields[variant % stringFields.length];
      const samples = specialCharSamples();
      const s = samples[Math.floor(variant / Math.max(1, stringFields.length)) % samples.length];
      return {
        id,
        name: `Verify "${f.path}" round-trips ${s.label}`,
        category,
        method,
        url: spec.url,
        headers: baseHeaders,
        body: JSON.stringify({ ...baseObj, [f.path]: s.value }),
        expectedStatus: 200,
        assertions: {
          expectStatusClass: ['2xx', '4xx'],
          disallowStatus: [500, 502, 503, 504],
          bodyNotContains: ['Traceback', 'SQL syntax'],
          maxResponseTimeMs: 5_000,
        },
        description: `Sends ${s.label} in "${f.path}" to verify Unicode/encoding handling. Either round-trip safely or reject cleanly with 4xx.`,
        stepsToReproduce: defaultSteps(spec, `Set "${f.path}" to "${s.value.replace(/[ ‮​]/g, '?')}"`),
        expectedResult: 'API safely round-trips the value or returns a clean 4xx without leaking errors.',
      };
    }

    case 'security': {
      const allFields = baseObj ? Object.keys(baseObj) : [];
      const targetField = allFields[variant % Math.max(1, allFields.length)] || null;
      const payloads = securityPayloads(targetField ? classifyValue(baseObj[targetField]) : 'string');
      const p = payloads[variant % payloads.length];

      // For GET/DELETE we attempt the injection in a query parameter instead.
      if (method === 'GET' || method === 'DELETE' || !targetField) {
        const url = appendQuery(spec.url, 'q', typeof p.value === 'string' ? p.value : JSON.stringify(p.value));
        return {
          id,
          name: `Reject ${p.label} in query string`,
          category,
          method,
          url,
          headers: baseHeaders,
          body: null,
          expectedStatus: 400,
          assertions: securityAssertions,
          description: `Injects ${p.label} via the "q" query parameter to ensure the API sanitises or rejects it without leaking errors.`,
          stepsToReproduce: defaultSteps(spec, `Append ?q=${encodeURIComponent(typeof p.value === 'string' ? p.value : JSON.stringify(p.value)).slice(0, 60)}`),
          expectedResult: 'API rejects with 4xx, body free of stack traces / SQL fragments.',
        };
      }

      return {
        id,
        name: `Reject ${p.label} in body field "${targetField}"`,
        category,
        method,
        url: spec.url,
        headers: baseHeaders,
        body: JSON.stringify({ ...baseObj, [targetField]: p.value }),
        expectedStatus: 400,
        assertions: securityAssertions,
        description: `Injects ${p.label} into "${targetField}". API must sanitise/reject; any 5xx or echoed stack trace indicates a real vulnerability.`,
        stepsToReproduce: defaultSteps(spec, `Set "${targetField}" to a malicious payload (${p.label})`),
        expectedResult: 'API responds with 4xx; response body contains no error leakage or reflected payload execution.',
      };
    }

    case 'large-payload': {
      const huge: Record<string, any> = baseObj ? { ...baseObj } : {};
      const fieldsToAdd = 500 * (variant + 1);
      const chunkSize = 500;
      for (let i = 0; i < fieldsToAdd; i++) huge[`extra_${i}`] = 'x'.repeat(chunkSize);
      const approxMb = ((fieldsToAdd * chunkSize) / 1024 / 1024).toFixed(2);
      return {
        id,
        name: `Reject oversized payload (~${approxMb} MB, ${fieldsToAdd} extra fields)`,
        category,
        method,
        url: spec.url,
        headers: baseHeaders,
        body: JSON.stringify(huge),
        expectedStatus: 413,
        assertions: {
          expectStatusClass: ['4xx'],
          disallowStatus: [500, 502, 503, 504],
          maxResponseTimeMs: 15_000,
        },
        description: `Adds ${fieldsToAdd} ${chunkSize}-char dummy fields (~${approxMb} MB body) to verify request-size limits and reverse-proxy behaviour.`,
        stepsToReproduce: defaultSteps(spec, `Append ${fieldsToAdd} dummy fields of ${chunkSize} bytes each`),
        expectedResult: 'API or gateway responds with 413 Payload Too Large (or another 4xx). No 5xx, no connection drop.',
      };
    }

    case 'duplicate': {
      if (variant === 0) {
        return {
          id,
          name: `${method} duplicate detection — second identical request`,
          category,
          method,
          url: spec.url,
          headers: baseHeaders,
          body: spec.body,
          expectedStatus: method === 'POST' ? 409 : positiveStatus,
          assertions: method === 'POST'
            ? { expectStatusClass: ['4xx'], disallowStatus: [500, 502, 503, 504], maxResponseTimeMs: 5_000 }
            : { expectStatusClass: ['2xx', '4xx'], disallowStatus: [500, 502, 503, 504], maxResponseTimeMs: 5_000 },
          description: method === 'POST'
            ? 'Send the same POST twice; second call should produce 409 Conflict (or 422) — confirms idempotency or uniqueness rules.'
            : `For ${method}, both calls should produce identical outcomes (idempotency contract per RFC 9110).`,
          stepsToReproduce: [
            ...defaultSteps(spec, 'Send the original request'),
            'Wait 1 second',
            'Send the identical request a second time',
            'Inspect the second response',
          ],
          expectedResult: method === 'POST'
            ? 'Second call returns HTTP 409/422 and references the existing resource.'
            : `Second call returns the same status (${positiveStatus}) and body shape as the first — proves idempotency.`,
        };
      }
      return {
        id,
        name: `${method} concurrency — two parallel identical requests`,
        category,
        method,
        url: spec.url,
        headers: { ...baseHeaders, 'Idempotency-Key': 'duplicate-test-key-1' },
        body: spec.body,
        expectedStatus: method === 'POST' ? 409 : positiveStatus,
        assertions: {
          expectStatusClass: method === 'POST' ? ['2xx', '4xx'] : ['2xx'],
          disallowStatus: [500, 502, 503, 504],
          maxResponseTimeMs: 7_000,
        },
        description: 'Tests Idempotency-Key handling — when supported, a retried request should never double-execute the side effect.',
        stepsToReproduce: defaultSteps(spec, 'Add header: Idempotency-Key: duplicate-test-key-1 then resend twice'),
        expectedResult: 'Both calls return the same resource (no duplicate creation). No 5xx.',
      };
    }

    case 'negative': {
      const variations: any[] = [
        {
          name: 'Reject request with malformed JSON body',
          body: '{not json',
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
          desc: 'Sends a body that is syntactically invalid JSON.',
          step: 'Set body to invalid JSON: "{not json"',
          expected: 'API responds with HTTP 400 Bad Request and an error message about JSON parsing.',
          status: 400,
        },
        {
          name: 'Reject request with unsupported content type',
          body: spec.body,
          headers: { ...baseHeaders, 'Content-Type': 'text/plain' },
          desc: 'Submits a JSON body but advertises text/plain to verify Content-Type negotiation.',
          step: 'Set Content-Type header to text/plain',
          expected: 'API responds with HTTP 415 Unsupported Media Type.',
          status: 415,
        },
        {
          name: 'Reject unsupported HTTP method',
          method: method === 'GET' ? 'TRACE' : method === 'DELETE' ? 'PATCH' : 'PUT',
          body: spec.body,
          headers: baseHeaders,
          desc: 'Calls the endpoint with a method it should not accept.',
          step: `Change HTTP method to ${method === 'GET' ? 'TRACE' : method === 'DELETE' ? 'PATCH' : 'PUT'}`,
          expected: 'API responds with HTTP 405 Method Not Allowed and an Allow header listing supported methods.',
          status: 405,
        },
        {
          name: 'Reject request when Authorization header is missing',
          body: spec.body,
          headers: Object.fromEntries(Object.entries(baseHeaders).filter(([k]) => k.toLowerCase() !== 'authorization')),
          desc: 'Strips any Authorization/auth header to verify authn enforcement.',
          step: 'Remove the Authorization header (and any API key headers)',
          expected: 'API responds with HTTP 401 Unauthorized.',
          status: 401,
        },
        {
          name: 'Reject request with tampered Authorization token',
          body: spec.body,
          headers: { ...baseHeaders, Authorization: 'Bearer tampered.invalid.token' },
          desc: 'Sends an invalid bearer token to verify token validation.',
          step: 'Set Authorization to "Bearer tampered.invalid.token"',
          expected: 'API responds with HTTP 401 Unauthorized; no internals are leaked.',
          status: 401,
        },
      ];
      const v = variations[variant % variations.length];
      return {
        id,
        name: v.name,
        category,
        method: (v as any).method || method,
        url: spec.url,
        headers: (v as any).headers || baseHeaders,
        body: v.body ?? null,
        expectedStatus: v.status,
        assertions: { ...clientErrAssertions, expectStatus: v.status },
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

export function deterministicCases(spec: RequestSpec, opts: GenerateOptions): TestCase[] {
  const profile = profileRequest(spec);
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
      const c = buildDeterministicCase(spec, cat, i, profile);
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
        assertions: {
          expectStatusClass: ['2xx', '4xx'],
          disallowStatus: [500, 502, 503, 504],
          maxResponseTimeMs: 5_000,
        },
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
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const resp = await fetch(`${cfg.url.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        prompt: buildPrompt(spec, opts),
        stream: false,
        options: { temperature: 0.35, top_p: 0.9 },
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
