// AI API client using Bynara Router (https://router.bynara.id/).
// No dependencies — plain fetch (Node >= 20).
//
// API key lives only in GitHub Actions secrets and is used exclusively
// inside this generator. Bynara Router provides 7 million tokens/day,
// routing to multiple underlying models via an OpenAI-compatible API.
//
// The client treats each (key, model) combination as its own lane.
// Remaining budget is tracked from rate-limit headers so a busy lane is
// routed around rather than discovered through a 429.

import { estimateTokens } from './util.js';

const ENDPOINT = 'https://router.bynara.id/v1/chat/completions';

/** Per-minute token ceiling. Bynara router has generous limits. */
const TPM = Number(process.env.AI_TPM || 50000);
const TPM_MARGIN = 400;

/**
 * How long the build is willing to sit waiting for one lane's daily allowance
 * to roll over. Beyond this the lane is written off for the run and the edition
 * ships with whatever it managed — a shorter paper beats a workflow that hangs.
 */
const maxLaneWaitMs = Number(process.env.AI_MAX_WAIT_MINUTES || 25) * 60_000;

const apiKeys = [
  process.env.AI_API_KEY,
  ...String(process.env.AI_API_KEYS || '').split(','),
]
  .map((k) => (k || '').trim())
  .filter(Boolean)
  .filter((k, i, all) => all.indexOf(k) === i);

if (apiKeys.length === 0) {
  console.error('No AI API key set. Add AI_API_KEY as a repository secret.');
  process.exit(1);
}

const keyName = (key) => `key…${key.slice(-4)}`;

let callCount = 0;
export function callsMade() {
  return callCount;
}

/** Tokens spent per model — the binding limit is 200k per model per day. */
const spentByModel = new Map();
export function tokensSpent() {
  return Object.fromEntries(spentByModel);
}

/** Lane state, keyed by `${key}|${model}`. */
const lanes = new Map();

function lane(key, model) {
  const id = `${key}|${model}`;
  if (!lanes.has(id)) {
    lanes.set(id, { key, model, remaining: TPM, readyAt: 0, dailyDone: false });
  }
  return lanes.get(id);
}

export function exhaustedModels() {
  const dead = new Set();
  for (const model of new Set([...lanes.values()].map((l) => l.model))) {
    const forModel = [...lanes.values()].filter((l) => l.model === model);
    if (forModel.length && forModel.every((l) => l.dailyDone)) dead.add(model);
  }
  return [...dead];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

/** "2m52.8s" / "16.815s" / "300ms" → milliseconds. */
function parseDuration(value) {
  if (!value) return 0;
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct * 1000;

  let ms = 0;
  for (const [, amount, unit] of value.matchAll(/([\d.]+)(ms|m|s|h)/g)) {
    const n = Number(amount);
    if (unit === 'ms') ms += n;
    else if (unit === 's') ms += n * 1000;
    else if (unit === 'm') ms += n * 60_000;
    else if (unit === 'h') ms += n * 3_600_000;
  }
  return ms;
}

const isDailyLimit = (detail) => /per day|\bTPD\b|\bRPD\b/i.test(detail);

// Round-robin cursor, so consecutive calls spread across keys instead of
// hammering the first one until it rate-limits.
let cursor = 0;

/**
 * Pick a lane with room for `needed` tokens, waiting only if every lane for
 * these models is cooling down.
 */
async function acquireLane(models, needed, label) {
  const candidates = [];
  for (const model of models) {
    for (const key of apiKeys) candidates.push(lane(key, model));
  }

  const deadline = now() + maxLaneWaitMs;

  while (true) {
    const alive = candidates.filter((l) => !l.dailyDone);
    if (alive.length === 0) {
      throw new Error(`every key/model lane has spent its daily allowance (${models.join(', ')})`);
    }

    // A lane whose cooldown has elapsed gets its per-minute budget back.
    for (const l of alive) {
      if (l.readyAt <= now()) l.remaining = TPM;
    }

    // Model order is a preference, so scan in the order given and rotate only
    // the key within each model.
    for (const model of models) {
      const forModel = apiKeys
        .map((_, i) => lane(apiKeys[(cursor + i) % apiKeys.length], model))
        .filter((l) => !l.dailyDone);

      const ready = forModel.find((l) => l.readyAt <= now() && l.remaining >= needed);
      if (ready) {
        cursor = (cursor + 1) % apiKeys.length;
        return ready;
      }
    }

    const soonest = Math.min(...alive.map((l) => l.readyAt));
    if (soonest > deadline) {
      throw new Error(`no lane frees up within ${Math.round(maxLaneWaitMs / 60_000)} minutes (${models.join(', ')})`);
    }

    const wait = Math.max(2000, Math.min(soonest - now(), 60_000));
    console.log(`  … ${label}: all lanes busy, waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
}

function readRateLimits(l, res) {
  const remaining = Number(res.headers.get('x-ratelimit-remaining-tokens'));
  const reset = parseDuration(res.headers.get('x-ratelimit-reset-tokens'));
  if (Number.isFinite(remaining)) l.remaining = remaining;
  if (reset) l.readyAt = now() + reset;
}

/**
 * One chat completion, routed to whichever key/model lane has room.
 *
 * @param {object} o
 * @param {string[]} o.models   model ids in preference order
 * @param {string} o.prompt     the user prompt
 * @param {string} [o.system]   system instruction
 * @param {object} [o.schema]   JSON schema — forces structured output
 * @param {number} [o.temperature]
 * @param {number} [o.maxOutputTokens]
 * @param {'low'|'medium'|'high'} [o.effort]  reasoning effort
 * @param {string} [o.label]    log label
 * @returns {Promise<string>} raw model text
 */
export async function generate({
  models,
  prompt,
  system,
  schema = null,
  schemaName = 'payload',
  temperature = 0.6,
  maxOutputTokens = 4096,
  effort = 'medium',
  label = 'call',
}) {
  const promptTokens = estimateTokens(system) + estimateTokens(prompt);
  const headroom = TPM - TPM_MARGIN - promptTokens;
  if (headroom < 600) {
    throw new Error(`prompt is too long for the ${TPM}-token per-minute ceiling (${promptTokens} tokens)`);
  }
  const reserved = Math.min(maxOutputTokens, headroom);
  const needed = promptTokens + reserved;

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const base = {
    messages,
    temperature,
    max_completion_tokens: reserved,
  };

  // Every call in this generator is an analysis call, so it is always JSON-
  // constrained. Web search is deliberately not used: articles come from RSS
  // instead, which costs no quota and cannot produce an invented URL.
  if (schema) {
    base.response_format = { type: 'json_object' };
    if (!messages.some((m) => (m.content || '').toLowerCase().includes('json'))) {
      messages[messages.length - 1].content += '\n\nOutput must be valid JSON.';
    }
  }

  const maxAttempts = 5;
  let attempt = 0;
  let lastError;
  let body = { ...base };

  while (attempt < maxAttempts) {
    const l = await acquireLane(models, needed, label);
    body.model = l.model;

    try {
      callCount++;
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${l.key}` },
        body: JSON.stringify(body),
      });
      readRateLimits(l, res);

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 400);

        // The daily allowance is a rolling 24h window, not a midnight reset, so
        // a capped lane frees up again on its own. Record when, and treat a lane
        // as retired only if it will not return before the run has to finish —
        // never permanently, or one unlucky moment would write off the lane for
        // the rest of a multi-hour build.
        if (res.status === 429 && isDailyLimit(detail)) {
          const stated = parseDuration(res.headers.get('retry-after'))
            || parseDuration(detail.match(/try again in ([\dhms.]+)/i)?.[1]);
          const wait = stated || 15 * 60_000;
          l.remaining = 0;
          l.readyAt = now() + wait;
          l.dailyDone = wait > maxLaneWaitMs;
          console.warn(
            `  ↪ ${label}: ${l.model} on ${keyName(l.key)} is at its daily cap, free again in ${Math.round(wait / 60_000)}m`
            + (l.dailyDone ? ' — too long for this run' : ''),
          );
          lastError = new Error(`${l.model}/${keyName(l.key)}: daily allowance spent`);
          continue;
        }

        // 429 (window spent) and 413 (this request is larger than what is left
        // in the window) both mean: this lane is busy, try another one.
        if (res.status === 429 || res.status === 413) {
          l.remaining = 0;
          l.readyAt = now() + (parseDuration(res.headers.get('retry-after')) || 30_000);
          lastError = new Error(`HTTP ${res.status} — ${detail}`);
          continue;
        }

        // Smaller models can fail to satisfy a deeply nested strict schema and
        // return nothing at all. Plain JSON mode still yields a parseable
        // object — the prompt describes every field anyway.
        if (res.status === 400 && /json_validate_failed/.test(detail) && body.response_format?.type === 'json_schema') {
          console.warn(`  ! ${label}: ${l.model} could not satisfy the strict schema, switching to plain JSON mode`);
          body = {
            ...body,
            response_format: { type: 'json_object' },
            messages: [
              ...messages,
              { role: 'system', content: `Reply with a single JSON object matching this schema:\n${JSON.stringify(schema)}` },
            ],
          };
          continue;
        }

        if (res.status >= 500) {
          attempt++;
          lastError = new Error(`HTTP ${res.status} — ${detail}`);
          console.warn(`  ! ${label}: HTTP ${res.status}, retrying`);
          await sleep(3000 * attempt);
          continue;
        }

        throw new Error(`HTTP ${res.status} — ${detail}`);
      }

      const json = await res.json();
      spentByModel.set(l.model, (spentByModel.get(l.model) ?? 0) + (json.usage?.total_tokens ?? 0));

      const choice = json.choices?.[0];
      const text = (choice?.message?.content ?? '').trim();

      if (!text) {
        attempt++;
        lastError = new Error(`no text returned (${choice?.finish_reason ?? 'empty'})`);
        console.warn(`  ! ${label}: empty response, retrying`);
        await sleep(2000 * attempt);
        continue;
      }

      // Truncated output is unparseable JSON. It usually means the model fell
      // into a repetition loop, so nudge the temperature up and spend less of
      // the budget on reasoning.
      if (choice.finish_reason === 'length') {
        attempt++;
        lastError = new Error(`output hit the ${reserved}-token limit and was truncated`);
        body.temperature = Math.min(1.2, body.temperature + 0.15);
        body.reasoning_effort = 'low';
        console.warn(`  ! ${label}: output truncated, retrying warmer`);
        continue;
      }

      return text;
    } catch (err) {
      lastError = err;

      // A dropped socket never produced a response; reconnect on another lane
      // rather than burning a retry slot on it.
      const dropped = err.cause?.code === 'UND_ERR_SOCKET' || err.cause?.code === 'ECONNRESET';
      if (dropped) {
        l.readyAt = now() + 3000;
        console.warn(`  ! ${label}: connection dropped, retrying on another key`);
        await sleep(1500);
        continue;
      }

      attempt++;
      if (attempt >= maxAttempts) break;
      console.warn(`  ! ${label}: ${err.message.slice(0, 160)} — retry ${attempt}/${maxAttempts - 1}`);
      await sleep(3000 * attempt);
    }
  }

  throw lastError ?? new Error(`${label}: exhausted retries`);
}

/** generate() + JSON.parse, tolerating ```json fences and stray prose. */
export async function generateJson(options) {
  const raw = await generate(options);
  return parseJsonLoose(raw, options.label ?? 'call');
}

export function parseJsonLoose(raw, label = 'call') {
  let text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();

  try {
    return JSON.parse(text);
  } catch {
    // Fall back to the outermost {...} or [...] span.
    const start = text.search(/[{[]/);
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch { /* fall through */ }
    }
    throw new Error(`${label}: response was not valid JSON (${text.slice(0, 200)}…)`);
  }
}
