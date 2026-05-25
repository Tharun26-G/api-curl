const NS = 'apiwb';

function key(name: string): string {
  return `${NS}:${name}`;
}

export function loadJSON<T>(name: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key(name));
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(name: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    // quota / serialization — silently ignore
  }
}

export function removeKey(name: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(key(name));
}
