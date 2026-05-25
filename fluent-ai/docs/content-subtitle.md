# content-subtitle.js

Handles everything related to loading YouTube transcripts and triggering translation exercises as the video plays.

## Functions

### `injectPageScript()`
Creates a `<script src="injected.js">` element and appends it to the page head, injecting `injected.js` into the main world. The script tag removes itself after load. Called once at the top of `init()`.

---

### `initializeTranscript()` → `Promise<boolean>`
Orchestrates the full transcript load sequence. Returns `true` on success, `false` if cancelled or failed.

Steps:
1. Guard against concurrent calls via `isInitializingTranscript` (always reset in `finally`).
2. `openTranscriptPanel()` — clicks the YouTube "Show transcript" button and waits for `ytd-transcript-segment-renderer` elements to appear.
3. `extractTranscriptFromDOM()` — reads all segment elements into `transcriptSegments`.
4. `detectTranscriptLanguage()` — uses `chromeAIBridge('detectLanguage', ...)` on the first ~1000 chars of transcript.
5. If detected language ≠ `settings.targetLanguage`, shows `handleLanguageMismatch()` modal.
6. Calls `observeSubtitles()` to start the playback loop.

---

### `extractTranscriptFromDOM()` → `Promise<array>`
Queries `ytd-transcript-segment-renderer` elements and returns an array of:
```js
{ text: string, start: number, end: number, duration: number }
```
`end` is derived from the next segment's start time, or estimated as `start + max(2, wordCount * 0.5)` for the last segment.

---

### `openTranscriptPanel()` → `Promise<void>`
Finds the YouTube transcript button using three strategies (CSS selector → aria-label → text content scan) and clicks it. Polls every 500 ms for up to 10 s for segments to appear before resolving or rejecting.

---

### `observeSubtitles()`
Starts a `setInterval` at 100 ms that watches `video.currentTime`. For each tick:
- Skips if `autoTranslate` is off, `quizMode` is active, video is paused, or an ad is playing.
- Finds a segment whose `end + pauseDelay` falls within the current 200 ms window and hasn't been processed yet.
- Pauses the video and calls `handleNewSubtitle(text, segment)`.
- Detects video seeks by checking if `currentTime < lastProcessedSegment.start`, which clears `segmentsProcessed`.

---

### `detectTranscriptLanguage()` → `Promise<string|null>`
Samples the first 5 transcript segments (up to 1000 chars) and calls `chromeAIBridge('detectLanguage', ...)`. Returns the BCP-47 code if confidence ≥ 0.9, otherwise `null`. Returns `null` if `languageDetector` is unavailable.

---

### `handleLanguageMismatch(detectedLanguage)` → `Promise<boolean>`
Shows a modal with three options:
- **Switch to detected language** — updates `settings.targetLanguage` and `chrome.storage.sync`, reloads `flashcards`.
- **Keep current language** — proceeds with existing settings.
- **Cancel** — aborts transcript loading (returns `false`).

Returns `true` to continue, `false` to abort.

---

### `isAdPlaying()` → `boolean`
Checks whether the YouTube player element has the `ad-showing` CSS class.

## Globals read

`settings`, `quizMode`, `transcriptSegments`, `videoTimeUpdateInterval`, `isInitializingTranscript`, `segmentsProcessed`, `lastProcessedSegment`, `chromeAIAvailable`, `flashcards`

## Globals written

`transcriptSegments`, `videoTimeUpdateInterval`, `isInitializingTranscript`, `segmentsProcessed`, `lastProcessedSegment`, `settings`, `flashcards`

## Dependencies

`content-globals.js`, `content-utils.js` (`parseTimestamp`, `getLanguageName`), `content-bridge.js` (`chromeAIBridge`), `flashcardDB` (`getFlashcardsByLanguage`)

Called by: `content.js` (`init`, `addTranscriptButton` click handler)
Calls into: `handleNewSubtitle` (defined in `content-translation.js`), `showNotification` (defined in `content.js`)
