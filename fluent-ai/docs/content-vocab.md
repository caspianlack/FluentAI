# content-vocab.js

Extracts useful vocabulary from the loaded transcript, enriches each word with translations and usage notes, and presents a selection UI for adding words to flashcards.

## Constants

### `GEMINI_MODEL = 'gemini-2.5-flash'` (`var`)
Used by every Gemini API call in this file **and referenced by `content-translation.js` and `content-quiz.js`**. Centralising it here means all Gemini calls in the extension target the same model version. Previously `content-translation.js` used `gemini-2.0-flash-exp`.

## Functions

### `extractAndShowVocabulary()`
Entry point — called when the user clicks "Extract Vocabulary from Video". Checks that transcript segments are loaded, shows a loading state in the vocabulary tab, then runs the two-step pipeline:
1. `extractVocabularyFromTranscript()` — get raw word list from Gemini
2. `validateAndEnrichVocabulary()` — get translations + validate each word
3. `showVocabularySelector()` — render the selection UI

---

### `extractVocabularyFromTranscript()` → `Promise<array>`
Sends the first 6000 chars of the loaded transcript to Gemini (`GEMINI_MODEL`) with a prompt requesting 20–30 vocabulary items in dictionary/root form, including part of speech, difficulty, and frequency. Returns an array of `{ word, partOfSpeech, difficulty, frequency }`. Shows an inline "API key required" UI if `settings.geminiApiKey` is not set.

---

### `validateAndEnrichVocabulary(vocabularyList)` → `Promise<array>`
For each word not already in `flashcards`, attempts translation and enrichment using a three-tier cascade:

1. **Chrome AI Translator** (`chromeAIBridge('translate', ...)`) — fast, on-device
2. **Chrome AI Writer** (`chromeAIBridge('generateContent', ...)`) — for alternate translations
3. **Gemini** (`GEMINI_MODEL`) — validates word form, provides up to 5 translations, usage note, example sentence, and confidence score

Words with 0 translations or confidence < 70 are dropped. Returns enriched word objects.

---

### `showVocabularySelector(validatedWords)`
Renders a checkable list of validated words in the vocabulary tab. Each item shows the word, confidence badge, part-of-speech badge, primary translation, alternates, description, and example sentence. "Add Selected" button bulk-inserts chosen words into IndexedDB with full SRS fields (`difficulty: 2.5`, `nextReview: Date.now()`, etc.).

---

### `generateSingleDescription(wordPair)` → `Promise<string>`
Generates a one-sentence usage explanation for a word. Tries Chrome AI Writer first, falls back to Gemini, falls back to a generic template.

---

### `translateWordSmart(word, sourceLang, targetLang)` → `Promise<{ translation, confidence, source }>`
Single-word translation with automatic fallback chain:
1. Chrome AI Translator
2. Chrome AI Writer (prompt-based)
3. Gemini direct translation

Returns `{ translation, confidence: number, source: string }`. On complete failure: `{ translation: word, confidence: 20, source: 'failed', error: true }`.

Used by `content-flashcards.js` for the Auto-Translate button in the add-card form.

---

### `isWordInFlashcards(word)` → `boolean`
Case-insensitive check against both `card.word` and `card.translations` in the in-memory `flashcards` array.

---

### `checkTranslatorReadiness(sourceLang, targetLang)` → `Promise<{ ready, status }>`
Calls `chromeAIBridge('checkTranslatorReady', ...)` to check if the language model pair is downloaded.

---

### `waitForTranslatorDownload(sourceLang, targetLang, onProgress)` → `Promise<boolean>`
Polls `checkTranslatorReadiness` every 1 s for up to 60 s. Calls `onProgress(percent)` while downloading. Returns `true` when ready, `false` on timeout.

## Globals read

`transcriptSegments`, `flashcards`, `settings`, `chromeAIAvailable`, `overlay`

## Globals written

`flashcards`

## Dependencies

`content-globals.js`, `content-utils.js` (`getLanguageName`), `content-bridge.js` (`chromeAIBridge`), `content-flashcards.js` (`updateIndexedDBStatus`, `loadFlashcardList`), `flashcardDB`
