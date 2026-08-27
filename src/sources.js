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
const BLOCKED_PATH = /\/(sports?|cricket|football|entertainment|showbiz|glitz|celebrity|lifestyle|fashion|food|travel|horoscope|crime|accident|obituary|photo|video|gallery|job|chakri|religion|islam|dharma|prayer|mosque|temple|church|namaz|salah|hajj|umrah|quran|puja|ramadan)(\/|$)/i;
const BLOCKED_BN = /(খেলা|ক্রিকেট|ফুটবল|বিনোদন|সিনেমা|নাটক|তারকা|রাশিফল|লাইফস্টাইল|ভ্রমণ|রেসিপি|দুর্ঘটনা|নিহত|গ্রেপ্তার|ধর্ষণ|খুন|লাশ|চাকরি|বিজ্ঞপ্তি|নামাজ|রোজা|ইফতার|সেহরি|তারাবি|জুমার নামাজ|ঈদের নামাজ|ঈদ মোবারক|পূজা উদযাপন|পূজামণ্ডপ|ওয়াজ মাহফিল|তাবলিগ|দোয়া মাহফিল|মিলাদ|ইসলামী জলসা|হজ পালন|উমরা পালন|আযান|কোরআন তেলাওয়াত)/;
const BLOCKED_EN = /\b(cricket|football|match|tournament|actor|actress|film|movie|celebrity|arrested|murder|rape|killed in|road crash|friday prayer|jumma prayer|eid prayer|eid mubarak|namaz|hajj pilgrimage|umrah|puja celebration|durga puja|church service|mosque sermon|religious sermon|quran recitation|tabligh|waz mahfil)\b/i;

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
  // 1. National & International Affairs
  'national', 'politics', 'polity', 'governance', 'parliament', 'election', 'constitution', 'judiciary',
  'reform', 'diplomacy', 'foreign policy', 'geopolitics', 'international', 'bilateral', 'security', 'defence',
  'rohingya', 'south asia', 'indo-pacific', 'china', 'india', 'us', 'global', 'un', 'summit',
  // 2. Editorial & Op-Ed
  'editorial', 'opinion', 'column', 'commentary', 'analysis', 'perspective', 'viewpoint',
  // 3. Economy & Commerce
  'economy', 'economic', 'budget', 'gdp', 'inflation', 'bank', 'banking', 'tax', 'taxation', 'revenue',
  'trade', 'export', 'import', 'remittance', 'investment', 'finance', 'fiscal', 'monetary', 'tariff',
  // 4. Science & Technology
  'science', 'technology', 'tech', 'artificial intelligence', 'ai', 'cyber', 'digital', 'innovation',
  'research', 'space', 'automation', 'biotech', 'climate', 'environment', 'energy'
];

const RELEVANT_BN = [
  // ১. জাতীয় ও আন্তর্জাতিক খবর
  'জাতীয়', 'রাজনীতি', 'প্রশাসন', 'শাসন', 'সংসদ', 'নির্বাচন', 'সংবিধান', 'বিচার', 'সংস্কার',
  'কূটনীতি', 'পররাষ্ট্র', 'ভূরাজনীতি', 'আন্তর্জাতিক', 'দ্বিপক্ষীয়', 'নিরাপত্তা', 'রোহিঙ্গা',
  'ভারত', 'চীন', 'যুক্তরাষ্ট্র', 'দক্ষিণ এশিয়া',
  // ২. সম্পাদকীয় ও উপসম্পাদকীয়
  'সম্পাদকীয়', 'উপ-সম্পাদকীয়', 'উপসম্পাদকীয়', 'মতামত', 'কলাম', 'বিশ্লেষণ', 'দৃষ্টিভঙ্গি',
  // ৩. অর্থনীতি ও বাণিজ্য
  'অর্থনীতি', 'অর্থনৈতিক', 'বাজেট', 'জিডিপি', 'মূল্যস্ফীতি', 'মুদ্রাস্ফীতি', 'ব্যাংক', 'ব্যাংকিং', 'কর',
  'রাজস্ব', 'বাণিজ্য', 'রপ্তানি', 'আমদানি', 'রেমিট্যান্স', 'বিনিয়োগ', 'অর্থায়ন', 'শুল্ক',
  // ৪. বিজ্ঞান ও প্রযুক্তি
  'বিজ্ঞান', 'প্রযুক্তি', 'কৃত্রিম বুদ্ধিমত্তা', 'সাইবার', 'ডিজিটাল', 'উদ্ভাবন', 'গবেষণা',
  'মহাকাশ', 'জলবায়ু', 'পরিবেশ', 'জ্বালানি', 'বিদ্যুৎ'
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

export function parsePubDate(pubDate) {
  if (!pubDate) return null;
  let timestamp = Date.parse(pubDate);
  if (Number.isNaN(timestamp)) {
    // Handle 'Thu, 07/30/2026 - 12:30' or non-standard RSS date formats
    const cleaned = pubDate.replace(/\s*-\s*/, ' ');
    timestamp = Date.parse(cleaned);
  }
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp);
}

export function getDhakaDateStr(pubDate) {
  const d = parsePubDate(pubDate);
  if (!d) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Dhaka' });
}

function ageInDays(pubDate) {
  const d = parsePubDate(pubDate);
  if (!d) return 999; // Treat invalid/unparseable dates as very old
  return (Date.now() - d.getTime()) / 86_400_000;
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
  targetDate,
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

  // Compute yesterday's Dhaka date (targetDate - 1 day) once, so late-night
  // articles published the previous calendar day in Dhaka are not missed.
  let targetDateYesterday = null;
  if (targetDate) {
    const d = new Date(`${targetDate}T00:00:00+06:00`);
    d.setDate(d.getDate() - 1);
    targetDateYesterday = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Dhaka' });
  }

  const ranked = candidates
    .filter((item) => item.title && /^https?:\/\//.test(item.link))
    .filter((item) => !isBlocked(item))
    .filter((item) => {
      if (!parsePubDate(item.pubDate)) return false; // Reject unparseable dates
      const itemDhakaDate = getDhakaDateStr(item.pubDate);
      if (!itemDhakaDate) return false;
      // Primary: exact match on today's Dhaka date.
      if (targetDate && itemDhakaDate === targetDate) return true;
      // Secondary: yesterday's Dhaka date — covers articles published late
      // at night (e.g., 23:30 Dhaka) which belong to today's edition.
      if (targetDateYesterday && itemDhakaDate === targetDateYesterday) return true;
      // Fallback when no targetDate is given: use the configured age window.
      if (!targetDate) {
        const age = ageInDays(item.pubDate);
        return age >= 0 && age <= (maxAgeDays ?? 1.5);
      }
      return false;
    })
    .filter((item) => {
      const key = item.title.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => {
      const itemDhakaDate = getDhakaDateStr(item.pubDate);
      const isTargetDate = targetDate ? (itemDhakaDate === targetDate) : false;
      const isYesterday = targetDateYesterday ? (itemDhakaDate === targetDateYesterday) : false;
      let score = relevanceScore(item);
      // Today's articles get the biggest boost; yesterday's get a smaller one
      // so they appear only when today's pool is thin.
      if (isTargetDate) score += 10;
      else if (isYesterday) score += 3;
      return { item, score, isTargetDate };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      // Articles matching targetDate come first
      if (a.isTargetDate !== b.isTargetDate) {
        return a.isTargetDate ? -1 : 1;
      }
      // Newer published items come first
      const ageDiff = ageInDays(a.item.pubDate) - ageInDays(b.item.pubDate);
      if (Math.abs(ageDiff) > 0.2) {
        return ageDiff;
      }
      return b.score - a.score;
    })
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
      // Full article content is preserved completely without token truncation.
      content: content.trim(),
    });
  }

  return picked;
}
