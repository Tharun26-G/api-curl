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
  expectStatus?: number;
  expectStatusClass?: ('2xx' | '3xx' | '4xx' | '5xx')[];
  disallowStatus?: number[];
  maxResponseTimeMs?: number;
  bodyContains?: string[];
  bodyNotContains?: string[];
  contentTypeStartsWith?: string;
  jsonPathExists?: string[];
  jsonPathEquals?: { path: string; value: unknown }[];
  expectHeaders?: { name: string; value?: string }[];
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

export interface RequestSpec {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
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

export type CategoryCounts = Partial<Record<TestCategory, number>>;

export interface GenerateOptions {
  counts?: CategoryCounts;
  customPrompt?: string;
  customCount?: number;
}
