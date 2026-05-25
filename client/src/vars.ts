import { Environment } from './types';

export function substitute(value: string, vars: Record<string, string>): string {
  if (!value || !vars) return value;
  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    return match;
  });
}

export function substituteHeaders(headers: Record<string, string>, vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[substitute(k, vars)] = substitute(v, vars);
  return out;
}

export function activeVars(env: Environment | null): Record<string, string> {
  return env?.vars ?? {};
}
