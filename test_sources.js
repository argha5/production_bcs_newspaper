import fs from 'fs';
import { collectArticles } from './src/sources.js';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Dhaka' });

console.log(`--- Testing English Article Sourcing for Target Date (${todayStr}) ---`);
const enArticles = await collectArticles({
  feeds: config.feeds,
  lang: 'en',
  want: config.englishPerDay,
  minWords: config.minArticleWordsEn,
  maxAgeDays: config.maxArticleAgeDays,
  targetDate: todayStr,
});
console.log(`Successfully fetched ${enArticles.length} English articles:`);
enArticles.forEach((a, i) => {
  console.log(`  [${i+1}] Source: "${a.source}" | Title: "${a.title}" | Published: "${a.published}"`);
});

console.log(`\n--- Testing Bengali Article Sourcing for Target Date (${todayStr}) ---`);
const bnArticles = await collectArticles({
  feeds: config.feeds,
  lang: 'bn',
  want: config.bengaliPerDay,
  minWords: config.minArticleWordsBn,
  maxAgeDays: config.maxArticleAgeDays,
  targetDate: todayStr,
});
console.log(`Successfully fetched ${bnArticles.length} Bengali articles:`);
bnArticles.forEach((a, i) => {
  console.log(`  [${i+1}] Source: "${a.source}" | Title: "${a.title}" | Published: "${a.published}"`);
});

