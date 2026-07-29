// JSON schemas passed to Groq so every analysis call returns strict, parseable
// JSON in exactly the shape the Flutter app expects.
//
// Study and Q&A are deliberately separate schemas: a full Bengali translation
// plus five 300-word Bengali answers does not fit in one response, and a
// truncated response costs the same quota as a complete one.

const str = { type: 'string' };

/**
 * Strict structured output requires every property to be listed in `required`
 * and `additionalProperties: false`. Building objects through this helper keeps
 * the schemas readable and makes it impossible to forget either rule.
 */
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const arr = (items) => ({ type: 'array', items });

const breakdown = obj({
  mainTopic: str,
  problem: str,
  cause: str,
  effect: str,
  solution: str,
  conclusion: str,
  keyQuote: str,
});

export const translationSchema = obj({ translation: str });

/** One rewritten answer, for the expand-a-short-answer pass. */
export const singleAnswerSchema = obj({ a: str });

/** English article: reverse-engineering and word anatomy. */
export const englishStudySchema = obj({
  topic: str,
  breakdown,
  glossary: arr(obj({
    word: str,
    bn: str,
    pos: str,
    nounForm: str,
    verbForm: str,
    adjectiveForm: str,
    adverbForm: str,
    synonyms: str,
    antonyms: str,
    fromArticle: str,
    example: str,
  })),
});

/** Bengali article: same idea, for a Bengali source text. */
export const bengaliStudySchema = obj({
  topic: str,
  breakdown,
  glossary: arr(obj({
    word: str,
    bn: str,
    pos: str,
    en: str,
    fromArticle: str,
    example: str,
  })),
});

/** The BCS Written answers — the same for both languages. */
export const qnaSchema = obj({
  qna: arr(obj({
    q: str,
    a: str,
    keyPoints: arr(str),
  })),
  examTips: arr(str),
});

export const sentenceBatchSchema = obj({
  sentences: arr(obj({
    index: { type: 'integer' },
    bn: str,
    sentenceType: str,
    voice: str,
    tense: str,
    clauses: str,
    connectors: str,
  })),
});
