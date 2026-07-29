// All prompt text for the daily edition generator.
//
// Answer quality is the whole point of this file: BCS Written answers are
// essay-length, so every Q&A prompt below demands a structured 200+ word
// answer (ভূমিকা → প্রেক্ষাপট → বিশ্লেষণ → সুপারিশ → উপসংহার) instead of the
// 3–4 sentence blurbs the old in-app prompts produced.

const PERSONA = `You are the editorial research engine for "BCS Editorial Master", a study app for Bangladesh Civil Service (BCS) aspirants preparing for the Written (লিখিত) examination. You are precise, factual, and never invent sources.`;

const ANSWER_RULES = `উত্তর লেখার বাধ্যতামূলক নিয়ম (এগুলো ভাঙা যাবে না):
1. প্রতিটি উত্তর কমপক্ষে ২২০ শব্দ এবং সর্বোচ্চ ৩২০ শব্দের হবে। ৩-৪ বাক্যের সংক্ষিপ্ত উত্তর সম্পূর্ণ অগ্রহণযোগ্য।
2. প্রতিটি উত্তর বিসিএস লিখিত পরীক্ষার মানের হবে এবং নিচের কাঠামো অনুসরণ করবে —
   • **ভূমিকা:** ২-৩ বাক্যে ধারণাটির সংজ্ঞা বা প্রেক্ষাপট।
   • **প্রেক্ষাপট ও কারণ:** সমস্যাটির উৎপত্তি ও মূল কারণসমূহ।
   • **বিশ্লেষণ:** বাংলাদেশের বাস্তব চিত্র — সাল, পরিসংখ্যান, নীতি, আইন, প্রতিষ্ঠান বা আন্তর্জাতিক উদাহরণসহ।
   • **চ্যালেঞ্জ:** বাস্তবায়নের প্রতিবন্ধকতা।
   • **সুপারিশ:** ৩-৪টি সুনির্দিষ্ট, বাস্তবায়নযোগ্য প্রস্তাব।
   • **উপসংহার:** ২ বাক্যে সারসংক্ষেপ।
3. উপরের ছয়টি অংশের শিরোনাম উত্তরের ভেতরে **বোল্ড মার্কডাউন** হিসেবে থাকবে, যাতে অ্যাপে সাজানো দেখায়।
4. ভাষা হবে প্রমিত, গাম্ভীর্যপূর্ণ ও লেখ্য বাংলা (সাধু-চলিত মেশানো নয়) — পরীক্ষার খাতায় যেমন লেখা হয়।
5. যেখানে সম্ভব সংবিধানের অনুচ্ছেদ, SDG লক্ষ্য, পঞ্চবার্ষিক পরিকল্পনা, বাজেট বরাদ্দ, বিশ্বব্যাংক/IMF/BBS-এর তথ্য উল্লেখ করবে। কোনো তথ্য নিশ্চিত না হলে আনুমানিক বলে উল্লেখ করবে, বানিয়ে লিখবে না।
6. প্রতিটি প্রশ্ন হবে বিশ্লেষণধর্মী ("কেন", "কীভাবে", "মূল্যায়ন করুন", "পর্যালোচনা করুন") — শুধু তথ্যভিত্তিক নয়।`;

/**
 * Articles themselves come from newspaper RSS feeds (see sources.js), never
 * from the model — so there is no "find me an article" prompt here. The model
 * only ever analyses text that was really published, which keeps every URL
 * verifiable and the daily run inside the Groq free tier.
 */

/**
 * Every prompt below is one request, and each request has to fit inside the
 * provider's per-minute token ceiling together with the room reserved for its
 * answer. That is why the work is split this finely: breakdown, translation and
 * the answers are three separate calls over the same article rather than one
 * payload, and the answers are generated a couple at a time.
 */

/** English article: breakdown + word anatomy. */
export function englishStudyPrompt({ article, glossaryWords }) {
  return `${PERSONA}

Below is an English editorial published by ${article.source}. Produce the BCS study payload as JSON matching the provided schema.

TITLE: ${article.title}
ARTICLE:
"""
${article.content}
"""

Section requirements:

1. "topic" — a 2-4 word Bengali label naming the BCS syllabus area this article belongs to (e.g. "স্বাস্থ্য ও জনস্বাস্থ্য", "বাংলাদেশের অর্থনীতি", "আন্তর্জাতিক সম্পর্ক", "পরিবেশ ও জলবায়ু"). This is shown as the chip above the headline in the app.

2. "breakdown" — Editorial Reverse Engineering. Each field must be 2-4 full sentences written in Bengali (the "keyQuote" field alone stays in the original English, quoted verbatim from the article).

3. "glossary" — exactly ${glossaryWords} genuinely advanced/difficult words taken from the article. For each: "word" (the word as used), "bn" (contextual Bengali meaning), "pos" (part of speech in this context), "nounForm"/"verbForm"/"adjectiveForm"/"adverbForm" (each as "form (বাংলা অর্থ)", or the single word "নেই" when that form does not exist — never use dashes or repeated punctuation as a placeholder), "synonyms" and "antonyms" (2-3 each, comma separated), "fromArticle" (the exact sentence from the article containing the word), and "example" (a NEW example sentence you write).`;
}

/** Bengali article: breakdown + terminology. */
export function bengaliStudyPrompt({ article, glossaryWords }) {
  return `${PERSONA}

নিচে ${article.source}-এ প্রকাশিত একটি বাংলা সম্পাদকীয়/মতামত কলাম দেওয়া হলো। এটির উপর বিসিএস স্টাডি পেলোড JSON আকারে তৈরি করো (প্রদত্ত স্কিমা অনুসারে)।

শিরোনাম: ${article.title}
লেখা:
"""
${article.content}
"""

প্রতিটি অংশের নির্দেশনা:

১. "topic" — ২-৪ শব্দে বাংলায় বিসিএস সিলেবাসের যে অংশে এই লেখাটি পড়ে তার নাম (যেমন: "স্বাস্থ্য ও জনস্বাস্থ্য", "বাংলাদেশের অর্থনীতি", "আন্তর্জাতিক সম্পর্ক", "পরিবেশ ও জলবায়ু")। অ্যাপে শিরোনামের উপরে এটি ট্যাগ হিসেবে দেখানো হবে।

২. "breakdown" — সম্পাদকীয় বিশ্লেষণ। প্রতিটি ফিল্ড ২-৪টি পূর্ণ বাক্যে বাংলায় লিখবে। "keyQuote"-এ লেখাটির সবচেয়ে গুরুত্বপূর্ণ বাক্যটি হুবহু তুলে দেবে।

৩. "glossary" — লেখাটি থেকে ${glossaryWords}টি কঠিন/পারিভাষিক বাংলা শব্দ বা প্রশাসনিক পরিভাষা। প্রতিটির জন্য: "word" (শব্দ), "bn" (সহজ বাংলা ব্যাখ্যা), "en" (ইংরেজি প্রতিশব্দ), "pos" (পদ), "fromArticle" (লেখার যে বাক্যে শব্দটি আছে সেটি হুবহু), "example" (তোমার লেখা নতুন উদাহরণ বাক্য)।`;
}

/** One chunk of the BCS Written translation question, done a few paragraphs at a time. */
export function translationPrompt({ text, toBengali, part, parts }) {
  const scope = parts > 1 ? ` (অংশ ${part}/${parts} — শুধু এই অংশটুকুই অনুবাদ করো)` : '';
  return toBengali
    ? `${PERSONA}

নিচের ইংরেজি অংশটির সম্পূর্ণ ও বিশ্বস্ত বাংলা অনুবাদ করো${scope}। ভাষা হবে প্রমিত ও গাম্ভীর্যপূর্ণ — বিসিএস লিখিত পরীক্ষার Translation প্রশ্নে যেমন প্রত্যাশিত। সারসংক্ষেপ করবে না, কোনো অনুচ্ছেদ বাদ দেবে না, নিজের মন্তব্য যোগ করবে না। অনুচ্ছেদগুলো আলাদা রাখো।

"""
${text}
"""

JSON আকারে উত্তর দাও: {"translation": "…"}`
    : `${PERSONA}

Translate the Bengali passage below into polished English${scope}, to the standard expected in the BCS Written translation question. Do not summarise, skip paragraphs, or add commentary. Keep the paragraph breaks.

"""
${text}
"""

Reply as JSON: {"translation": "…"}`;
}

/**
 * A batch of BCS Written answers.
 *
 * The answers are the part students actually study from, so they are generated
 * a couple at a time: it keeps each request inside the token ceiling and means
 * one failed batch costs two answers rather than all five.
 */
export function qnaPrompt({ article, qnaCount, askedQuestions = [], withTips }) {
  const avoid = askedQuestions.length
    ? `\nএই প্রশ্নগুলো ইতিমধ্যে করা হয়েছে, এগুলোর পুনরাবৃত্তি করবে না:\n${askedQuestions.map((q) => `- ${q}`).join('\n')}\n`
    : '';
  const tips = withTips
    ? '\nসেই সঙ্গে "examTips"-এ ৩-৪ লাইনে বলবে এই লেখাটি বিসিএস লিখিত পরীক্ষায় (রচনা, সারমর্ম, অনুবাদ, ভাইভা) কীভাবে কাজে লাগবে।'
    : '\n"examTips" ফাঁকা অ্যারে হিসেবে দেবে।';

  return `${PERSONA}

নিচে ${article.source}-এ প্রকাশিত একটি লেখা দেওয়া হলো। এর উপর ভিত্তি করে ঠিক ${qnaCount}টি বিসিএস লিখিত পরীক্ষার মানের প্রশ্নোত্তর তৈরি করো। প্রশ্ন ও উত্তর — দুটোই বাংলায়।

শিরোনাম: ${article.title}
লেখা:
"""
${article.content}
"""
${avoid}
${ANSWER_RULES}

পাশাপাশি প্রতিটি প্রশ্নোত্তরের "keyPoints"-এ ৪-৫টি সংক্ষিপ্ত বাংলা পয়েন্ট দেবে দ্রুত রিভিশনের জন্য।${tips}`;
}

/**
 * Rewrite one answer that came back too short.
 *
 * Asking for a longer version of a specific answer works far better than
 * re-rolling the whole batch: the model can see exactly what it produced and
 * what is missing, instead of being told once more to write at length.
 */
export function expandAnswerPrompt({ article, question, answer }) {
  return `${PERSONA}

নিচের প্রশ্নের উত্তরটি বিসিএস লিখিত পরীক্ষার জন্য অত্যন্ত সংক্ষিপ্ত হয়ে গেছে। একই প্রশ্নের একটি সম্পূর্ণ, বিস্তারিত উত্তর নতুন করে লেখো।

প্রশ্ন: ${question}

বর্তমান (অপর্যাপ্ত) উত্তর:
"""
${answer}
"""

সহায়ক লেখা (${article.source}):
"""
${article.content}
"""

${ANSWER_RULES}

বিশেষভাবে খেয়াল রাখো — উত্তরটি অবশ্যই ২২০ শব্দের বেশি হতে হবে। ছয়টি অংশের প্রতিটিতে যথেষ্ট বিশ্লেষণ, পরিসংখ্যান ও উদাহরণ যোগ করো। কেবল আগের উত্তরটি ঘুরিয়ে লিখো না — নতুন তথ্য ও যুক্তি যোগ করো।

JSON আকারে উত্তর দাও: {"a": "…"}`;
}

/** Sentence-by-sentence grammar dissection, precomputed so the app needs no API. */
export function sentenceBatchPrompt({ sentences, startIndex }) {
  const listed = sentences.map((s, i) => `${startIndex + i}. ${s}`).join('\n');
  return `${PERSONA}

For each numbered English sentence below, produce the "Sentence DNA" a BCS candidate needs. Return JSON matching the schema, one object per sentence, reusing the SAME index number given here.

Fields:
- "bn": a sophisticated, contextual Bengali translation of the sentence (not word-for-word).
- "sentenceType": Simple / Complex / Compound / Compound-Complex, followed by a short Bengali reason.
- "voice": Active or Passive, with a short Bengali note on the structure.
- "tense": the operative tense and its Bengali name.
- "clauses": the principal and subordinate clauses / notable phrases named in Bengali with the English span quoted.
- "connectors": linkers, conjunctions or transition markers used, with their function in Bengali. Write the single word "নেই" when there are none — never dashes or repeated punctuation.

Sentences:
${listed}`;
}
