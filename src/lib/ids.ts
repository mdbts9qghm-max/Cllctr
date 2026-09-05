/** Ids und Zeitstempel. Bewusst winzig — aber an einer Stelle. */

export function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

export function now(): string {
  return new Date().toISOString();
}
