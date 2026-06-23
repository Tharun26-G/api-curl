export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type TestCategory =
  | 'positive'
  | 'negative'
  | 'missing-field'
  | 'boundary'
  | 'empty'
  | 'duplicate'
  | 'security'
  | 'large-payload'
  | 'special-characters'
  | 'custom';

export type AssertionSeverity = 'critical' | 'warning';

export interface AssertionRule {
  /** Status code must equal this value */
  expectStatus?: number;
  /** Status code must fall in one of these classes */
  expectStatusClass?: ('2xx' | '3xx' | '4xx' | '5xx')[];
  /** Status code must NOT equal any of these values */
  disallowStatus?: number[];
  /** Max acceptable response time (ms) */
  maxResponseTimeMs?: number;
  /** Body (as raw text) must contain each of these substrings */
  bodyContains?: string[];
  /** Body must NOT contain any of these substrings */
  bodyNotContains?: string[];
  /** Response Content-Type must start with this string */
  contentTypeStartsWith?: string;
  /** JSON paths that must exist (dot-notation) in the parsed JSON body */
  jsonPathExists?: string[];
  /** JSON-path equality checks */
  jsonPathEquals?: { path: string; value: unknown }[];
  /** Headers that must be present (case-insensitive); value optional */
  expectHeaders?: { name: string; value?: string }[];
  /** Body must parse as valid JSON */
  expectJson?: boolean;
}

export interface TestCase {
  id: string;
  name: string;
  category: TestCategory;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  rawCurl?: string;
  expectedStatus?: number;
  description?: string;
  stepsToReproduce?: string[];
  expectedResult?: string;
  assertions?: AssertionRule;
}

export interface ResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  size: number;
  error?: string;
}

export interface Assertion {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  severity: AssertionSeverity;
  message?: string;
}

export interface TestResult {
  testCase: TestCase;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  size: number;
  passed: boolean;
  error?: string;
  assertions: Assertion[];
  failureSummary?: string;
}

export interface OllamaConfig {
  url: string;
  model: string;
}

export interface OllamaStatus {
  connected: boolean;
  models?: string[];
  error?: string;
}

export interface SavedRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  body: string;
  auth: string;
  updatedAt: number;
}

export interface Collection {
  id: string;
  name: string;
  requests: SavedRequest[];
}

export interface Environment {
  id: string;
  name: string;
  vars: Record<string, string>;
}

export type CategoryCounts = Partial<Record<TestCategory, number>>;

export interface GenerateOptions {
  counts: CategoryCounts;
  customPrompt?: string;
  customCount?: number;
}
