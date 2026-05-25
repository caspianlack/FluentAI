# content-bridge.js

Manages the postMessage channel between the content script (isolated world) and `injected.js` (page main world), which is where Chrome's built-in AI APIs are accessible.

## Why a bridge is needed

Chrome AI APIs (`window.translation`, `window.ai`, etc.) are only available in the page's main world context. Content scripts run in an isolated world and cannot access them directly. `injected.js` is injected into the main world via a `<script>` tag and proxies calls back over `window.postMessage`.

## Message protocol

```
content script                     injected.js (main world)
────────────────────────────────────────────────────────────
                  FLUENTAI_BRIDGE_READY →   (on injected.js load)
← FLUENTAI_REQUEST { action, data, requestId }
                  FLUENTAI_RESPONSE { requestId, result } →
```

## Module-level state (`var`)

| Variable | Purpose |
|---|---|
| `bridgeReady` | `true` once `FLUENTAI_BRIDGE_READY` is received |
| `pendingRequests` | `Map<requestId, resolveFunction>` for in-flight promises |
| `requestIdCounter` | Auto-incrementing integer for unique request IDs |

A `window.addEventListener('message', ...)` listener is registered at module load time. It resolves pending promises when `FLUENTAI_RESPONSE` arrives.

## Functions

### `chromeAIBridge(action, data)` → `Promise<result>`
Sends a request to `injected.js` and waits for the response. Waits up to 5 s for the bridge to become ready before sending. Times out after 30 s, returning `{ success: false, error: 'Request timeout' }`.

**Actions** (handled by `injected.js`):
- `checkAPIs` — probe which Chrome AI APIs are available
- `translate` — translate text: `{ text, sourceLanguage, targetLanguage }`
- `detectLanguage` — detect language: `{ text }`
- `generateContent` — Writer API: `{ prompt, context }`
- `checkTranslatorReady` — check if language pair is downloaded: `{ sourceLanguage, targetLanguage }`

---

### `initializeChromeAI()` → `Promise<void>`
Calls `checkAPIs` and writes the result into the global `chromeAIAvailable` object, then calls `updateAPIStatusDisplay()` to refresh the Status tab UI. Called once during `init()` and again when settings are updated.

---

### `translateText(text, sourceLanguage, targetLanguage)` → `Promise<string>`
Thin wrapper around `chromeAIBridge('translate', ...)`. Throws if the Translator API is unavailable or returns an error.

---

### `updateAPIStatusDisplay()`
Updates the four status paragraphs in the Status tab (`#translator-status`, `#detector-status`, `#summarizer-status`, `#writer-status`) based on the current `chromeAIAvailable` values. Safe to call before the overlay exists (all selectors use `getElementById` with null checks).

## Globals read

`chromeAIAvailable`, `settings`

## Globals written

`chromeAIAvailable`

## Dependencies

`content-globals.js` (for `chromeAIAvailable`, `settings`)
