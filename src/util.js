// Small helpers shared by the generator.

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const BN_MONTHS = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];
const BN_WEEKDAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

/** Today in Bangladesh (the edition day), as YYYY-MM-DD. */
export function dhakaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function toBengaliDigits(input) {
  return String(input).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/** "2026-07-26" -> "২৬ জুলাই ২০২৬, রবিবার" */
export function bengaliDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const weekday = BN_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${toBengaliDigits(d)} ${BN_MONTHS[m - 1]} ${toBengaliDigits(y)}, ${weekday}`;
}

/** Whole days since the Unix epoch. */
export function dayNumber(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Split article text into sentences the app can map back to the dissections. */
export function splitSentences(text, isBengali = false) {
  const parts = isBengali
    ? text.split(/(?<=।|\?|!)\s+/)
    : text.split(/(?<=[.!?])\s+(?=[A-Z"'“‘(])/);
  return parts.map((s) => s.trim()).filter((s) => s.length > 15);
}

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Rough token count, measured against the tokenizer rather than guessed.
 *
 * Bengali costs about 2.9 characters per token and English about 5.4, so a
 * single ratio would either overcommit on Bengali or waste half the budget on
 * English. Both matter here because Groq rejects — rather than queues — a
 * request whose prompt plus reserved output exceeds the per-minute ceiling.
 */
export function estimateTokens(text) {
  const s = String(text || '');
  const bengali = (s.match(/[ঀ-৿]/g) ?? []).length;
  const rest = s.length - bengali;
  return Math.ceil(bengali / 2.8 + rest / 5.2) + 24;
}

/** Trim text to fit a token budget, cutting at a sentence end where possible. */
export function clampToTokens(text, maxTokens) {
  const s = String(text || '');
  if (estimateTokens(s) <= maxTokens) return s;

  const ratio = maxTokens / estimateTokens(s);
  let cut = s.slice(0, Math.max(200, Math.floor(s.length * ratio * 0.97)));
  const lastStop = Math.max(cut.lastIndexOf('। '), cut.lastIndexOf('. '));
  if (lastStop > cut.length * 0.6) cut = cut.slice(0, lastStop + 1);
  return cut;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
