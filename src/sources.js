// Real articles, without spending a single model call.
//
// Every editorial in an edition comes from a newspaper's own RSS feed, so the
// title, URL and publication date are facts rather than model output — there is
// no way for the generator to invent a source. Groq is used only to analyse
// text we already have, which is also what keeps the daily run inside the free
// tier.

import { clampToTokens } from './util.js';

const UA ='Mozilla/5.0 (compatible; bcsnewspaperapi/1.0; +https://github.com/argha5/bcsnewspaperapi)';

/** Sections that are never useful for BCS preparation. */
const BLOCKED_PATH = /\/(sports?|cricket|football|entertainment|showbiz|glitz|celebrity|lifestyle|fashion|food|travel|horoscope|crime|accident|obituary|photo|video|gallery|job|chakri)(\/|$)/i;
const BLOCKED_BN = /(খেলা|ক্রিকেট|ফুটবল|বিনোদন|সিনেমা|নাটক|তারকা|রাশিফল|লাইফস্টাইল|ভ্রমণ|রেসিপি|দুর্ঘটনা|নিহত|গ্রেপ্তার|ধর্ষণ|খুন|লাশ|চাকরি|বিজ্ঞপ্তি)/;
const BLOCKED_EN = /\b(cricket|football|match|tournament|actor|actress|film|movie|celebrity|arrested|murder|rape|killed in|road crash)\b/i;

/**
 * A URL that lives in an opinion/editorial section. Newspapers encode this in
 * the path, so a mixed "everything" feed can still be mined for its columns —
 * which is how the Bengali side gets real editorials instead of spot news.
 */
const OPINION_PATH =
  /\/(opinion|editorial|thoughts|column|columns|analysis|perspective|commentary|viewpoint|motamot|sompadokiyo|উপ-সম্পাদকীয়|সম্পাদকীয়|মতামত|কলাম|বিশ্লেষণ)(\/|$)/i;

/** Headlines that are procedural news bulletins rather than analysis. */
const NEWSY_BN = /(সাক্ষাৎ|বৈঠক|জানালেন|বললেন|কী বললেন|অভিযোগ|মামলা|রিমান্ড|আটক|উদ্বোধন|শোক|অভিনন্দন|সংবাদ সম্মেলন)/;

/** Words that mark an article as BCS-relevant; used to rank candidates. */
const RELEVANT_EN = [
  'economy', 'budget', 'inflation', 'bank', 'tax', 'revenue', 'trade', 'export', 'investment',
  'constitution', 'governance', 'reform', 'election', 'parliament', 'judiciary', 'corruption',
  'climate', 'environment', 'flood', 'energy', 'renewable', 'agriculture', 'water',
  'education', 'health', 'poverty', 'inequality', 'women', 'gender', 'labour', 'migrant',
  'diplomacy', 'foreign policy', 'geopolitic', 'rohingya', 'india', 'china', 'indo-pacific',
  'technology', 'digital', 'artificial intelligence', 'cyber', 'sdg', 'development', 'policy',
];

const RELEVANT_BN = [
  'অর্থনীতি', 'বাজেট', 'মূল্যস্ফীতি', 'মুদ্রাস্ফীতি', 'ব্যাংক', 'রাজস্ব', 'কর', 'রপ্তানি', 'বিনিয়োগ', 'বাণিজ্য',
  'সংবিধান', 'সুশাসন', 'সংস্কার', 'নির্বাচন', 'সংসদ', 'বিচার', 'দুর্নীতি', 'প্রশাসন', 'নীতি',
  'জলবায়ু', 'পরিবেশ', 'বন্যা', 'জ্বালানি', 'বিদ্যুৎ', 'কৃষি', 'নদী',
  'শিক্ষা', 'স্বাস্থ্য', 'দারিদ্র্য', 'বৈষম্য', 'নারী', 'শ্রমিক', 'প্রবাসী', 'জনসংখ্যা',
  'কূটনীতি', 'পররাষ্ট্র', 'ভূরাজনীতি', 'রোহিঙ্গা', 'ভারত', 'চীন',
  'প্রযুক্তি', 'ডিজিটাল', 'কৃত্রিম বুদ্ধিমত্তা', 'সাইবার', 'উন্নয়ন', 'সম্পাদকীয়', 'মতামত',
];

async function get(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"');
}

function tag(item, name) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? decodeEntities(match[1]).trim() : '';
}

/** HTML -> readable plain text, keeping paragraph boundaries. */
export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|iframe|figure|figcaption|aside|nav|header|footer|form)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|h[1-6]|li|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
}

/** Pull the article body out of a page by taking clean paragraph text. */
function extractArticleBody(html) {
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => htmlToText(m[1]).trim())
    .filter((p) =>
      p.length > 35 &&
      !/^(share|read more|also read|advertisement|আরও পড়ুন|বিজ্ঞাপন|copyright|©|all rights reserved|by\s+|photo:|file photo:|image:|courtesy:|published:|updated:)/i.test(p) &&
      !/thedailystar\.net|tbsnews\.net|prothomalo\.com|ajkerpatrika\.com/i.test(p) &&
      !/(E-paper|Today’s News|Politics|Governance|Crime and Justice|Lifestyle|Entertainment|Slow Reads|In Focus|Geopolitical Insights)/i.test(p)
    );
  return cleanArticleContent(paragraphs.join('\n\n'));
}

export function cleanArticleContent(text) {
  if (!text) return '';
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length < 25) return false;
      if (/^(By\s+|Photo:|File photo:|Image:|Courtesy:|Follow us|Subscribe|Sign up|Read more|Also read|Author:|Published:|Updated:)/i.test(line)) return false;
      if (/^(©|Copyright|All rights reserved|thedailystar\.net|tbsnews\.net|prothomalo\.com|ajkerpatrika\.com)/i.test(line)) return false;
      if (/(E-paper|Today’s News|Politics|Governance|Crime and Justice|Lifestyle|Entertainment|Slow Reads|In Focus|Geopolitical Insights)/i.test(line)) return false;
      if (/https?:\/\/|\S+@\S+\.\S+/.test(line)) return false;
      return true;
    })
    .join('\n\n');
}



export function countWords(text, isBengali = false) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;
  // Bengali has no spaces around punctuation the same way; splitting on
  // whitespace still approximates word count closely enough for a threshold.
  return trimmed.split(/\s+/).filter(Boolean).length * (isBengali ? 1 : 1);
}

function parseFeed(xml, feed) {
  const items = xml.split(/<item(?:\s[^>]*)?>/i).slice(1);
  return items.map((raw) => {
    const item = raw.split(/<\/item>/i)[0];
    const link = tag(item, 'link') || tag(item, 'guid');
    const categories = [...item.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)]
      .map((m) => decodeEntities(m[1]).trim())
      .join(' ');
    return {
      title: htmlToText(tag(item, 'title')),
      link,
      pubDate: tag(item, 'pubDate') || tag(item, 'dc:date'),
      body: tag(item, 'content:encoded') || tag(item, 'description') || '',
      categories,
      source: feed.source,
      lang: feed.lang,
      // Either the whole feed is a column section, or this single item sits in
      // one — the second case is what rescues editorials from mixed feeds.
      editorial:
        Boolean(feed.editorial) ||
        OPINION_PATH.test(decodeURIComponent(link || '')) ||
        OPINION_PATH.test(categories),
    };
  });
}

function isBlocked(item) {
  const haystack = `${item.title} ${item.categories}`;
  if (BLOCKED_PATH.test(item.link)) return true;
  if (item.lang === 'bn' ? BLOCKED_BN.test(haystack) : BLOCKED_EN.test(haystack)) return true;
  return false;
}

function relevanceScore(item) {
  const haystack = `${item.title} ${item.categories}`.toLowerCase();
  const words = item.lang === 'bn' ? RELEVANT_BN : RELEVANT_EN;
  let score = words.reduce((n, w) => (haystack.includes(w.toLowerCase()) ? n + 1 : n), 0);
  // Opinion/editorial pieces are exactly what a BCS candidate should be reading.
  if (item.editorial) score += 4;
  // "X met Y", "Z said" — a bulletin, not something worth analysing for an exam.
  if (item.lang === 'bn' && NEWSY_BN.test(item.title)) score -= 3;
  return score;
}

function ageInDays(pubDate) {
  if (!pubDate) return 0;
  const published = Date.parse(pubDate);
  if (Number.isNaN(published)) return 0;
  return (Date.now() - published) / 86_400_000;
}

/**
 * Collect candidate articles for one language: read the feeds, drop the
 * irrelevant and the stale, rank what is left, and return the best ones with
 * full body text.
 *
 * @returns {Promise<Array<{title,source,url,published,content,lang}>>}
 */
export async function collectArticles({
  feeds,
  lang,
  want,
  minWords,
  maxAgeDays,
  maxTokens = 1800,
  skipTitles = [],
}) {
  const seen = new Set(skipTitles.map((t) => t.toLowerCase().trim()));
  const candidates = [];

  for (const feed of feeds.filter((f) => f.lang === lang)) {
    try {
      const xml = await get(feed.url);
      candidates.push(...parseFeed(xml, feed));
    } catch (err) {
      console.warn(`  ! feed ${feed.url}: ${err.message}`);
    }
  }

  const ranked = candidates
    .filter((item) => item.title && /^https?:\/\//.test(item.link))
    .filter((item) => !isBlocked(item))
    .filter((item) => ageInDays(item.pubDate) <= maxAgeDays)
    .filter((item) => {
      const key = item.title.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({ item, score: relevanceScore(item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || ageInDays(a.item.pubDate) - ageInDays(b.item.pubDate))
    .map((entry) => entry.item);

  const picked = [];
  const isBn = lang === 'bn';

  for (const item of ranked) {
    if (picked.length >= want) break;

    // The feed body is often the whole article; only hit the site when it isn't.
    let content = cleanArticleContent(htmlToText(item.body));
    if (countWords(content, isBn) < minWords) {
      try {
        content = extractArticleBody(await get(item.link));
      } catch (err) {
        console.warn(`  ! fetch ${item.link}: ${err.message}`);
        continue;
      }
    }

    if (countWords(content, isBn) < minWords) continue;

    picked.push({
      lang,
      title: item.title,
      source: item.source,
      url: item.link,
      published: item.pubDate,
      // Each analysis request has to carry the whole article, so the text is
      // capped by tokens rather than characters — Bengali costs nearly twice
      // as many tokens per character as English.
      content: clampToTokens(content, maxTokens),
    });
  }

  return picked;
}
