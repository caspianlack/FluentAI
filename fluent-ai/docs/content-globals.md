# content-globals.js

**Must be loaded first.** Declares all shared mutable state as `var` so every other content script file can read and write it via the global object.

## Why `var`

Chrome content scripts in the same `js` array share one isolated world. `let`/`const` are file-scoped and invisible across files. `var` (and function declarations in non-strict mode) land on the shared global object, making them accessible everywhere.

## Global variables

| Variable | Type | Initial value | Purpose |
|---|---|---|---|
| `overlay` | `Element \| null` | `null` | The `#fluentai-overlay` DOM node. Set by `createOverlay()` in content.js. |
| `isEnabled` | `boolean` | `true` | Master on/off switch (unused beyond declaration; `settings.autoTranslate` controls pause behaviour). |
| `settings` | `object` | `{}` | Populated by `loadSettings()`. Keys: `nativeLanguage`, `targetLanguage`, `autoTranslate`, `geminiApiKey`, `quizFrequency`, `notificationEnabled`, `pauseDelay`, `useGeminiValidation`, `autoPlayAfterCorrect`. |
| `currentSubtitle` | `string` | `''` | The subtitle text currently displayed to the user for translation. Set by `handleNewSubtitle()`. |
| `chromeAIAvailable` | `object` | all `false` | Tracks which Chrome AI APIs are ready: `{ translator, languageDetector, summarizer, writer }`. Updated by `initializeChromeAI()`. |
| `quizMode` | `boolean` | `false` | `true` while a quiz overlay is open. Prevents subtitle auto-pause during quiz. |
| `currentQuiz` | `object \| null` | `null` | Active quiz state: `{ questions, currentIndex, score, answers }`. |
| `flashcards` | `array` | `[]` | In-memory cache of flashcards for `settings.targetLanguage`. Kept in sync with IndexedDB after every write. |
| `transcriptSegments` | `array` | `[]` | Loaded transcript: `[{ text, start, end, duration }]`. Populated by `initializeTranscript()`. |
| `videoTimeUpdateInterval` | `number \| null` | `null` | `setInterval` handle for the subtitle observation loop. Cleared and reset by `observeSubtitles()`. |
| `isInitializingTranscript` | `boolean` | `false` | Guard flag preventing concurrent `initializeTranscript()` calls. Always reset in a `finally` block. |
| `segmentsProcessed` | `Set` | `new Set()` | Tracks `segment.start` values already triggered this playback pass. Cleared on video seek. |
| `lastProcessedSegment` | `object \| null` | `null` | The most recently triggered segment. Used to detect video seeks (reset `segmentsProcessed`). |

## Dependencies

None. This file has no imports and calls no functions.
