import { TestCase } from './types';

const FLAG_ALIASES: Record<string, string> = {
  '--request': '-X',
  '--header': '-H',
  '--data': '-d',
  '--data-raw': '-d',
  '--data-binary': '-d',
  '--url': '--url',
};

function tokenize(curl: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < curl.length) {
    if (curl[i] === ' ' || curl[i] === '\t' || curl[i] === '\n') {
      i++;
      continue;
    }
    if (curl[i] === '\\' && (i + 1 >= curl.length || curl[i + 1] === '\n' || curl[i + 1] === '\r')) {
      i += 2;
      continue;
    }
    if (curl[i] === '"' || curl[i] === "'") {
      const quote = curl[i];
      let token = '';
      i++;
      while (i < curl.length && curl[i] !== quote) {
        if (curl[i] === '\\' && i + 1 < curl.length) {
          token += curl[++i];
        } else {
          token += curl[i];
        }
        i++;
      }
      if (i < curl.length) i++;
      tokens.push(token);
    } else {
      let token = '';
      while (i < curl.length && curl[i] !== ' ' && curl[i] !== '\t' && curl[i] !== '\n') {
        if (curl[i] === '\\' && i + 1 < curl.length && (curl[i + 1] === ' ' || curl[i + 1] === '"' || curl[i + 1] === "'")) {
          token += curl[++i];
        } else {
          token += curl[i];
        }
        i++;
      }
      tokens.push(token);
    }
  }
  return tokens;
}

function normalizeFlag(flag: string): string {
  return FLAG_ALIASES[flag] || flag;
}

export function parseCurl(curl: string): TestCase {
  const trimmed = curl.trim();
  const tokens = tokenize(trimmed);

  let method = 'GET';
  let url = '';
  const headers: Record<string, string> = {};
  let body: string | null = null;

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === 'curl') {
      i++;
      continue;
    }
    const flag = normalizeFlag(token);
    if (flag === '-X' && i + 1 < tokens.length) {
      method = tokens[i + 1].toUpperCase();
      i += 2;
    } else if (flag === '-H' && i + 1 < tokens.length) {
      const header = tokens[i + 1];
      const colonIdx = header.indexOf(':');
      if (colonIdx > 0) {
        const key = header.substring(0, colonIdx).trim();
        const value = header.substring(colonIdx + 1).trim();
        if (key.toLowerCase() !== 'content-length') {
          headers[key] = value;
        }
      }
      i += 2;
    } else if (flag === '-d' && i + 1 < tokens.length) {
      body = (body || '') + tokens[i + 1];
      if (method === 'GET') method = 'POST';
      i += 2;
    } else if (token === '--url' && i + 1 < tokens.length) {
      url = tokens[i + 1];
      i += 2;
    } else if (!token.startsWith('-') && !url) {
      url = token;
      i++;
    } else {
      i++;
    }
  }

  if (!method) method = body ? 'POST' : 'GET';

  return {
    id: Math.random().toString(36).substring(2, 10),
    name: `${method} ${url}`.slice(0, 80),
    category: 'custom',
    method,
    url,
    headers,
    body,
    rawCurl: trimmed,
  };
}

export function parseMultipleCurls(input: string): TestCase[] {
  const rawCurls = input
    .split(/(?=curl\s)/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (rawCurls.length === 0) {
    const single = parseCurl(input);
    return single.url ? [single] : [];
  }

  return rawCurls.map(raw => parseCurl(raw));
}
