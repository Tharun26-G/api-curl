import { TestCase } from './types';

function csvEscape(value: string): string {
  if (value == null) return '';
  const needs = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needs ? `"${escaped}"` : escaped;
}

function defaultDescription(tc: TestCase): string {
  return `Verifies the ${tc.category.replace('-', ' ')} behavior of ${tc.method} ${tc.url}.`;
}

function defaultSteps(tc: TestCase): string[] {
  const steps: string[] = [
    `Set HTTP method to ${tc.method}`,
    `Set request URL to ${tc.url}`,
  ];
  const headerKeys = Object.keys(tc.headers || {});
  if (headerKeys.length) steps.push(`Set headers: ${headerKeys.join(', ')}`);
  if (tc.body) steps.push(`Set request body to: ${tc.body.length > 120 ? tc.body.slice(0, 117) + '…' : tc.body}`);
  steps.push('Send the request');
  steps.push('Observe the response status code and body');
  return steps;
}

function defaultExpected(tc: TestCase): string {
  if (tc.expectedStatus) return `API responds with HTTP ${tc.expectedStatus}.`;
  if (tc.category === 'positive') return 'API responds with a 2xx success status.';
  return 'API responds with an appropriate 4xx error status.';
}

function titleFor(tc: TestCase): string {
  const name = tc.name?.trim() || `${tc.method} ${tc.url}`;
  return /^verify/i.test(name) ? name : `Verify ${name}`;
}

function stepsText(steps: string[]): string {
  return steps.map((s, i) => `${i + 1}. ${s.replace(/^\d+\.\s*/, '')}`).join('\n');
}

export function testCasesToCSV(cases: TestCase[]): string {
  const headers = ['Title', 'Description', 'Steps to Reproduce', 'Expected Result'];
  const rows = cases.map(tc => {
    const title = titleFor(tc);
    const description = tc.description?.trim() || defaultDescription(tc);
    const steps = (tc.stepsToReproduce && tc.stepsToReproduce.length > 0
      ? tc.stepsToReproduce
      : defaultSteps(tc));
    const expected = tc.expectedResult?.trim() || defaultExpected(tc);
    return [title, description, stepsText(steps), expected].map(csvEscape).join(',');
  });
  return [headers.join(','), ...rows].join('\r\n');
}

export function downloadCSV(filename: string, csv: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
