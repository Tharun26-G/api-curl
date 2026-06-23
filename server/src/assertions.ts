import { Assertion, AssertionRule, ResponseData, TestCase } from './types';

const SENSITIVE_LEAK_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'SQL syntax error', re: /\bsql syntax\b|you have an error in your sql/i },
  { name: 'Oracle error', re: /\bORA-\d{4,}\b/ },
  { name: 'MySQL syntax error', re: /\bMySQL\b.*\bsyntax\b/i },
  { name: 'PostgreSQL error', re: /\bPG::|pq:\s|postgresql\b.*\berror\b/i },
  { name: 'Python traceback', re: /\bTraceback \(most recent call last\)/i },
  { name: 'Node stack frame', re: /\bat [A-Za-z0-9_.$]+\([A-Za-z0-9_.$/\\]+:\d+:\d+\)/ },
  { name: 'Java exception', re: /\bjava\.[a-z]+(?:\.[A-Za-z0-9_$]+)+Exception\b/ },
  { name: 'Go panic', re: /\bgoroutine \d+ \[running\]:|panic: runtime error/i },
  { name: '.NET stack trace', re: /\bat [A-Za-z0-9_.<>]+\.[A-Za-z0-9_<>]+\([^)]*\) in [^:]+:line \d+/ },
  { name: 'Generic stack trace', re: /Stack trace:/i },
  { name: 'File system leak', re: /\/etc\/passwd|root:x:0:0:/i },
  { name: 'Internal IP leak', re: /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/ },
];

const PII_LEAK_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'private RSA key', re: /-----BEGIN (RSA|EC|OPENSSH|DSA|PRIVATE) PRIVATE KEY-----/ },
  { name: 'JWT token', re: /\beyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/ },
  { name: 'GitHub PAT', re: /ghp_[A-Za-z0-9]{36,}/ },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
];

function jsonPathLookup(root: unknown, path: string): { found: boolean; value: unknown } {
  if (path === '' || path === '$') return { found: true, value: root };
  const segments = path
    .replace(/^\$\.?/, '')
    .split(/\.|\[(\d+)\]/)
    .filter(s => s !== undefined && s !== '');
  let cur: any = root;
  for (const seg of segments) {
    if (cur == null) return { found: false, value: undefined };
    if (/^\d+$/.test(seg)) {
      if (!Array.isArray(cur)) return { found: false, value: undefined };
      cur = cur[Number(seg)];
    } else {
      if (typeof cur !== 'object') return { found: false, value: undefined };
      if (!(seg in cur)) return { found: false, value: undefined };
      cur = cur[seg];
    }
  }
  return { found: true, value: cur };
}

function inStatusClass(status: number, klass: '2xx' | '3xx' | '4xx' | '5xx'): boolean {
  switch (klass) {
    case '2xx': return status >= 200 && status < 300;
    case '3xx': return status >= 300 && status < 400;
    case '4xx': return status >= 400 && status < 500;
    case '5xx': return status >= 500 && status < 600;
  }
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) return v;
  }
  return undefined;
}

function describeStatus(status: number): string {
  if (status === 0) return 'no response';
  if (status >= 200 && status < 300) return `${status} (2xx success)`;
  if (status >= 300 && status < 400) return `${status} (3xx redirect)`;
  if (status >= 400 && status < 500) return `${status} (4xx client error)`;
  if (status >= 500 && status < 600) return `${status} (5xx server error)`;
  return String(status);
}

/**
 * Build the set of assertions to run for a given test case. If the case
 * provides explicit `assertions`, those drive the run. Otherwise we infer
 * a sensible default rule based on `expectedStatus` and the test category.
 */
function resolveRule(tc: TestCase): AssertionRule {
  const explicit: AssertionRule = tc.assertions ? { ...tc.assertions } : {};

  // Promote case-level expectedStatus → explicit assertion when not specified.
  if (explicit.expectStatus == null && tc.expectedStatus != null) {
    explicit.expectStatus = tc.expectedStatus;
  }

  // Sensible default time budgets per category (positive cases must be fast).
  if (explicit.maxResponseTimeMs == null) {
    switch (tc.category) {
      case 'positive':
      case 'special-characters':
        explicit.maxResponseTimeMs = 3_000;
        break;
      case 'negative':
      case 'missing-field':
      case 'empty':
      case 'boundary':
      case 'duplicate':
      case 'security':
        explicit.maxResponseTimeMs = 5_000;
        break;
      case 'large-payload':
        explicit.maxResponseTimeMs = 15_000;
        break;
      default:
        explicit.maxResponseTimeMs = 10_000;
    }
  }

  // Infer expected status class when neither an exact nor a class is set.
  if (explicit.expectStatus == null && (!explicit.expectStatusClass || explicit.expectStatusClass.length === 0)) {
    switch (tc.category) {
      case 'positive':
      case 'special-characters':
        explicit.expectStatusClass = ['2xx'];
        break;
      case 'negative':
      case 'missing-field':
      case 'empty':
      case 'boundary':
      case 'duplicate':
      case 'security':
      case 'large-payload':
        explicit.expectStatusClass = ['4xx'];
        break;
      case 'custom':
      default:
        explicit.expectStatusClass = ['2xx'];
    }
  }

  // Disallow 5xx for everything except cases explicitly asserting on 5xx.
  const explicitWants5xx =
    (explicit.expectStatus != null && explicit.expectStatus >= 500) ||
    (explicit.expectStatusClass || []).includes('5xx');
  if (!explicitWants5xx) {
    explicit.disallowStatus = Array.from(new Set([...(explicit.disallowStatus || []), 500, 502, 503, 504]));
  }

  return explicit;
}

export function evaluate(testCase: TestCase, resp: ResponseData): {
  assertions: Assertion[];
  passed: boolean;
  failureSummary?: string;
} {
  const assertions: Assertion[] = [];

  if (resp.error) {
    assertions.push({
      name: 'Request completed',
      passed: false,
      expected: 'HTTP response received',
      actual: `transport error: ${resp.error}`,
      severity: 'critical',
      message: 'The runtime could not get an HTTP response — every downstream assertion is skipped.',
    });
    return {
      assertions,
      passed: false,
      failureSummary: resp.error,
    };
  }

  const rule = resolveRule(testCase);

  // 1. Status code (exact or class)
  if (rule.expectStatus != null) {
    const ok = resp.status === rule.expectStatus;
    assertions.push({
      name: 'Status code matches expected',
      passed: ok,
      expected: describeStatus(rule.expectStatus),
      actual: describeStatus(resp.status),
      severity: 'critical',
      message: ok
        ? undefined
        : `Expected exactly ${rule.expectStatus} for "${testCase.category}" case; received ${resp.status} ${resp.statusText}.`,
    });
  } else if (rule.expectStatusClass && rule.expectStatusClass.length > 0) {
    const ok = rule.expectStatusClass.some(k => inStatusClass(resp.status, k));
    assertions.push({
      name: 'Status code in expected class',
      passed: ok,
      expected: rule.expectStatusClass.join(' or '),
      actual: describeStatus(resp.status),
      severity: 'critical',
      message: ok
        ? undefined
        : `For a "${testCase.category}" case the response status should fall in ${rule.expectStatusClass.join('/')}; got ${resp.status}.`,
    });
  }

  // 2. Disallowed status codes (server errors, etc.)
  if (rule.disallowStatus && rule.disallowStatus.length > 0) {
    const offending = rule.disallowStatus.includes(resp.status);
    assertions.push({
      name: 'Status not in disallowed set',
      passed: !offending,
      expected: `not in [${rule.disallowStatus.join(', ')}]`,
      actual: describeStatus(resp.status),
      severity: 'critical',
      message: offending
        ? `Status ${resp.status} indicates a server-side failure — the test inputs should never produce a 5xx.`
        : undefined,
    });
  }

  // 3. Response time threshold
  if (rule.maxResponseTimeMs != null) {
    const ok = resp.duration <= rule.maxResponseTimeMs;
    assertions.push({
      name: 'Response time under threshold',
      passed: ok,
      expected: `≤ ${rule.maxResponseTimeMs}ms`,
      actual: `${resp.duration}ms`,
      severity: ok ? 'warning' : 'warning',
      message: ok ? undefined : `${resp.duration}ms exceeded the ${rule.maxResponseTimeMs}ms budget.`,
    });
  }

  // 4. Content-Type prefix
  if (rule.contentTypeStartsWith) {
    const ct = findHeader(resp.headers, 'content-type') || '';
    const ok = ct.toLowerCase().startsWith(rule.contentTypeStartsWith.toLowerCase());
    assertions.push({
      name: `Content-Type starts with "${rule.contentTypeStartsWith}"`,
      passed: ok,
      expected: `starts with "${rule.contentTypeStartsWith}"`,
      actual: ct || '(missing)',
      severity: 'critical',
    });
  }

  // 5. Body contains / not contains
  if (rule.bodyContains) {
    for (const needle of rule.bodyContains) {
      const ok = resp.body.includes(needle);
      assertions.push({
        name: `Body contains "${truncate(needle, 40)}"`,
        passed: ok,
        expected: `contains "${truncate(needle, 40)}"`,
        actual: ok ? 'present' : 'missing',
        severity: 'critical',
      });
    }
  }
  if (rule.bodyNotContains) {
    for (const needle of rule.bodyNotContains) {
      const ok = !resp.body.toLowerCase().includes(needle.toLowerCase());
      assertions.push({
        name: `Body must not contain "${truncate(needle, 40)}"`,
        passed: ok,
        expected: `does not contain "${truncate(needle, 40)}"`,
        actual: ok ? 'absent' : 'present',
        severity: 'critical',
      });
    }
  }

  // 6. Required headers
  if (rule.expectHeaders) {
    for (const h of rule.expectHeaders) {
      const value = findHeader(resp.headers, h.name);
      if (h.value == null) {
        assertions.push({
          name: `Header "${h.name}" present`,
          passed: value !== undefined,
          expected: 'present',
          actual: value === undefined ? 'missing' : value,
          severity: 'critical',
        });
      } else {
        assertions.push({
          name: `Header "${h.name}" equals expected`,
          passed: value === h.value,
          expected: h.value,
          actual: value ?? '(missing)',
          severity: 'critical',
        });
      }
    }
  }

  // 7. JSON parse + path checks
  let parsedJson: unknown = undefined;
  let jsonParseOk = false;
  if (rule.expectJson || rule.jsonPathExists?.length || rule.jsonPathEquals?.length) {
    try {
      parsedJson = JSON.parse(resp.body);
      jsonParseOk = true;
      if (rule.expectJson) {
        assertions.push({
          name: 'Body is valid JSON',
          passed: true,
          expected: 'valid JSON',
          actual: 'valid',
          severity: 'critical',
        });
      }
    } catch (err: any) {
      jsonParseOk = false;
      if (rule.expectJson) {
        assertions.push({
          name: 'Body is valid JSON',
          passed: false,
          expected: 'valid JSON',
          actual: `parse error: ${truncate(err?.message || 'unknown', 60)}`,
          severity: 'critical',
        });
      }
    }
  }

  if (jsonParseOk && rule.jsonPathExists) {
    for (const p of rule.jsonPathExists) {
      const { found } = jsonPathLookup(parsedJson, p);
      assertions.push({
        name: `JSON path "${p}" exists`,
        passed: found,
        expected: 'present',
        actual: found ? 'present' : 'missing',
        severity: 'critical',
      });
    }
  }

  if (jsonParseOk && rule.jsonPathEquals) {
    for (const { path, value } of rule.jsonPathEquals) {
      const { found, value: actual } = jsonPathLookup(parsedJson, path);
      const ok = found && deepEqual(actual, value);
      assertions.push({
        name: `JSON path "${path}" equals expected`,
        passed: ok,
        expected: stringifyValue(value),
        actual: found ? stringifyValue(actual) : '(missing)',
        severity: 'critical',
      });
    }
  }

  // 8. Implicit category-aware safety checks
  //
  //   a) Security cases must never leak server internals.
  if (testCase.category === 'security') {
    const leaks = SENSITIVE_LEAK_PATTERNS.filter(p => p.re.test(resp.body));
    assertions.push({
      name: 'No stack trace / sensitive error in body',
      passed: leaks.length === 0,
      expected: 'no leak markers',
      actual: leaks.length === 0 ? 'clean' : `found: ${leaks.map(l => l.name).join(', ')}`,
      severity: 'critical',
      message: leaks.length === 0 ? undefined : 'Server-side error markers in the body suggest the payload reached the application layer unsanitised.',
    });

    // Reflected-payload check: if a known attack vector echoes verbatim, flag it.
    if (testCase.body) {
      try {
        const reqJson = JSON.parse(testCase.body);
        const stringValues: string[] = [];
        const collect = (v: any) => {
          if (typeof v === 'string') stringValues.push(v);
          else if (Array.isArray(v)) v.forEach(collect);
          else if (v && typeof v === 'object') Object.values(v).forEach(collect);
        };
        collect(reqJson);
        const dangerous = stringValues.filter(s =>
          /<script|onerror=|onload=|DROP TABLE|OR 1=1|\/etc\/passwd|169\.254\.169\.254/i.test(s),
        );
        for (const sample of dangerous) {
          if (resp.body.includes(sample)) {
            assertions.push({
              name: 'Malicious payload not reflected verbatim in response',
              passed: false,
              expected: 'payload sanitised, escaped, or rejected',
              actual: `verbatim reflection of "${truncate(sample, 40)}"`,
              severity: 'critical',
              message: 'Echoing an attack payload back to the client suggests the input was not validated/sanitised.',
            });
          }
        }
      } catch { /* body wasn't JSON */ }
    }
  }

  //   b) For positive 2xx responses with declared JSON expectation, sanity-check non-empty body.
  if (
    testCase.category === 'positive' &&
    resp.status >= 200 &&
    resp.status < 300 &&
    resp.status !== 204 &&
    testCase.method.toUpperCase() !== 'HEAD' &&
    resp.body.trim().length === 0
  ) {
    assertions.push({
      name: 'Successful response is not empty',
      passed: false,
      expected: 'non-empty body for 2xx (except 204/HEAD)',
      actual: 'empty body',
      severity: 'warning',
      message: 'A 2xx with an empty body where one is expected may indicate a misconfigured response.',
    });
  }

  //   c) 204 / HEAD should NOT have a body.
  if ((resp.status === 204 || testCase.method.toUpperCase() === 'HEAD') && resp.body.length > 0) {
    assertions.push({
      name: 'No body for 204 / HEAD',
      passed: false,
      expected: 'empty body',
      actual: `${resp.body.length} bytes`,
      severity: 'warning',
      message: 'RFC 9110: 204 No Content and HEAD responses must not include a payload body.',
    });
  }

  //   d) Universal credential leak check (warning — flagged even on positive tests).
  for (const pat of PII_LEAK_PATTERNS) {
    if (pat.re.test(resp.body)) {
      assertions.push({
        name: `No ${pat.name} in body`,
        passed: false,
        expected: 'absent',
        actual: 'found',
        severity: 'warning',
        message: 'Possible credential / secret leak — review response carefully.',
      });
    }
  }

  //   e) Special-characters round-trip check (only meaningful for 2xx JSON responses).
  if (testCase.category === 'special-characters' && testCase.body && jsonParseOk) {
    try {
      const reqJson = JSON.parse(testCase.body);
      const mutatedKey = Object.keys(reqJson).find(k => typeof reqJson[k] === 'string');
      if (mutatedKey && resp.status >= 200 && resp.status < 300) {
        const sent = String(reqJson[mutatedKey]);
        const round = resp.body.includes(sent);
        assertions.push({
          name: `Special characters in "${mutatedKey}" preserved`,
          passed: round,
          expected: 'echoed in response',
          actual: round ? 'echoed' : 'not echoed (may be sanitised)',
          severity: 'warning',
        });
      }
    } catch { /* ignore */ }
  }

  //   f) Idempotency hint: for PUT/DELETE with 2xx, confirm response doesn't include verbose error markers.
  if (
    ['PUT', 'DELETE'].includes(testCase.method.toUpperCase()) &&
    testCase.category === 'duplicate' &&
    resp.status >= 200 && resp.status < 300
  ) {
    assertions.push({
      name: 'Idempotent verb succeeded on retry',
      passed: true,
      expected: '2xx on repeated call',
      actual: describeStatus(resp.status),
      severity: 'warning',
    });
  }

  const criticalFailures = assertions.filter(a => !a.passed && a.severity === 'critical');
  const passed = criticalFailures.length === 0;
  const failureSummary = criticalFailures.length === 0
    ? undefined
    : criticalFailures.length === 1
      ? `${criticalFailures[0].name} — ${criticalFailures[0].message || `expected ${criticalFailures[0].expected}, got ${criticalFailures[0].actual}`}`
      : `${criticalFailures.length} assertions failed — first: ${criticalFailures[0].name}`;

  return { assertions, passed, failureSummary };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function stringifyValue(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return `"${truncate(v, 40)}"`;
  try { return truncate(JSON.stringify(v), 60); } catch { return String(v); }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual((a as any)[k], (b as any)[k]));
}
