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
  preScript: string;
  tests: string;
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
