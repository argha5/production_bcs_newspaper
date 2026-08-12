# 📰 BCS Editorial Master – BCS এর জন্য পত্রিকা পড়ার স্মার্ট উপায়

[![Download on Google Play](https://img.shields.io/badge/Download-Google%20Play-green?style=for-the-badge&logo=googleplay)](https://play.google.com/store/apps/details?id=dev.bcs.written)
[![GitHub Actions Daily Edition](https://github.com/argha5/bcsnewspaperapi/actions/workflows/daily.yml/badge.svg)](https://github.com/argha5/bcsnewspaperapi/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **BCS Editorial Master** হলো BCS Written, Bank Job, এবং অন্যান্য প্রতিযোগিতামূলক পরীক্ষার পরীক্ষার্থীদের জন্য দৈনিক পত্রিকা (Bangla & English Newspaper Editorials) অ্যানালাইসিস এবং ফ্রি স্ট্যাটিক JSON ব্যাকএন্ড। 



---

## 🎯 BCS এর জন্য পত্রিকা পড়ার স্মার্ট উপায় কেন?

দৈনিক পত্রিকা পড়া BCS লিখিত (BCS Written) এবং অনুবাদ (Translation) অংশের জন্য অত্যন্ত জরুরি। কিন্তু ঘণ্টার পর ঘণ্টা পত্রিকা পড়ে সময় নষ্ট না করে, **BCS Editorial Master** অ্যাপের মাধ্যমে আপনি পাচ্ছেন:

* 📄 **দৈনিক সেরা এডিটোরিয়াল (Editorial Breakdown):** প্রথম আলো, The Daily Star ইত্যাদি শীর্ষ দৈনিক পত্রিকার বাছাইকৃত সম্পাদকীয়।
* 🌐 **শব্দানুবাদ ও ব্যাকরণ বিচ্ছেদ (Grammar Dissection):** Sentence-by-sentence অনুবাদ, Tense, Voice, Clause বিচ্ছেদ এবং Glossary।
* 📝 **BCS Written মানসম্মত উত্তর (220–320 Words Q&A):** ভূমিকা ➔ প্রেক্ষাপট ➔ বিশ্লেষণ ➔ চ্যালেঞ্জ ➔ সুপারিশ ➔ উপসংহার ফরম্যাটে লিখিত পরীক্ষার প্রশ্নোত্তর।
* ⚡ **১০০% অফলাইন সুবিধা:** প্রতিদিন মাত্র একটি JSON ফাইল ডাউনলোড করে সারাদিন অফলাইনে ফ্রি পড়ার সুবিধা।

---

## 🏗️ How It Works (Backend Architecture)

This repository serves as a **zero-cost static JSON API backend** for the **BCS Editorial Master** mobile app. 

The **Groq AI Engine** is triggered **only inside GitHub Actions** — once every day (07:20 Dhaka Time). The Flutter app requires no API key and makes zero runtime model calls; it simply downloads the precomputed static JSON committed by this repo.

GitHub Actions (Daily 07:20 Dhaka)
│
├─ src/sources.js → Newspaper RSS Feeds + HTML Content Extraction (0 API Calls)
│
├─ src/build.js   → Groq (JSON Schema) → Editorial Breakdown & Glossary
│                 → Groq (JSON Schema) → BCS Written Long Essay Answers
│                 → Groq (JSON Schema) → Sentence Grammar Dissection (English)
│
├─ data/YYYY-MM-DD.json   → Complete day's analyzed editorials in 1 file
└─ data/index.json        → Manifest of last 7 editions + SHA-256 hashes


### 📰 Why Articles Come From Real Newspaper RSS Feeds
Titles, URLs, and publication dates are directly fetched from official newspaper feeds (`config.json`), ensuring **100% real journalism, zero AI hallucinations**. Non-exam topics (sports, entertainment, crime) are filtered out, while opinion/editorial columns score highest.

### ⚡ Token & API Rate Limit Management
To stay comfortably inside Groq’s Free Tier (8,000 TPM / 200,000 TPD):
1. **Request Chunking:** Articles are analyzed across segmented calls (breakdown, paragraph-wise translation, and Q&A).
2. **Multi-Model Routing:** Quality-critical tasks use high-capacity models (`gpt-oss-120b`), while mechanical parsing uses lighter models (`gpt-oss-20b`). Multi-key lane rotation tracks token ceilings in real-time.

---

## 🔗 Endpoints (Raw GitHub API)

| Resource | Direct URL |
|---|---|
| **Manifest (Last 7 Days)** | `https://raw.githubusercontent.com/argha5/bcsnewspaperapi/main/data/index.json` |
| **Daily Edition Example** | `https://raw.githubusercontent.com/argha5/bcsnewspaperapi/main/data/2026-07-26.json` |

---

## 🔒 Security & Verification (Edition Hash)

Every edition carries a unique `editionHash` (SHA-256 over `{date, articles}` truncated to 24 hex characters). 
- `index.json` broadcasts each day's valid hash.
- The app checks the hash against the manifest before rendering.
- Prevents corrupt, partial, or modified files from reaching users offline.

---

## 📊 Data Schema Overview

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
      "lang": "bn",
      "topic": "অর্থ-বাণিজ্য ও মূল্যস্ফীতি",
      "title": "…", 
      "source": "প্রথম আলো", 
      "url": "https://…", 
      "published": "…",
      "content": "Full article content...",
      "sentences": [
        { "i": 0, "text": "…", "bn": "…", "type": "Complex", "voice": "Active", "tense": "Present Perfect", "clauses": "…", "connectors": "…" }
      ],
      "glossary": [
        { "word": "mitigate", "bn": "প্রশমিত করা", "pos": "Verb", "synonyms": "…", "antonyms": "…" }
      ],
      "breakdown": { "mainTopic": "…", "problem": "…", "cause": "…", "effect": "…", "solution": "…", "conclusion": "…" },
      "translationBn": "…",
      "translationEn": "…",
      "qna": [ { "q": "…", "a": "…", "keyPoints": ["…"], "words": 247 } ],
      "examTips": ["…"]
    }
  ]
}
🛠️ Local Development & Setup
Prerequisites & API Setup
Fork / Clone the repository.

Go to Settings → Secrets and variables → Actions → New repository secret.

Add GROQ_API_KEY with your API key.

Commands
Bash
# Install dependencies
npm install

# Build today's edition (skips if already built)
npm run build

# Force rebuild today's edition
npm run build:force

# Build specific date
node src/build.js --date 2026-07-25

# Validate index integrity & hashes
npm run validate
📲 Download Official App
BCS Written & Editorial Preparation App:

👉 Google Play Store: https://play.google.com/store/apps/details?id=dev.bcs.written

🏷️ Search Index & Keywords (For Crawlers)
BCS এর জন্য পত্রিকা পড়ার স্মার্ট উপায় BCS Newspaper Editorial Analysis BCS Written English Preparation Bangla Newspaper Editorial Translation BCS Exam Preparation App BCS Editorial Master Free App Bank Job Written Editorial BCS Daily Editorial PDF & JSON


---

### SEO বৃদ্ধির জন্য করণীয় ৩টি টিপস:
1. **GitHub Repo Settings:** আপনার GitHub রিপোজিটরির **About** সেকশনে (ডানপাশে Settings এডিট করে):
   - **Description:** `BCS এর জন্য পত্রিকা পড়ার স্মার্ট উপায় | BCS Editorial Master Official App & Static API`
   - **Website:** `[https://play.google.com/store/apps/details?id=dev.bcs.written](https://play.google.com/store/apps/details?id=dev.bcs.written)`
   - **Topics:** `bcs-preparation`, `bcs-written`, `bcs-newspaper`, `bangla-editorial`, `bcs-english-translation` যুক্ত করুন।
2. **Google Search Console / Backlink:** এই GitHub রিপোর লিংক এবং Play Store লিংকটি আপনার সোশ্যাল মিডিয়া, ফেসবুক পেজ বা গ্রুপ পোস্টের ক্যাপশনে শেয়ার করুন। এতে Google crawlers দ্রুত আপনার Play Store লিংককে "BCS এর জন্য পত্রিকা পড়ার স্মার্ট উপায়" কিওয়ার্ডের সাথে সম্পর্কযুক্ত করবে।
