# content-flashcards.js

Flashcard CRUD UI: add, edit, delete, search, import/export, and the main list view. All operations persist to IndexedDB via `flashcardDB` and keep the in-memory `flashcards` global in sync.

## Functions

### `loadFlashcardList()`
Completely re-renders the `#vocabulary-tab` DOM with the current flashcard list for `settings.targetLanguage`. Wires up all button listeners inline. Called after every write operation to keep the view in sync.

---

### `showAddCardModal()`
Replaces the vocabulary tab content with an add-card form. Fields: word (target language), translations (comma-separated), optional description. Includes an **Auto-Translate** button that calls `translateWordSmart()`.

---

### `saveNewCard()`
Reads the add-card form, splits translations on commas, and calls `flashcardDB.addFlashcard()`. On success reloads the list and updates the IndexedDB status indicator.

---

### `autoTranslateNewCard()`
Called from the add-card form. Reads the word input, calls `translateWordSmart(word, targetLang, nativeLang)`, and fills the translation field.

---

### `showEditCardModal(card)`
Replaces the vocabulary tab content with an edit form pre-populated from the card object.

---

### `saveEditedCard(cardId)`
Reads the edit form and calls `flashcardDB.addFlashcard({ ...existingCard, word, translations, description })`. Uses spread to preserve all other fields (SRS data, etc.).

---

### `showDeleteConfirmation(card)`
Shows a confirmation modal before deleting. On confirm, calls `flashcardDB.deleteFlashcard(card.id)` and reloads the list.

---

### `searchFlashcards(event)`
Filters the visible `.flashcard-item` elements by matching `.flashcard-word` and `.flashcard-translation` text against the search input value (case-insensitive). No DB round-trip — operates on the existing DOM.

---

### `exportFlashcards()`
Calls `flashcardDB.getAllFlashcards()`, serializes to JSON, and triggers a `<a download>` click for a `.json` file.

---

### `importFlashcards()`
Opens a file picker, reads the selected `.json` file, and calls `flashcardDB.addFlashcards(importedCards)`. Reloads the list on success.

---

### `addToFlashcards(word, translation)`
Single-card convenience function used by other modules (e.g. vocabulary extraction fallback). Calls `flashcardDB.addFlashcard()` with default SRS fields (`reviewCount: 0`, `nextReview: Date.now()`, `difficulty: 0`).

---

### `updateIndexedDBStatus()`
Calls `flashcardDB.getStats(targetLanguage)` and updates `#indexeddb-status` and `#flashcard-count` in the Status tab.

---

### `createFlashcardsFromVocab()`
Legacy stub. Redirects users to use "Extract Vocabulary from Video" instead.

## Flashcard object shape

```js
{
  id: number,                  // assigned by IndexedDB
  word: string,                // target language word
  language: string,            // BCP-47 target language code
  originLanguage: string,      // same as language
  targetLanguage: string,      // native language code
  translations: string[],      // one or more native-language translations
  senses: [],
  description: string,
  meta: { source: string[], confidence: number },
  addedDate: number,           // Date.now()
  reviewCount: number,
  correctCount: number,
  lastReviewed: number | null,
  nextReview: number,          // Date.now() for new cards; SRS-scheduled for reviewed cards
  difficulty: number,          // SM-2 easiness factor (default 2.5)
  lastInterval: number,        // days of last SRS interval
  sets: []
}
```

## Globals read

`settings`, `flashcards`

## Globals written

`flashcards`

## Dependencies

`content-globals.js`, `content-utils.js` (`getLanguageName`), `content-vocab.js` (`translateWordSmart`), `flashcardDB`
