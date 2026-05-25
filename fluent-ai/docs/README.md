# FluentAI Content Script Architecture

The YouTube-facing logic is split across 9 module files plus `flashcardDB.js`. Chrome loads them as a flat list of content scripts — they share one isolated world, so all cross-module communication goes through **global `var` declarations** in `content-globals.js`.

## Load order (manifest.json)

```
flashcardDB.js          ← IndexedDB wrapper, no globals needed
content-globals.js      ← shared var state (must be first)
content-utils.js        ← pure helpers, no DOM or globals
content-bridge.js       ← Chrome AI postMessage bridge
content-subtitle.js     ← transcript extraction + subtitle loop
content-flashcards.js   ← flashcard CRUD UI
content-vocab.js        ← vocabulary extraction (defines GEMINI_MODEL)
content-quiz.js         ← quiz logic + SM-2 SRS (defines DAY_MS)
content-translation.js  ← translation checking + Gemini validation
content.js              ← overlay HTML, event wiring, init()
```

## Module index

| File | Purpose |
|---|---|
| [content-globals.md](content-globals.md) | Shared mutable state |
| [content-utils.md](content-utils.md) | Pure utility functions |
| [content-bridge.md](content-bridge.md) | Chrome AI API bridge |
| [content-subtitle.md](content-subtitle.md) | Subtitle/transcript handling |
| [content-flashcards.md](content-flashcards.md) | Flashcard CRUD UI |
| [content-vocab.md](content-vocab.md) | Vocabulary extraction |
| [content-quiz.md](content-quiz.md) | Quiz logic + SM-2 SRS |
| [content-translation.md](content-translation.md) | Translation checking |
| [content.md](content.md) | Overlay HTML + orchestration |

## Scoping rules

- `var` declarations and function declarations (non-strict mode) are added to the shared global object and are visible across all content script files.
- `let`/`const` and ES module `import`/`export` are **not** shared — they are file-scoped.
- No file uses `'use strict'`, preserving global function declaration hoisting.
- All cross-file state lives in `content-globals.js` as `var`.

## AI API strategy

```
Chrome Built-in AI (on-device, free)
  └── Translator API     → translate subtitles + vocab words
  └── LanguageDetector   → check transcript language matches settings
  └── Writer API         → generate translations, descriptions, quizzes

Google Gemini API (cloud, requires key)
  └── gemini-2.5-flash   → vocab extraction, word validation, quiz gen
  └── Fallback           → used when Chrome AI unavailable or confidence < 70
```

The constant `GEMINI_MODEL = 'gemini-2.5-flash'` is defined in `content-vocab.js` and referenced by all files that call Gemini.
