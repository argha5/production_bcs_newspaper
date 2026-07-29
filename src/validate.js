// Verifies the committed data/ tree: every edition parses, every editionHash
// recomputes correctly, and index.json agrees with the files on disk.
// Runs in CI after the build so a corrupt edition is never published.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { editionHash } from './hash.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

const problems = [];

if (!existsSync(INDEX_FILE)) {
  console.error('data/index.json is missing.');
  process.exit(1);
}

const index = JSON.parse(await readFile(INDEX_FILE, 'utf8'));

if (!Array.isArray(index.editions) || index.editions.length === 0) {
  problems.push('index.json lists no editions');
}

const seenHashes = new Map();

for (const entry of index.editions ?? []) {
  const file = path.join(ROOT, entry.file);
  if (!existsSync(file)) {
    problems.push(`${entry.date}: ${entry.file} referenced by index but missing on disk`);
    continue;
  }

  const edition = JSON.parse(await readFile(file, 'utf8'));
  const recomputed = editionHash(edition.date, edition.articles);

  if (edition.date !== entry.date) problems.push(`${entry.date}: file reports date ${edition.date}`);
  if (edition.editionHash !== recomputed) problems.push(`${entry.date}: stored hash ${edition.editionHash} != recomputed ${recomputed}`);
  if (entry.hash !== edition.editionHash) problems.push(`${entry.date}: index hash ${entry.hash} != edition hash ${edition.editionHash}`);
  if (entry.articleCount !== edition.articles.length) problems.push(`${entry.date}: index says ${entry.articleCount} articles, file has ${edition.articles.length}`);

  // Two different days must never advertise the same hash — that is the
  // guarantee the app relies on to tell one day's paper from another.
  if (seenHashes.has(edition.editionHash)) {
    problems.push(`${entry.date}: hash collides with ${seenHashes.get(edition.editionHash)}`);
  }
  seenHashes.set(edition.editionHash, entry.date);

  edition.articles.forEach((a, i) => {
    if (!a.id || !a.title || !a.content) problems.push(`${entry.date}#${i}: article missing id/title/content`);
    if (!/^https?:\/\//.test(a.url ?? '')) problems.push(`${entry.date}#${i}: article has no real source URL`);
    if (!Array.isArray(a.qna) || a.qna.length === 0) problems.push(`${entry.date}#${i}: no Q&A`);

    // The whole point of the rewrite: BCS Written answers are essay-length.
    // A short answer is a silent quality regression, so fail the build on it.
    const stunted = (a.qna ?? []).filter((q) => (q.words ?? 0) < 120);
    if (stunted.length) problems.push(`${entry.date}#${i}: ${stunted.length}/${a.qna.length} answers under 120 words`);

    // A repetition loop is how a truncated payload shows up in committed data.
    const looped = JSON.stringify(a).match(/(.{2,10}?)\1{20,}/);
    if (looped) problems.push(`${entry.date}#${i}: repeated filler detected (${looped[1].slice(0, 12)}…)`);
  });
}

const orphans = (await readdir(DATA_DIR))
  .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
  .filter((n) => !(index.editions ?? []).some((e) => e.file.endsWith(n)));
if (orphans.length) console.log(`note: ${orphans.length} archived edition(s) outside the index window (kept on disk)`);

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):\n - ${problems.join('\n - ')}`);
  process.exit(1);
}

console.log(`✓ index + ${index.editions.length} edition(s) valid; latest ${index.latestDate} (${index.latestHash})`);
