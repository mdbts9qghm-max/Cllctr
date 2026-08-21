/** Kurze, eindeutige Ids. crypto.randomUUID gibt es in allen Ziel-Browsern. */
export function newId(prefix: string): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${raw.replace(/-/g, '').slice(0, 16)}`;
}

export function now(): string {
  return new Date().toISOString();
}
