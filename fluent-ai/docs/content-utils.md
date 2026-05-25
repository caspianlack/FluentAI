# content-utils.js

Pure utility functions. No DOM access, no globals read or written, no async calls. Safe to call from any module.

## Constants

| Name | Value | Purpose |
|---|---|---|
| `STOP_WORDS` | `Set<string>` | Common words filtered out during vocabulary extraction (articles, conjunctions, etc.) |

## Functions

### `getLanguageName(code)`
Returns a human-readable language name for a BCP-47 code.

```js
getLanguageName('fr') // → 'French'
getLanguageName('ja') // → 'Japanese'
```

Supported codes: `en`, `es`, `fr`, `de`, `it`, `pt`, `ja`, `ko`, `zh`, `ru`, `ar`, `hi`. Falls back to the code itself for unknown values.

---

### `parseTimestamp(timeStr)`
Converts a YouTube transcript timestamp string to seconds.

```js
parseTimestamp('1:23')    // → 83
parseTimestamp('1:23:45') // → 5025
```

Returns `null` on parse failure.

---

### `cleanWord(word)`
Strips punctuation and lowercases a word for normalization.

---

### `isValidWord(word)`
Returns `true` if the word is worth adding as a flashcard: length 2–30, no digits, not in `STOP_WORDS`.

---

### `levenshteinDistance(a, b)`
Classic dynamic-programming edit distance between two strings.

---

### `calculateSimilarity(a, b)`
Normalized similarity in `[0, 1]` based on Levenshtein distance.

```js
calculateSimilarity('hello', 'helo') // → ~0.8
```

---

### `calculateWordSimilarity(userWords, correctWords)`
Word-level Jaccard similarity between two token arrays.

---

### `calculateEnhancedSimilarity(userAnswer, correctAnswer)`
Combines character-level and word-level similarity with a bonus for exact matches after normalization. Returns `[0, 1]`.

Used by `fallbackSimilarityCheck()` as the primary heuristic when AI validation is unavailable.

---

### `parseAIResponse(content)`
Extracts and parses JSON from an AI response string. Handles markdown code fences (` ```json ` / ` ``` `). Returns a safe default object `{ correct: false, confidence: 0, feedback: '...', note: '' }` on failure.

---

### `fallbackSimilarityCheck(userAnswer, correctAnswer)`
Calls `calculateEnhancedSimilarity` and returns an evaluation object compatible with `displayEvaluationResult`:

```js
{
  correct: boolean,   // similarity >= 0.75
  confidence: number, // similarity * 100
  feedback: string,
  note: string
}
```

## Dependencies

None.
