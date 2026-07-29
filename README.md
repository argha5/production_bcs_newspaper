# bcsnewspaperapi

Static JSON backend for the **BCS Editorial Master** app.

The Groq API is called **only here, inside GitHub Actions** — once a day. The
Flutter app ships no API key and makes no model calls; it just downloads the
JSON that this repo commits.

## How it works

```
GitHub Actions (daily 07:20 Dhaka)
      │
      ├─ src/sources.js → newspaper RSS + article HTML → real editorials (0 API calls)
      │
      ├─ src/build.js   → Groq (JSON schema) → breakdown, translation, glossary
      │                 → Groq (JSON schema) → the long BCS Written answers
      │                 → Groq (JSON schema) → sentence-by-sentence grammar (English only)
      │
      ├─ data/YYYY-MM-DD.json   the whole day's paper in one file
      └─ data/index.json        manifest of the last 7 editions + hashes
```

### Why articles come from RSS, not from the model

Titles, URLs and publication dates are read from the newspapers' own feeds, so
they are **facts rather than model output** — the generator has no way to invent
a source. Groq only ever analyses text that was really published. This is also
what keeps the daily run inside the Groq free tier: sourcing costs nothing, so
the entire quota goes to analysis.

Feeds are configured in `config.json`. Items are filtered (no sports,
entertainment, crime or celebrity content), ranked — opinion/editorial sections
score highest, whether the whole feed is a column section or just the individual
URL sits in one — and the top candidates are fetched and body-extracted until
enough long-enough articles are found.

### Token budget — the thing that actually constrains this

Groq's free tier limits are **per organization and per model**: 8 000 tokens a
minute and 200 000 tokens a day for each pair. Two facts follow, and between
them they dictate the whole shape of the generator:

1. **The per-minute ceiling is also a per-request ceiling.** Groq counts the
   `max_completion_tokens` you *reserve*, not what you use, and rejects an
   oversized request with a 413. So the work is split finely — breakdown,
   translation and answers are separate calls over the same article, the
   translation is chunked by paragraph, and answers come a couple at a time.
   `config.json` sizes each piece to leave room for its own reply.
2. **Each model has its own allowance.** Work is routed by task: the
   quality-critical calls (breakdown, answers) prefer `gpt-oss-120b`, the
   mechanical ones (translation, grammar dissection) prefer `gpt-oss-20b`. Keys
   from *separate Groq accounts* multiply this again, because the limit is
   per-organization — `src/llm.js` treats every (key, model) pair as a lane,
   tracks each lane's budget from the rate-limit headers, and routes around a
   busy lane instead of stalling on it.

A full edition (4 Bengali + 5 English) costs roughly 250k tokens across ~80
requests. With three keys that is about a fifth of the daily allowance. Most of
the run's wall-clock is spent waiting out the per-minute ceiling rather than
generating, which is why the workflow allows two hours.

### Answer length

BCS Written answers are essay-length, and the app's original failing was 3–4
sentence blurbs. `src/prompts.js` mandates a 220–320 word answer in a six-part
structure, and any answer that still comes back under `minAnswerWords` is
regenerated once with its own short draft shown to the model — rewriting the one
weak answer works far better than re-rolling the whole batch.

## Endpoints (raw GitHub, no server needed)

| What | URL |
|---|---|
| Manifest (last 7 days) | `https://raw.githubusercontent.com/argha5/bcsnewspaperapi/main/data/index.json` |
| One day's edition | `https://raw.githubusercontent.com/argha5/bcsnewspaperapi/main/data/2026-07-26.json` |

The app fetches `index.json` (a couple of KB), then downloads at most **one**
edition file per day. Everything the app can display — article text, Bengali
translation, per-sentence grammar dissection, word anatomy, breakdown and Q&A —
is already inside that single file, so tapping a sentence or long-pressing a
word works fully offline.

## The edition hash

Every edition carries an `editionHash`: a SHA-256 over `{date, articles}`,
truncated to 24 hex chars. It deliberately excludes `generatedAt`, so identical
content always hashes identically.

- `index.json` advertises each day's hash.
- The app caches the edition under its hash and re-downloads only when the hash
  for that date changes.
- Before displaying, the app recomputes nothing but **compares** the downloaded
  file's `editionHash` against the manifest. A mismatch is rejected, so a
  half-written or stale file can never show up as today's paper.
- `src/validate.js` runs in CI and fails the job if two dates ever share a hash.

## Data shape

```jsonc
{
  "schemaVersion": 1,
  "date": "2026-07-26",
  "dateBn": "২৬ জুলাই ২০২৬, রবিবার",
  "editionHash": "3f9c…",
  "articleCount": 10,
  "articles": [
    {
      "id": "bn-1a2b3c4d",
      "lang": "bn",                  // "bn" | "en"
      "topic": "অর্থ-বাণিজ্য ও মূল্যস্ফীতি",
      "title": "…", "source": "প্রথম আলো", "url": "https://…", "published": "…",
      "content": "full article text",
      "sentences": [                 // tap-a-sentence data, precomputed
        { "i": 0, "text": "…", "bn": "…", "type": "Complex",
          "voice": "Active", "tense": "Present Perfect",
          "clauses": "…", "connectors": "…" }
      ],
      "glossary": [                  // long-press-a-word data, precomputed
        { "word": "mitigate", "bn": "প্রশমিত করা", "pos": "Verb",
          "nounForm": "…", "verbForm": "…", "adjectiveForm": "…", "adverbForm": "…",
          "synonyms": "…", "antonyms": "…", "fromArticle": "…", "example": "…" }
      ],
      "breakdown": { "mainTopic": "…", "problem": "…", "cause": "…",
                     "effect": "…", "solution": "…", "conclusion": "…", "keyQuote": "…" },
      "translationBn": "…",          // English articles: full Bengali translation
      "translationEn": "…",          // Bengali articles: full English translation
      "qna": [ { "q": "…", "a": "…", "keyPoints": ["…"], "words": 247 } ],
      "examTips": ["…"]
    }
  ]
}
```

`qna[].words` is the answer's word count. BCS Written answers are expected to run
220–320 words with a ভূমিকা → প্রেক্ষাপট → বিশ্লেষণ → চ্যালেঞ্জ → সুপারিশ →
উপসংহার structure, so `src/validate.js` **fails the build** if any answer comes
in under 120 words. It also rejects an article with no real source URL, and
scans for the repeated-filler signature of a truncated model response.

## Setup

1. Add the API key as a repository secret:
   `Settings → Secrets and variables → Actions → New repository secret`
   - Name: `GROQ_API_KEY`
   - Value: your Google AI Studio key
2. Optional repository *variable* `GROQ_MODEL` to override `config.json`'s model.
3. `Actions → Daily edition → Run workflow` to build the first edition by hand.

## Local run

```bash
export GROQ_API_KEY=...
npm run build           # today's edition, skips if it already exists
npm run build:force     # rebuild today
node src/build.js --date 2026-07-25
npm run validate        # check hashes + index consistency, no API key needed
```

## Tuning

Everything schedulable lives in `config.json`: the RSS feeds to read, how many
English/Bengali articles per day, the minimum article length per language, how
stale an article may be, how many glossary words and Q&A per article, how many
sentences get dissected, and how long editions are retained.

Article selection is driven entirely by what the newspapers published that day,
so there is no topic rotation to maintain — the `topic` chip shown in the app is
derived from the article itself during analysis. Titles from the retained
editions are passed back in as a skip-list, so the same piece never runs twice.
