import fs from 'fs';
import path from 'path';

import { collectArticles } from './src/sources.js';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

console.log('--- Testing English Article Sourcing ---');
console.log('Feeds configured for English:', config.feeds.filter(f => f.lang === 'en'));

try {
  const articles = await collectArticles({
    feeds: config.feeds,
    lang: 'en',
    want: config.englishPerDay,
    minWords: config.minArticleWordsEn,
    maxAgeDays: config.maxArticleAgeDays,
    maxTokens: config.maxArticleTokens,
  });

  console.log(`\nSuccessfully fetched ${articles.length} English articles:`);
  articles.forEach((a, i) => {
    console.log(`  [${i+1}] Source: "${a.source}" | Title: "${a.title}" | Content Length: ${a.content.length}`);
  });
} catch (err) {
  console.error('Error during collectArticles:', err);
}
