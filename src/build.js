// Daily edition builder.
//
// Runs once a day on GitHub Actions and writes a self-contained JSON edition
// into data/. Articles are pulled from newspaper RSS feeds (zero API cost, real
// URLs); Groq is used only to analyse text that was really published, which
// is what keeps the whole run inside the free tier. The Flutter app only ever
// reads the static files — it holds no API key and makes no model calls.
//
//   node src/build.js [--force] [--date YYYY-MM-DD] [--en N] [--bn N]

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateJson, callsMade, exhaustedModels, tokensSpent } from './llm.js';
import {
  bengaliStudySchema,
  englishStudySchema,
  qnaSchema,
  sentenceBatchSchema,
  singleAnswerSchema,
  translationSchema,
} from './schemas.js';
import {
  bengaliStudyPrompt,
  englishStudyPrompt,
  expandAnswerPrompt,
  qnaPrompt,
  sentenceBatchPrompt,
  translationPrompt,
} from './prompts.js';
import { collectArticles } from './sources.js';
import { articleId, editionHash } from './hash.js';
import {
  bengaliDate,
  chunk,
  dhakaDate,
  estimateTokens,
  sleep,
  splitSentences,
  wordCount,
} from './util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const SCHEMA_VERSION = 1;

const args = process.argv.slice(2);
const force = args.includes('--force');
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dateArg = flag('--date');

const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
// Each model carries its own daily token allowance, so tasks are spread across
// them by preference rather than all queueing behind one. GROQ_MODEL pins every
// task to a single model, which is useful for testing one budget at a time.
const modelsFor = (task) =>
  process.env.GROQ_MODEL ? [process.env.GROQ_MODEL] : config.models[task];

// --en / --bn keep a manual run cheap when you only want to smoke-test.
if (flag('--en') !== null) config.englishPerDay = Number(flag('--en'));
if (flag('--bn') !== null) config.bengaliPerDay = Number(flag('--bn'));

// ─── article pipeline ────────────────────────────────────────────────────────

/** Precompute the tap-a-sentence dissections the app used to request live. */
async function dissectSentences(sentences, topicLabel) {
  const capped = sentences.slice(0, config.maxSentencesPerArticle);
  const results = new Map();

  for (const batch of chunk(capped.map((text, index) => ({ text, index })), config.sentenceBatchSize)) {
    try {
      const json = await generateJson({
        models: modelsFor('dissect'),
        prompt: sentenceBatchPrompt({
          sentences: batch.map((b) => b.text),
          startIndex: batch[0].index,
        }),
        schema: sentenceBatchSchema,
        schemaName: 'sentence_dna',
        temperature: 0.4,
        // Ceiling raised to handle larger batches (up to 15 sentences) without
        // any risk of mid-JSON truncation.
        maxOutputTokens: 6000,
        effort: 'low',
        label: `dissect ${topicLabel} [${batch[0].index}-${batch[batch.length - 1].index}]`,
      });

      for (const s of json.sentences ?? []) {
        results.set(Number(s.index), s);
      }
    } catch (err) {
      console.warn(`  ! sentence batch failed, leaving those sentences plain: ${err.message.slice(0, 160)}`);
    }
    await sleep(1200);
  }

  return capped.map((text, index) => {
    const dissection = results.get(index) ?? {};
    return {
      i: index,
      text,
      bn: dissection.bn ?? '',
      type: dissection.sentenceType ?? '',
      voice: dissection.voice ?? '',
      tense: dissection.tense ?? '',
      clauses: dissection.clauses ?? '',
      connectors: dissection.connectors ?? '',
    };
  });
}

/**
 * The BCS Written answers, generated a couple at a time.
 *
 * Batching keeps each request inside the per-minute token ceiling and limits
 * the blast radius: a failed batch costs two answers, not the whole set.
 */
async function fetchQna(raw) {
  const qna = [];
  let examTips = [];
  const batches = chunk(Array.from({ length: config.qnaPerArticle }, (_, i) => i), config.qnaBatchSize);

  let lastBatchError = '';
  for (const [n, batch] of batches.entries()) {
    const label = `qna ${raw.lang}/${raw.title.slice(0, 30)} [${n + 1}/${batches.length}]`;
    let success = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const json = await generateJson({
          models: modelsFor('qna'),
          prompt: qnaPrompt({
            article: raw,
            qnaCount: batch.length,
            askedQuestions: qna.map((q) => q.q),
            withTips: n === 0,
          }),
          schema: qnaSchema,
          schemaName: 'bcs_qna',
          temperature: 0.65,
          maxOutputTokens: 8000,
          effort: 'medium',
          label,
        });

        // Models sometimes return Q&A under alternate keys — try the likely
        // candidates before giving up on an otherwise valid response.
        let rawQna = json.qna;
        if (!rawQna?.length) {
          rawQna = json.questions || json.qna_items || json.data;
          if (rawQna?.length) console.warn(`  ! ${label}: found Q&A under alternate key (not "qna")`);
        }
        // If the response itself is an array of {q, a, ...} objects, use it.
        if (!rawQna?.length && Array.isArray(json) && json.length > 0) {
          rawQna = json;
          console.warn(`  ! ${label}: response was a bare array, not wrapped in {qna: [...]}`);
        }
        // The model sometimes returns a flat single object {question, answer, ...}
        // instead of wrapping items in a qna array. Wrap it so normaliseQna can
        // map the verbose keys.
        if (!rawQna?.length && !Array.isArray(json) && (json.question || json.q)) {
          rawQna = [json];
          console.warn(`  ! ${label}: response was a flat Q&A object, wrapped into array`);
        }

        const items = normaliseQna(rawQna);
        if (items.length > 0) {
          qna.push(...items);
          if (n === 0) {
            const tips = json.examTips ?? json.exam_tips;
            if (Array.isArray(tips) && tips.length) {
              examTips = tips;
            } else if (typeof tips === 'string' && tips.trim()) {
              examTips = [tips.trim()];
            }
          }
          success = true;
          break;
        }
        // If we reach here, the model returned valid JSON but nothing usable.
        const keys = Array.isArray(json) ? '[array]' : Object.keys(json).join(', ');
        lastBatchError = `valid JSON but no Q&A items (keys: ${keys})`;
        console.warn(`  ! ${label} (attempt ${attempt + 1}): ${lastBatchError}`);
      } catch (err) {
        lastBatchError = err.message.slice(0, 200);
        console.warn(`  ! ${label} (attempt ${attempt + 1}) failed: ${lastBatchError}`);
        await sleep(2000);
      }
    }
  }

  if (qna.length === 0) {
    throw new Error(`Q&A generation failed completely for article "${raw.title}" — last batch: ${lastBatchError}`);
  }

  // Short answers were the original complaint about this app, so a stunted one
  // is rewritten rather than shipped. Expanding a single answer is cheap next to
  // the daily token allowance, and it is the part students actually study from.
  for (const [i, item] of qna.entries()) {
    if (item.words >= config.minAnswerWords) continue;

    const label = `expand ${raw.lang}/Q${i + 1} (${item.words}w)`;
    try {
      const json = await generateJson({
        models: modelsFor('qna'),
        prompt: expandAnswerPrompt({ article: raw, question: item.q, answer: item.a }),
        schema: singleAnswerSchema,
        schemaName: 'bcs_answer',
        temperature: 0.6,
        // Generous ceiling so the expanded answer is never cut short.
        maxOutputTokens: 10000,
        effort: 'medium',
        label,
      });
      const rewritten = normaliseQna([{ ...item, a: json.a ?? item.a }])[0];
      if (rewritten.words > item.words) {
        console.log(`  ↑ ${label} → ${rewritten.words}w`);
        qna[i] = rewritten;
      }
    } catch (err) {
      console.warn(`  ! ${label} failed: ${err.message.slice(0, 120)}`);
    }
  }

  return { qna, examTips };
}

/**
 * A full translation, split into chunks that each fit one request.
 *
 * The BCS Written translation question expects the whole passage, so this is
 * deliberately not summarised — it is just cut on paragraph boundaries and
 * stitched back together.
 */
async function fetchTranslation(raw, toBengali) {
  const paragraphs = raw.content.split(/\n{2,}/).filter((p) => p.trim());
  const groups = [];
  let current = [];

  for (const paragraph of paragraphs) {
    current.push(paragraph);
    if (estimateTokens(current.join('\n\n')) > config.translationChunkTokens) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  if (groups.length === 0) return '';

  const out = [];
  for (const [n, group] of groups.entries()) {
    const label = `translate ${raw.lang}/${raw.title.slice(0, 28)} [${n + 1}/${groups.length}]`;
    try {
      const json = await generateJson({
        models: modelsFor('translate'),
        prompt: translationPrompt({
          text: group.join('\n\n'),
          toBengali,
          part: n + 1,
          parts: groups.length,
        }),
        schema: translationSchema,
        schemaName: 'translation',
        temperature: 0.35,
        // 2000-token input chunk can expand to ~3500 tokens in Bengali — 6000
        // gives a 70 % headroom so finish_reason is never 'length'.
        maxOutputTokens: 6000,
        effort: 'low',
        label,
      });
      if (json.translation) out.push(json.translation.trim());
    } catch (err) {
      console.warn(`  ! ${label} failed: ${err.message.slice(0, 160)}`);
    }
  }

  return out.join('\n\n');
}

async function buildEnglishArticle(raw, date) {
  const analysis = await generateJson({
    models: modelsFor('study'),
    prompt: englishStudyPrompt({ article: raw, glossaryWords: config.glossaryWords }),
    schema: englishStudySchema,
    schemaName: 'english_study',
    temperature: 0.6,
    // 25 glossary words with all form fields + full breakdown = needs room.
    maxOutputTokens: 9000,
    label: `study en/${raw.title.slice(0, 36)}`,
  });

  const translationBn = await fetchTranslation(raw, true);
  const { qna, examTips } = await fetchQna(raw);
  const sentences = await dissectSentences(splitSentences(raw.content), `en/${raw.title.slice(0, 30)}`);

  return {
    id: articleId('en', date, raw.title),
    lang: 'en',
    topic: analysis.topic ?? analysis.breakdown?.mainTopic ?? '',
    title: raw.title,
    source: raw.source,
    url: raw.url,
    published: raw.published,
    content: raw.content,
    sentences,
    glossary: (analysis.glossary ?? []).map((g) => ({
      word: g.word,
      bn: g.bn,
      pos: g.pos ?? '',
      nounForm: g.nounForm ?? 'নেই',
      verbForm: g.verbForm ?? 'নেই',
      adjectiveForm: g.adjectiveForm ?? 'নেই',
      adverbForm: g.adverbForm ?? 'নেই',
      synonyms: g.synonyms ?? '',
      antonyms: g.antonyms ?? '',
      fromArticle: g.fromArticle ?? '',
      example: g.example ?? '',
    })),
    breakdown: analysis.breakdown ?? {},
    translationBn,
    translationEn: '',
    qna,
    examTips,
  };
}

async function buildBengaliArticle(raw, date) {
  const analysis = await generateJson({
    models: modelsFor('study'),
    prompt: bengaliStudyPrompt({ article: raw, glossaryWords: config.glossaryWords }),
    schema: bengaliStudySchema,
    schemaName: 'bengali_study',
    temperature: 0.6,
    // 25 Bengali glossary words with examples + breakdown comfortably needs 9k.
    maxOutputTokens: 9000,
    label: `study bn/${raw.title.slice(0, 36)}`,
  });

  const translationEn = await fetchTranslation(raw, false);
  const { qna, examTips } = await fetchQna(raw);

  return {
    id: articleId('bn', date, raw.title),
    lang: 'bn',
    topic: analysis.topic ?? analysis.breakdown?.mainTopic ?? '',
    title: raw.title,
    source: raw.source,
    url: raw.url,
    published: raw.published,
    content: raw.content,
    sentences: splitSentences(raw.content, true).map((text, i) => ({
      i,
      text,
      bn: '',
      type: '',
      voice: '',
      tense: '',
      clauses: '',
      connectors: '',
    })),
    glossary: (analysis.glossary ?? []).map((g) => ({
      word: g.word,
      bn: g.bn,
      pos: g.pos ?? '',
      en: g.en ?? '',
      fromArticle: g.fromArticle ?? '',
      example: g.example ?? '',
    })),
    breakdown: analysis.breakdown ?? {},
    translationBn: '',
    translationEn,
    qna,
    examTips,
  };
}

function normaliseQna(qna) {
  return (qna ?? [])
    .map((item) => ({
      q: item.q ?? item.question ?? '',
      a: item.a ?? item.answer ?? '',
      keyPoints: item.keyPoints ?? item.key_points ?? [],
      words: wordCount(item.a ?? item.answer ?? ''),
    }))
    .filter((item) => item.q && item.a);
}

// ─── index / archive bookkeeping ─────────────────────────────────────────────

async function readIndex() {
  if (!existsSync(INDEX_FILE)) return { schemaVersion: SCHEMA_VERSION, updatedAt: null, editions: [] };
  try {
    return JSON.parse(await readFile(INDEX_FILE, 'utf8'));
  } catch {
    return { schemaVersion: SCHEMA_VERSION, updatedAt: null, editions: [] };
  }
}

/** Titles already published in the retained editions, so articles don't repeat. */
async function recentTitles(index) {
  const titles = [];
  for (const edition of index.editions.slice(0, config.keepEditionsInIndex)) {
    const file = path.join(ROOT, edition.file);
    if (!existsSync(file)) continue;
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      titles.push(...data.articles.map((a) => a.title));
    } catch { /* ignore unreadable archives */ }
  }
  return titles;
}

async function pruneOldData(keepFrom) {
  const files = await readdir(DATA_DIR);
  for (const name of files) {
    const match = name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (match && match[1] < keepFrom) {
      await rm(path.join(DATA_DIR, name));
      console.log(`  pruned ${name}`);
    }
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

const date = dateArg || dhakaDate();
const editionFile = `data/${date}.json`;
const editionPath = path.join(ROOT, editionFile);

await mkdir(DATA_DIR, { recursive: true });

if (existsSync(editionPath) && !force) {
  console.log(`Edition for ${date} already exists. Use --force to rebuild.`);
  process.exit(0);
}

const index = await readIndex();
const avoidTitles = await recentTitles(index);

const allModels = [...new Set(Object.values(config.models).flat())];
console.log(`Building edition ${date} using ${allModels.join(', ')}`);

// Sourcing happens first and costs nothing: if the feeds are down we find out
// before spending a single model call.
console.log('\nCollecting source articles from RSS…');
const sourced = {
  bn: await collectArticles({
    feeds: config.feeds,
    lang: 'bn',
    want: config.bengaliPerDay,
    minWords: config.minArticleWordsBn,
    maxAgeDays: config.maxArticleAgeDays,
    targetDate: date,
    skipTitles: avoidTitles,
  }),
  en: await collectArticles({
    feeds: config.feeds,
    lang: 'en',
    want: config.englishPerDay,
    minWords: config.minArticleWordsEn,
    maxAgeDays: config.maxArticleAgeDays,
    targetDate: date,
    skipTitles: avoidTitles,
  }),
};
console.log(`  ${sourced.bn.length} Bengali + ${sourced.en.length} English articles sourced`);

const articles = [];
const failures = [];

// Bengali first: the app opens on the Bangla feed, and if the run is cut short
// by rate limits we would rather lose an English piece than the whole tab.
const jobs = [...sourced.bn, ...sourced.en];

for (const raw of jobs) {
  console.log(`\n▶ ${raw.lang}: ${raw.title.slice(0, 70)}`);
  try {
    const article = raw.lang === 'bn'
      ? await buildBengaliArticle(raw, date)
      : await buildEnglishArticle(raw, date);

    const shortAnswers = article.qna.filter((q) => q.words < 150).length;
    if (shortAnswers) {
      console.warn(`  ! ${shortAnswers}/${article.qna.length} answers came back under 150 words`);
    }
    articles.push(article);
    console.log(`  ✓ ${article.title} (${article.qna.length} Q&A, ${article.glossary.length} words, ${article.sentences.length} sentences)`);
  } catch (err) {
    failures.push(`${raw.lang}/${raw.title.slice(0, 60)}: ${err.message.slice(0, 200)}`);
    console.warn(`  ✗ skipped — ${err.message.slice(0, 200)}`);
  }
  await sleep(1500);
}

if (articles.length === 0) {
  console.error('\nNo articles were produced — refusing to write an empty edition.');
  console.error(failures.join('\n'));
  process.exit(1);
}

// Interleave bn/en so the feed alternates languages instead of running in blocks.
const bn = articles.filter((a) => a.lang === 'bn');
const en = articles.filter((a) => a.lang === 'en');
const ordered = [];
for (let i = 0; i < Math.max(bn.length, en.length); i++) {
  if (bn[i]) ordered.push(bn[i]);
  if (en[i]) ordered.push(en[i]);
}

const hash = editionHash(date, ordered);
const edition = {
  schemaVersion: SCHEMA_VERSION,
  date,
  dateBn: bengaliDate(date),
  editionHash: hash,
  generatedAt: new Date().toISOString(),
  models: allModels,
  articleCount: ordered.length,
  bengaliCount: bn.length,
  englishCount: en.length,
  failures,
  articles: ordered,
};

await writeFile(editionPath, `${JSON.stringify(edition, null, 1)}\n`, 'utf8');

const entry = {
  date,
  dateBn: edition.dateBn,
  hash,
  file: editionFile,
  articleCount: ordered.length,
  bengaliCount: bn.length,
  englishCount: en.length,
  generatedAt: edition.generatedAt,
  headlines: ordered.map((a) => ({ id: a.id, lang: a.lang, topic: a.topic, title: a.title, source: a.source })),
};

const editions = [entry, ...index.editions.filter((e) => e.date !== date)]
  .sort((a, b) => (a.date < b.date ? 1 : -1))
  .slice(0, config.keepEditionsInIndex);

await writeFile(
  INDEX_FILE,
  `${JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: edition.generatedAt,
      latestDate: editions[0].date,
      latestHash: editions[0].hash,
      keepDays: config.keepEditionsInIndex,
      editions,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const cutoff = new Date(Date.now() - config.pruneDataOlderThanDays * 86_400_000).toISOString().slice(0, 10);
await pruneOldData(cutoff);

const sizeKb = Math.round(Buffer.byteLength(JSON.stringify(edition)) / 1024);
console.log(`\n✓ ${editionFile} — ${ordered.length} articles, hash ${hash}, ${sizeKb} KB, ${callsMade()} model calls`);
// The binding free-tier limit is 200k tokens per model per day, so this is the
// number to watch when tuning how many articles an edition carries.
for (const [model, tokens] of Object.entries(tokensSpent())) {
  console.log(`  ${model}: ${(tokens / 1000).toFixed(1)}k tokens of the 200k daily allowance`);
}
const spent = exhaustedModels();
if (spent.length) console.log(`  daily allowance exhausted on: ${spent.join(', ')}`);
if (failures.length) console.log(`  ${failures.length} article(s) skipped:\n   ${failures.join('\n   ')}`);
