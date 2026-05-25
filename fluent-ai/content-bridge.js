// Chrome AI bridge — postMessage channel between the content script and injected.js,
// which runs in the page's main world and has access to Chrome AI APIs.

var bridgeReady = false;
var pendingRequests = new Map();
var requestIdCounter = 0;

window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  if (event.data.type === 'FLUENTAI_BRIDGE_READY') {
    bridgeReady = true;
    console.log('FluentAI: Bridge to Chrome AI APIs is ready');
    return;
  }

  if (event.data.type === 'FLUENTAI_RESPONSE') {
    const { requestId, result } = event.data;
    const resolver = pendingRequests.get(requestId);
    if (resolver) {
      resolver(result);
      pendingRequests.delete(requestId);
    }
  }
});

async function chromeAIBridge(action, data) {
  if (!bridgeReady) {
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (bridgeReady) { clearInterval(checkInterval); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(checkInterval); resolve(); }, 5000);
    });
  }

  return new Promise((resolve) => {
    const requestId = ++requestIdCounter;
    pendingRequests.set(requestId, resolve);

    window.postMessage({ type: 'FLUENTAI_REQUEST', action, data, requestId }, '*');

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        resolve({ success: false, error: 'Request timeout' });
      }
    }, 30000);
  });
}

async function initializeChromeAI() {
  try {
    const checkResult = await chromeAIBridge('checkAPIs', {});
    if (checkResult.success) {
      chromeAIAvailable = {
        translator: checkResult.apis.translatorNew || checkResult.apis.translator,
        languageDetector: checkResult.apis.languageDetectorNew || checkResult.apis.languageDetector,
        summarizer: checkResult.apis.summarizerNew || checkResult.apis.summarizer,
        writer: checkResult.apis.writerNew || checkResult.apis.writer
      };
      console.log('Chrome AI APIs available:', chromeAIAvailable);
      updateAPIStatusDisplay();
    }
  } catch (error) {
    console.error('Error checking Chrome AI APIs:', error);
  }
}

async function translateText(text, sourceLanguage, targetLanguage) {
  if (!chromeAIAvailable.translator) {
    throw new Error('Chrome Translator API not available');
  }
  const result = await chromeAIBridge('translate', {
    text,
    sourceLanguage: sourceLanguage || settings.targetLanguage,
    targetLanguage: targetLanguage || settings.nativeLanguage
  });
  if (result.success && result.translation) return result.translation;
  throw new Error('Translation failed: ' + (result.error || 'Unknown error'));
}

function updateAPIStatusDisplay() {
  const translatorStatus = document.getElementById('translator-status');
  const detectorStatus = document.getElementById('detector-status');
  const summarizerStatus = document.getElementById('summarizer-status');
  const writerStatus = document.getElementById('writer-status');

  if (translatorStatus) {
    translatorStatus.innerHTML =
      `🌐 Translator: <strong>${chromeAIAvailable.translator ? '✅ Ready' : '❌ Not available'}</strong>`;
  }
  if (detectorStatus) {
    detectorStatus.innerHTML =
      `🔍 Language Detector: <strong>${chromeAIAvailable.languageDetector ? '✅ Ready' : '❌ Not available'}</strong>`;
  }
  if (summarizerStatus) {
    summarizerStatus.innerHTML =
      `📝 Summarizer: <strong>${chromeAIAvailable.summarizer ? '✅ Ready' : '❌ Not available'}</strong>`;
  }
  if (writerStatus) {
    writerStatus.innerHTML =
      `✍️ Writer: <strong>${chromeAIAvailable.writer ? '✅ Ready' : '❌ Not available'}</strong>`;
  }

  const geminiStatus = document.getElementById('gemini-status');
  if (geminiStatus) {
    geminiStatus.innerHTML =
      `🔑 API Key: <strong>${settings.geminiApiKey ? '✅ Set' : '❌ Not set'}</strong>`;
  }
}
