# content-quiz.js

Quiz UI, flashcard practice sessions, AI-generated quizzes, and the SM-2 spaced repetition algorithm.

## Constants

### `DAY_MS = 86400000` (`var`)
Milliseconds in one day. Used by `updateCardSRS` to compute `nextReview` timestamps.

## SM-2 Spaced Repetition

### `updateCardSRS(cardId, wasCorrect)` → `Promise<void>`
Updates a flashcard's SRS fields after a practice answer using a simplified SM-2 algorithm.

**Fields used:**
- `difficulty` — easiness factor (EF), starts at 2.5, minimum 1.3
- `lastInterval` — previous interval in days
- `reviewCount` — total number of times reviewed
- `nextReview` — `Date.now() + newInterval * DAY_MS`

**Algorithm:**

On incorrect answer:
- `newInterval = 1` (restart)
- `newEF = max(1.3, ef - 0.2)`

On correct answer (quality q=4):
- `newEF = max(1.3, ef + 0.1 - (5-q)(0.08 + (5-q)×0.02))` → ≈ ef + 0.1
- Interval: 1 day (1st review) → 6 days (2nd review) → `round(prevInterval × newEF)` (3rd+)

Called from `checkQuizAnswer()` and `checkTranslationAnswer()` when `question.cardId` is present.

## Practice session

### `startPracticeFromOverlay()`
Entry point for the "Practice Now" button. Loads all flashcards for `settings.targetLanguage`, sorts them most-overdue first using:
```js
sort((a, b) => (now - (b.nextReview || now)) - (now - (a.nextReview || now)))
```
Takes the top 10, shows a notification with how many are due vs. new, then calls `startFlashcardPractice()`.

---

### `startFlashcardPractice(flashcardsData)`
Filters cards to `settings.targetLanguage`, sets `quizMode = true`, shows `#quiz-overlay`, pauses the video, and calls `generateFlashcardQuiz()`.

---

### `generateFlashcardQuiz(flashcardsData)`
Shuffles cards, picks up to 5, builds multiple-choice questions with 3 random wrong answers. Each question object includes `cardId: card.id` so SRS can be updated after the answer.

## AI-generated quiz

### `startQuiz()`
Opens the quiz overlay and calls `generateQuiz()`.

---

### `generateQuiz()`
Tries to generate quiz questions in priority order:
1. Chrome AI Writer — free-form generation from current subtitle or flashcard context
2. Gemini API (`generateGeminiQuiz()`)
3. `generateFallbackQuiz()` — local flashcard multiple-choice + fill-in-the-blank from current subtitle

---

### `generateGeminiQuiz()` → `Promise<array>`
Sends the current subtitle or flashcard context to `GEMINI_MODEL` and parses a JSON array of question objects. Falls back to `generateFallbackQuiz()` on error.

---

### `generateFallbackQuiz()` → `array`
Builds up to 2 questions locally with no API calls:
- One multiple-choice from a random flashcard (requires ≥ 4 cards)
- One fill-in-the-blank from `currentSubtitle` (requires ≥ 3 words)

## Quiz display

### `displayQuiz(questions)` / `displayQuestion(index)`
Renders questions. Supports three question types:
- `multiple-choice` — 4 buttons
- `fill-blank` — text input
- `translation` — text input, verified against Chrome AI Translator

---

### `checkQuizAnswer(answer)`
Compares against `question.correct`, increments `currentQuiz.score`, calls `updateCardSRS()` if `question.cardId` is set, then calls `proceedToNextQuestion()`.

---

### `proceedToNextQuestion()`
Advances the index after a 1.5 s delay, or calls `showQuizResults()` if all questions are done.

---

### `showQuizResults()`
Renders the score circle and per-question review, calls `updateQuizStats()`.

---

### `closeQuiz()`
Hides `#quiz-overlay` and resets `quizMode = false`.

## Stats

### `updateQuizStats(correct, total)`
Reads `chrome.storage.sync.stats`, increments totals, resets streak to 0 on any incorrect answers, writes back, and calls `updateStats()`.

### `updateStats()`
Reads stats from `chrome.storage.sync` and writes the values into the Stats tab DOM elements (`#correct-count`, `#incorrect-count`, `#streak-count`, `#accuracy`).

## Globals read

`flashcards`, `settings`, `quizMode`, `currentQuiz`, `currentSubtitle`, `chromeAIAvailable`

## Globals written

`quizMode`, `currentQuiz`

## Dependencies

`content-globals.js`, `content-utils.js` (`getLanguageName`), `content-bridge.js` (`chromeAIBridge`, `translateText`), `content-vocab.js` (`GEMINI_MODEL`), `flashcardDB` (`getFlashcardsByLanguage`, `getFlashcard`, `addFlashcard`)
