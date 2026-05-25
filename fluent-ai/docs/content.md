# content.js

Orchestration layer. Owns the overlay HTML, event wiring, settings loading, and the `init()` entry point. All substantive logic lives in the other modules — this file calls into them.

## Functions

### `loadSettings()`
Reads settings from `chrome.storage.sync` into the `settings` global, loads `flashcards` from IndexedDB for `settings.targetLanguage`, and calls `initializeChromeAI()`.

---

### `createOverlay()`
Creates the `#fluentai-overlay` DOM node and appends it to `document.body`. Idempotent — returns immediately if `overlay` is already set.

**Overlay structure:**
- `#side-panel` — the main side panel with tabs
  - `#translate-tab` — subtitle display, translation input, feedback
  - `#vocabulary-tab` — flashcard list (rendered by `loadFlashcardList()`)
  - `#stats-tab` — correct/incorrect/streak/accuracy counters + "Start Quiz" button
  - `#status-tab` — Chrome AI API status indicators + IndexedDB status
- `#collapsed-panel` — the minimised expand button (hidden by default)
- `#quiz-overlay` — the centre-screen quiz modal (hidden by default)

After appending, calls `setupEventListeners()`, `updateStats()`, and `updateIndexedDBStatus()`.

---

### `setupEventListeners()`
Wires all static UI events:
- Tab navigation (`.tab-btn` clicks → `switchTab()`)
- `#collapse-btn` / `#expand-btn` → `collapsePanel()` / `expandPanel()`
- `#toggle-btn` → `togglePause()`
- `#fluentai-submit` + Enter key → `checkTranslation()`
- `#skip-btn` → `skipSubtitle()`
- `#speak-btn` → `speakSubtitle(currentSubtitle)`
- `#extract-vocab-btn` → `extractAndShowVocabulary()`
- `#start-quiz-btn` → `startQuiz()`
- `#quiz-close-btn` → `closeQuiz()`
- `#refresh-status-btn` → re-runs `initializeChromeAI()`, `updateAPIStatusDisplay()`, `updateIndexedDBStatus()`
- `#add-new-card-btn` → `showAddCardModal()`
- `#practice-now-btn` → `startPracticeFromOverlay()`
- `#export-flashcards-btn` → `exportFlashcards()`
- `#import-flashcards-btn` → `importFlashcards()`
- `#flashcard-search` → `searchFlashcards()`
- Calls `loadFlashcardList()` to populate the vocabulary tab

---

### `switchTab(tabName)`
Toggles `.active` on `.tab-btn` elements and sets `display` on `.tab-content` elements. The vocabulary, stats, and status tabs use `display: none` as their default.

---

### `collapsePanel()` / `expandPanel()`
Toggle `display` between `#side-panel` and `#collapsed-panel`.

---

### `togglePause()`
Flips `settings.autoTranslate`, persists to `chrome.storage.sync`, updates the toggle button text.

---

### `skipSubtitle()`
Clears `currentSubtitle`, resets the input and feedback areas, and calls `video.play()`.

---

### `updatePauseStatus(status)`
Updates the text of `#pause-status` if it exists.

---

### `showNotification(message, type)`
Appends (or reuses) a `.fluentai-notification` element, sets its class and text, adds `.show`, and removes it after 3 s.

---

### `sendPracticeNotification()`
Picks a random card from the in-memory `flashcards` array and sends a `showNotification` message to `background.js` to display a Chrome notification.

---

### `addTranscriptButton()`
Appends a "Load Subtitles" button below the translate exercise area. Clicking it calls `initializeTranscript()` and updates the button state.

---

### `init()`
Extension entry point. Runs once on page load:
1. `injectPageScript()` — inject Chrome AI bridge into page main world
2. `flashcardDB.waitForReady()` — wait for IndexedDB
3. `loadSettings()` — load settings + flashcards + init Chrome AI
4. `createOverlay()` — build the UI
5. `addTranscriptButton()` — add the load button
6. `updateAPIStatusDisplay()` — populate Status tab
7. After 3 s: `initializeTranscript()` if `isEnabled`
8. If notifications enabled: `setInterval(sendPracticeNotification, quizFrequency * 60 * 1000)`

Called by `DOMContentLoaded` or immediately if `document.readyState !== 'loading'`.

## Message listener

Handles two messages from `background.js` and the popup:
- `startFlashcardPractice` — calls `startFlashcardPractice(request.flashcards)`
- `settingsUpdated` — calls `loadSettings()` then `initializeChromeAI()` + `updateAPIStatusDisplay()`

## Globals read / written

Reads and writes `settings`, `overlay`, `currentSubtitle`, `flashcards`, `isEnabled`.

## Dependencies

All other content script modules must be loaded before this file.
