# content-translation.js

Handles the core translation exercise: checking user answers, AI-powered evaluation, Gemini validation override, subtitle display, and text-to-speech.

## Functions

### `handleNewSubtitle(text, segment)`
Called by `observeSubtitles()` in `content-subtitle.js` each time the video triggers a subtitle.

1. Sets `currentSubtitle = text`.
2. Replaces `#subtitle-display` with the subtitle text and a speak button.
3. If `settings.autoTranslate`, pauses the video after `pauseDelay` seconds (skips if ad is playing).
4. Clears the input field and sets placeholder to "Type your translation...".
5. Calls `updatePauseStatus('Review & Translate')`.

---

### `checkTranslation()`
Called when the user submits their answer (button click or Enter key).

1. Reads the input value; no-ops if empty or no `currentSubtitle`.
2. Calls `translateText(currentSubtitle, targetLang, nativeLang)` to get the reference translation.
3. Calls `evaluateTranslationWithAI()` to score the answer.
4. Calls `displayEvaluationResult()` with the evaluation.

---

### `evaluateTranslationWithAI(userAnswer, chromeTranslation, sourceText, sourceLang, targetLang)` → `Promise<evaluation>`
Attempts evaluation via `chromeAIBridge('generateContent', ...)` (Chrome AI Writer) with a structured prompt. Falls back to `fallbackSimilarityCheck()` if the bridge call fails.

The prompt asks the AI to evaluate meaning correctness (most important), minor spelling/grammar, natural phrasing, and valid alternate translations. Returns a JSON evaluation:
```js
{ correct: boolean, confidence: number, feedback: string, note: string }
```

---

### `displayEvaluationResult(evaluation, userInput, correctTranslation, sourceText)`
Renders feedback into `#fluentai-feedback`.

**On correct:**
- Shows success message + source→translation pair
- Calls `updateQuizStats(1, 1)`
- If `autoPlayAfterCorrect`: starts a 3-second countdown, then calls `skipSubtitle()` and resumes video

**On incorrect:**
- Shows error message + suggested translation
- If `geminiApiKey` is set, shows a "Verify with Gemini" button
- Calls `updateQuizStats(0, 1)`

---

### `verifyWithGemini(userInput, chromeTranslation, sourceText)`
Secondary validation path — shown only when Chrome AI marks the answer incorrect and a Gemini API key is set. Calls `validateWithGemini()`, then either marks the answer correct (with auto-play countdown) or confirms it incorrect.

---

### `validateWithGemini(userAnswer, chromeTranslation, sourceText, sourceLang, targetLang)` → `Promise<result>`
Sends a three-way comparison to `GEMINI_MODEL` (Chrome AI translation, student answer, source text). The model evaluates both the student's answer and Chrome AI's translation independently, returning:
```js
{
  correct: boolean,         // studentCorrect
  feedback: string,
  correctAnswer: string,    // bestTranslation
  chromeWasWrong: boolean,
  confidence: number
}
```
Handles markdown code fences in the response before JSON parsing.

---

### `translateWithGemini(text)` → `Promise<string|null>`
Direct translation of a single text string via `GEMINI_MODEL`. Returns the translation string or `null` on error. Used as a fallback when Chrome AI Translator is unavailable.

---

### `speakSubtitle(text)`
Uses the Web Speech API (`SpeechSynthesisUtterance`) to read `text` aloud in `settings.targetLanguage` at 0.8× rate. Shows in-panel notifications on start/error.

## Globals read

`currentSubtitle`, `settings`, `GEMINI_MODEL` (from `content-vocab.js`)

## Globals written

`currentSubtitle`

## Dependencies

`content-globals.js`, `content-bridge.js` (`chromeAIBridge`, `translateText`), `content-utils.js` (`parseAIResponse`, `fallbackSimilarityCheck`), `content-vocab.js` (`GEMINI_MODEL`), `content-quiz.js` (`updateQuizStats`)

Called by: `content-subtitle.js` (`observeSubtitles` → `handleNewSubtitle`), `content.js` (submit button, speak button)
