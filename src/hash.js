import { createHash } from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted recursively so the same content always
 * serialises identically, regardless of insertion order.
 */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * The edition hash. It covers the date + article payload only — never
 * generatedAt — so a re-run that produces identical content yields an identical
 * hash, and any change to any article produces a different one.
 *
 * The app pins each day to its hash: a downloaded edition whose editionHash
 * does not match the hash advertised in index.json is rejected, so yesterday's
 * (or a partially written) edition can never surface as "today's paper".
 */
export function editionHash(date, articles) {
  return createHash('sha256')
    .update(canonical({ date, articles }))
    .digest('hex')
    .slice(0, 24);
}

export function articleId(lang, date, title) {
  const digest = createHash('sha1').update(`${lang}|${date}|${title}`).digest('hex').slice(0, 8);
  return `${lang}-${digest}`;
}
