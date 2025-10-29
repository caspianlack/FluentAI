let overlay = null;
let isEnabled = true;
let settings = {};
let currentSubtitle = '';
let vocabularySet = new Set();
let chromeAIAvailable = {
  translator: false,
  languageDetector: false,
  summarizer: false,
  writer: false
};
let quizMode = false;
let currentQuiz = null;
let flashcards = [];

let bridgeReady = false;
let pendingRequests = new Map();
let requestIdCounter = 0;

let transcriptSegments = [];
let currentSegmentIndex = 0;
let videoTimeUpdateInterval = null;

// Track processed segments to avoid re-showing them
let segmentsProcessed = new Set();
let lastProcessedSegment = null;

// Initialize IndexedDB
async function initializeDB() {
  try {
    await flashcardDB.waitForReady();
    console.log('IndexedDB ready for content script');
  } catch (error) {
    console.error('Failed to initialize IndexedDB in content script:', error);
  }
}

// Extract transcript from DOM
async function extractTranscriptFromDOM() {
  console.log('FluentAI: Extracting transcript from DOM...');
  
  const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
  
  if (segments.length === 0) {
    throw new Error('No transcript segments found. Please enable captions.');
  }
  
  const transcript = [];
  
  segments.forEach((segment, index) => {
    try {
      const timestampElement = segment.querySelector('.segment-timestamp');
      if (!timestampElement) return;
      
      const timestampText = timestampElement.textContent.trim();
      const timeInSeconds = parseTimestamp(timestampText);
      
      const textElement = segment.querySelector('.segment-text, yt-formatted-string.segment-text');
      if (!textElement) return;
      
      let text = textElement.textContent || textElement.innerText || '';
      text = text.replace(/\s+/g, ' ').replace(/&nbsp;/g, ' ').trim();
      
      if (text && timeInSeconds !== null) {
        let duration = 3; // Default duration
        
        // Calculate actual duration based on next segment start time
        if (index < segments.length - 1) {
          const nextTimestamp = segments[index + 1]?.querySelector('.segment-timestamp');
          if (nextTimestamp) {
            const nextTime = parseTimestamp(nextTimestamp.textContent.trim());
            if (nextTime !== null) {
              duration = Math.max(2, nextTime - timeInSeconds); // Ensure minimum 2 seconds
            }
          }
        } else {
          // Last segment - estimate duration based on text length
          duration = Math.max(3, Math.min(8, text.length / 10)); // 3-8 seconds based on text length
        }
        
        transcript.push({
          text: text,
          start: timeInSeconds,
          duration: duration,
          end: timeInSeconds + duration
        });
      }
    } catch (error) {
      console.warn('FluentAI: Error processing segment:', error);
    }
  });
  
  if (transcript.length === 0) {
    throw new Error('No valid transcript entries extracted');
  }
  
  console.log('FluentAI: Successfully extracted', transcript.length, 'transcript segments');
  return transcript;
}

function parseTimestamp(timestampStr) {
  try {
    const parts = timestampStr.split(':');
    if (parts.length === 2) {
      const minutes = parseInt(parts[0], 10);
      const seconds = parseInt(parts[1], 10);
      return minutes * 60 + seconds;
    } else if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseInt(parts[2], 10);
      return hours * 3600 + minutes * 60 + seconds;
    }
    return null;
  } catch (error) {
    console.warn('FluentAI: Error parsing timestamp:', timestampStr, error);
    return null;
  }
}

async function openTranscriptPanel() {
  console.log('FluentAI: Opening transcript panel...');

  return new Promise((resolve, reject) => {
    // Look for transcript button
    let transcriptButton = document.querySelector('ytd-video-description-transcript-section-renderer button');
    
    if (!transcriptButton) {
      transcriptButton = document.querySelector('[aria-label="Show transcript"], [aria-label*="transcript" i]');
    }
    
    if (!transcriptButton) {
      const buttons = document.querySelectorAll('button, [role="button"]');
      for (const button of buttons) {
        const text = button.textContent || button.innerText || '';
        if (text.toLowerCase().includes('transcript') || text.toLowerCase().includes('show transcript')) {
          transcriptButton = button;
          break;
        }
      }
    }
    
    if (transcriptButton) {
      console.log('FluentAI: Found transcript button, clicking...');
      transcriptButton.click();
      
      // Wait for transcript panel to load
      let attempts = 0;
      const maxAttempts = 20;
      const checkInterval = setInterval(() => {
        attempts++;
        const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
        
        if (segments.length > 0) {
          console.log('FluentAI: Transcript panel loaded with', segments.length, 'segments');
          clearInterval(checkInterval);
          resolve();
        } else if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          reject(new Error('Transcript panel did not load within expected time'));
        }
      }, 500);
    } else {
      reject(new Error('Could not find transcript button. Video may not have captions available.'));
    }
  });
}

function injectPageScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

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

// Chrome AI API Bridge - Send requests to background script
async function chromeAIBridge(action, data) {
  if (!bridgeReady) {
    // Wait for bridge to be ready
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (bridgeReady) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 5000);
    });
  }
  
  return new Promise((resolve) => {
    const requestId = ++requestIdCounter;
    pendingRequests.set(requestId, resolve);
    
    window.postMessage({
      type: 'FLUENTAI_REQUEST',
      action,
      data,
      requestId
    }, '*');
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        resolve({ success: false, error: 'Request timeout' });
      }
    }, 30000);
  });
}

// Initialize Chrome AI APIs through background bridge
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
      updateAPIStatus();
    }
  } catch (error) {
    console.error('Error checking Chrome AI APIs:', error);
  }
}

// Helper function to translate text using the bridge
async function translateText(text, sourceLanguage = null, targetLanguage = null) {
  if (!chromeAIAvailable.translator) {
    throw new Error('Chrome Translator API not available');
  }
  
  const result = await chromeAIBridge('translate', {
    text,
    sourceLanguage: sourceLanguage || settings.targetLanguage,
    targetLanguage: targetLanguage || settings.nativeLanguage
  });
  
  if (result.success) {
    return result.translation;
  } else {
    throw new Error(result.error || 'Translation failed');
  }
}

// Update API status in UI
function updateAPIStatus() {
  if (overlay) {
    const statusElement = document.querySelector('.fluentai-status');
    if (statusElement) {
      const apiStatusHtml = `
        <p><strong>Chrome AI Status:</strong></p>
        <p>🌐 Translator: ${chromeAIAvailable.translator ? '✅ Ready' : '❌ Not Available'}</p>
        <p>🔍 Language Detector: ${chromeAIAvailable.languageDetector ? '✅ Ready' : '❌ Not Available'}</p>
        <p>📝 Summarizer: ${chromeAIAvailable.summarizer ? '✅ Ready' : '❌ Not Available'}</p>
        <p>✍️ Writer: ${chromeAIAvailable.writer ? '✅ Ready' : '❌ Not Available'}</p>
      `;
      statusElement.innerHTML = apiStatusHtml;
    }
  }
}

// Load settings
async function loadSettings() {
  const result = await chrome.storage.sync.get([
    'nativeLanguage',
    'targetLanguage',
    'autoTranslate',
    'geminiApiKey',
    'quizFrequency',
    'notificationEnabled',
    'pauseDelay',
    'useGeminiValidation',
    'autoPlayAfterCorrect'
  ]);
  
  settings = {
    nativeLanguage: result.nativeLanguage || 'en',
    targetLanguage: result.targetLanguage || 'es',
    autoTranslate: result.autoTranslate !== false,
    geminiApiKey: result.geminiApiKey || '',
    quizFrequency: result.quizFrequency || 5,
    notificationEnabled: result.notificationEnabled !== false,
    pauseDelay: result.pauseDelay !== undefined ? result.pauseDelay : 0.0,
    useGeminiValidation: result.useGeminiValidation !== false,
    autoPlayAfterCorrect: result.autoPlayAfterCorrect !== false
  };
  
  // Load flashcards for current language from IndexedDB
  try {
    flashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
    console.log(`FluentAI: Loaded ${flashcards.length} flashcards for ${settings.targetLanguage} from IndexedDB`);
  } catch (error) {
    console.error('Error loading flashcards from IndexedDB:', error);
    flashcards = [];
  }
  
  // Reinitialize Chrome AI with new settings
  await initializeChromeAI();
}

// Create the enhanced overlay with side panel and center quiz
function createOverlay() {
  if (overlay) return;
  
  overlay = document.createElement('div');
  overlay.id = 'fluentai-overlay';
  overlay.innerHTML = `
    <!-- Side Panel (collapsible) -->
    <div class="fluentai-panel" id="side-panel">
      <div class="fluentai-header">
        <span class="fluentai-logo">🎓 FluentAI</span>
        <div class="fluentai-controls">
          <button class="fluentai-collapse-btn" id="collapse-btn">◀</button>
          <button class="fluentai-toggle-btn" id="toggle-btn">Pause</button>
        </div>
      </div>
      
      <div class="fluentai-content" id="panel-content">
        <div class="fluentai-tabs">
          <button class="tab-btn active" data-tab="translate">Translate</button>
          <button class="tab-btn" data-tab="vocabulary">Vocabulary</button>
          <button class="tab-btn" data-tab="stats">Stats</button>
          <button class="tab-btn" data-tab="status">Status</button>
        </div>
        
        <!-- Translate Tab -->
        <div class="tab-content active" id="translate-tab">
          <div class="fluentai-status">
            <p>🎯 Learning: <strong>${getLanguageName(settings.targetLanguage)}</strong></p>
            <p>📺 Auto-pause: <strong>${settings.autoTranslate ? 'ON' : 'OFF'}</strong></p>
            <p>⏸️ Status: <strong id="pause-status">Waiting for subtitles...</strong></p>
          </div>
          
          <div class="fluentai-exercise">
            <div class="fluentai-subtitle" id="subtitle-display">
              <span class="subtitle-text">Waiting for subtitles...</span>
              <button class="speak-btn" id="speak-btn">🔊</button>
            </div>
            <input type="text" id="fluentai-input" placeholder="Type the translation..." />
            <button id="fluentai-submit">Check Translation</button>
            <button class="fluentai-skip-btn" id="skip-btn">Skip</button>
            <div class="fluentai-feedback" id="fluentai-feedback"></div>
          </div>
        </div>
        
        <!-- Vocabulary Tab -->
        <div class="tab-content" id="vocabulary-tab" style="display: none;">
          <div class="vocabulary-stats">
            <p>📚 Words collected: <span id="vocab-count">0</span></p>
            <p>🎯 Flashcards: <span id="flashcard-count">0</span></p>
          </div>
          <button class="overlay-tab" data-tab="practice">
            🎓 Practice
          </button>

          <div class="overlay-tab-content" id="practice-tab">
            <div class="practice-container">
              <h3>📚 Flashcard Practice</h3>
              <div class="practice-stats">
                <div class="stat-box">
                  <span id="total-flashcards-count">0</span>
                  <span>Total Cards</span>
                </div>
              </div>
              <button id="start-practice-btn" class="primary-btn">
                🎯 Start Practice (5 Random Cards)
              </button>
            </div>
          </div>

          <div class="vocabulary-list" id="vocab-list"></div>
          <button class="action-btn" id="extract-vocab-btn">Extract Vocabulary</button>
          <button class="action-btn" id="create-flashcards-btn">Create Flashcards</button>
        </div>
        
        <!-- Stats Tab -->
        <div class="tab-content" id="stats-tab" style="display: none;">
          <div class="stats-container">
            <div class="stat-item">
              <span class="stat-label">✅ Correct:</span>
              <span class="stat-value" id="correct-count">0</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">❌ Incorrect:</span>
              <span class="stat-value" id="incorrect-count">0</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">🏆 Streak:</span>
              <span class="stat-value" id="streak-count">0</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">📈 Accuracy:</span>
              <span class="stat-value" id="accuracy">0%</span>
            </div>
          </div>
          <button class="action-btn" id="start-quiz-btn">Start Quiz</button>
        </div>

        <!-- Status Tab -->
        <div class="tab-content" id="status-tab" style="display: none;">
          <div class="fluentai-status">
            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #2d3748;">Learning Settings</h3>
            <p>🎯 Learning: <strong>${getLanguageName(settings.targetLanguage)}</strong></p>
            <p>🗣️ Native: <strong>${getLanguageName(settings.nativeLanguage)}</strong></p>
            <p>📺 Auto-pause: <strong>${settings.autoTranslate ? 'ON' : 'OFF'}</strong></p>
            <p>⏱️ Pause delay: <strong>${settings.pauseDelay || 1.0}s</strong></p>
            <p>🤖 Gemini validation: <strong>${settings.useGeminiValidation !== false ? 'ON' : 'OFF'}</strong></p>
            <p>▶️ Auto-play after correct: <strong>${settings.autoPlayAfterCorrect !== false ? 'ON' : 'OFF'}</strong></p>
          </div>
          
          <div class="fluentai-status" style="margin-top: 15px;">
            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #2d3748;">Chrome AI Status</h3>
            <p id="translator-status">🌐 Translator: <strong>⏳ Checking...</strong></p>
            <p id="detector-status">🔍 Language Detector: <strong>⏳ Checking...</strong></p>
            <p id="summarizer-status">📝 Summarizer: <strong>⏳ Checking...</strong></p>
            <p id="writer-status">✍️ Writer: <strong>⏳ Checking...</strong></p>
          </div>
          
          <div class="fluentai-status" style="margin-top: 15px;">
            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #2d3748;">Storage Status</h3>
            <p id="indexeddb-status">💾 IndexedDB: <strong>⏳ Checking...</strong></p>
            <p style="font-size: 12px; color: #666; margin-top: 10px;">
              Using IndexedDB for unlimited flashcard storage
            </p>
          </div>
          
          <button class="action-btn" id="refresh-status-btn" style="margin-top: 15px;">
            🔄 Refresh Status
          </button>
        </div>
      </div>
    </div>
    
    <!-- Collapsed Side Panel Button -->
    <div class="fluentai-collapsed" id="collapsed-panel" style="display: none;">
      <button class="expand-btn" id="expand-btn">
        <span>🎓</span>
        <span>FluentAI</span>
      </button>
    </div>
    
    <!-- Center Quiz Overlay -->
    <div class="fluentai-quiz-overlay" id="quiz-overlay" style="display: none;">
      <div class="quiz-container">
        <div class="quiz-header">
          <h2>🎯 Language Quiz</h2>
          <button class="quiz-close-btn" id="quiz-close-btn">✕</button>
        </div>
        <div class="quiz-content" id="quiz-content">
          <!-- Quiz questions will be inserted here -->
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  setupEventListeners();
  updateStats();
  updateIndexedDBStatus();
}

// Setup all event listeners
function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      switchTab(e.target.dataset.tab);
    });
  });
  
  // Collapse/Expand panel
  document.getElementById('collapse-btn')?.addEventListener('click', collapsePanel);
  document.getElementById('expand-btn')?.addEventListener('click', expandPanel);
  
  // Translation controls
  document.getElementById('toggle-btn')?.addEventListener('click', togglePause);
  document.getElementById('fluentai-submit')?.addEventListener('click', checkTranslation);
  document.getElementById('skip-btn')?.addEventListener('click', skipSubtitle);
  document.getElementById('speak-btn')?.addEventListener('click', () => speakSubtitle(currentSubtitle));
  
  // Vocabulary controls
  document.getElementById('extract-vocab-btn')?.addEventListener('click', extractVocabulary);
  document.getElementById('create-flashcards-btn')?.addEventListener('click', createFlashcardsFromVocab);
  
  // Quiz controls
  document.getElementById('start-quiz-btn')?.addEventListener('click', startQuiz);
  document.getElementById('quiz-close-btn')?.addEventListener('click', closeQuiz);
  
  // Enter key submission
  document.getElementById('fluentai-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      checkTranslation();
    }
  });

  document.querySelectorAll('.overlay-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.dataset.tab;
      if (tab === 'practice') {
        startPracticeFromOverlay();
      }
    });
  });
  
  document.getElementById('refresh-status-btn')?.addEventListener('click', async () => {
    await initializeChromeAI();
    updateAPIStatusDisplay();
    updateIndexedDBStatus();
    showNotification('Status refreshed!', 'success');
  });
}

// Tab switching functionality
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  
  document.querySelectorAll('.tab-content').forEach(content => {
    content.style.display = 'none';
  });
  
  document.getElementById(`${tabName}-tab`).style.display = 'block';
}

// Panel collapse/expand
function collapsePanel() {
  document.getElementById('side-panel').style.display = 'none';
  document.getElementById('collapsed-panel').style.display = 'block';
}

function expandPanel() {
  document.getElementById('side-panel').style.display = 'block';
  document.getElementById('collapsed-panel').style.display = 'none';
}

// Update IndexedDB status display
async function updateIndexedDBStatus() {
  try {
    const stats = await flashcardDB.getStats(settings.targetLanguage);
    const element = document.getElementById('indexeddb-status');
    if (element) {
      element.innerHTML = `💾 IndexedDB: <strong>✅ Ready (${stats.total} ${settings.targetLanguage} cards)</strong>`;
    }
    
    // Update flashcard count in vocabulary tab
    const flashcardCountElement = document.getElementById('flashcard-count');
    if (flashcardCountElement) {
      flashcardCountElement.textContent = stats.total;
    }
  } catch (error) {
    const element = document.getElementById('indexeddb-status');
    if (element) {
      element.innerHTML = `💾 IndexedDB: <strong>❌ Error</strong>`;
    }
  }
}

// ============================================================================
// SMART VOCABULARY EXTRACTION SYSTEM (Updated for IndexedDB)
// ============================================================================

// Common stop words to filter out
const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
  'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'now', 'here',
  'there', 'then', 'them', 'their', 'my', 'your', 'his', 'her', 'its',
  'our', 'get', 'go', 'got', 'going', 'went', 'gone',
  // Spanish
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'pero',
  'de', 'del', 'al', 'en', 'con', 'por', 'para', 'como', 'más', 'que',
  'es', 'son', 'era', 'están', 'esto', 'eso', 'mi', 'tu', 'su',
  // French  
  'le', 'la', 'les', 'un', 'une', 'des', 'et', 'ou', 'mais', 'de', 'du',
  'dans', 'sur', 'avec', 'par', 'pour', 'comme', 'plus', 'que', 'est',
  'sont', 'ce', 'cette', 'ces', 'mon', 'ton', 'son',
  // German
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem',
  'und', 'oder', 'aber', 'von', 'zu', 'in', 'mit', 'auf', 'für', 'ist',
  'sind', 'war', 'waren', 'dieser', 'diese', 'dieses', 'mein', 'dein', 'sein'
]);

// Clean and normalize a word
function cleanWord(word) {
  if (!word) return '';
  
  let cleaned = word
    .toLowerCase()
    .trim()
    .replace(/[^\w\s'-]/g, '')
    .replace(/^['"-]+|['"-]+$/g, '');
  
  return cleaned;
}

// Check if a word is valid for learning
function isValidWord(word, difficulty = 'intermediate') {
  if (!word || word.length < 2) return false;
  if (/^\d+$/.test(word)) return false;
  if (STOP_WORDS.has(word.toLowerCase())) return false;
  
  const minLength = {
    'beginner': 3,
    'intermediate': 3,
    'advanced': 2
  }[difficulty] || 3;
  
  if (word.length < minLength) return false;
  if (!/[a-zA-Z]/.test(word)) return false;
  
  return true;
}

// Phase 1: Local extraction with filtering
async function extractVocabularyLocal() {
  if (!transcriptSegments || transcriptSegments.length === 0) {
    showNotification('Please load subtitles first', 'error');
    return [];
  }
  
  console.log('Phase 1: Local extraction starting...');
  
  const allText = transcriptSegments.map(seg => seg.text).join(' ');
  const allWords = allText.split(/\s+/);
  
  console.log(`Found ${allWords.length} total words in transcript`);
  
  const wordFrequency = new Map();
  
  for (const word of allWords) {
    const cleaned = cleanWord(word);
    if (isValidWord(cleaned, settings.difficulty)) {
      wordFrequency.set(cleaned, (wordFrequency.get(cleaned) || 0) + 1);
    }
  }
  
  console.log(`${wordFrequency.size} unique valid words after cleaning`);
  
  const sortedWords = Array.from(wordFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);
  
  // Remove words already in flashcards using IndexedDB
  const newWords = [];
  for (const word of sortedWords) {
    const exists = await flashcardDB.wordExists(word, settings.targetLanguage);
    if (!exists) {
      newWords.push(word);
    }
  }
  
  console.log(`${newWords.length} words after removing duplicates`);
  
  const limitedWords = newWords.slice(0, 30);
  console.log(`Limited to ${limitedWords.length} words for translation`);
  
  return limitedWords;
}

// Phase 2: Chrome AI Translation
async function translateWordsWithChromeAI(words) {
  console.log('Phase 2: Translating with Chrome AI...');
  
  if (!chromeAIAvailable.translator) {
    showNotification('Chrome AI Translator not available', 'error');
    return [];
  }
  
  const translations = [];
  
  for (const word of words) {
    try {
      const result = await chromeAIBridge('translate', {
        text: word,
        sourceLanguage: settings.targetLanguage,
        targetLanguage: settings.nativeLanguage
      });
      
      if (result.success && result.translation) {
        translations.push({
          original: word,
          translation: result.translation,
          confidence: 80,
          source: 'chrome-ai'
        });
      }
    } catch (error) {
      console.error(`Translation error for "${word}":`, error);
    }
  }
  
  console.log(`Successfully translated ${translations.length} words`);
  return translations;
}

// Main orchestration function for vocabulary extraction
async function extractAndShowVocabularySmart() {
  console.log('=== Starting Smart Vocabulary Extraction ===');
  
  if (!transcriptSegments || transcriptSegments.length === 0) {
    showNotification('Please load subtitles first', 'error');
    return;
  }
  
  if (!chromeAIAvailable.translator) {
    showNotification('Chrome AI Translator is required. Please enable it in chrome://flags', 'error');
    return;
  }
  
  const vocabTab = document.getElementById('vocabulary-tab');
  if (!vocabTab) return;
  
  // Show loading state - Phase 1
  vocabTab.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <h3>🔍 Step 1/3: Analyzing Transcript...</h3>
      <p>Extracting unique vocabulary locally</p>
    </div>
  `;
  switchTab('vocabulary');
  
  // Phase 1: Local extraction
  const words = await extractVocabularyLocal();
  
  if (words.length === 0) {
    vocabTab.innerHTML = `
      <div class="error-message">
        <h3>❌ No New Vocabulary Found</h3>
        <p>All words from this video are already in your flashcards, or no suitable words were found.</p>
        <button id="retry-extraction" class="primary-btn">Try Another Video</button>
      </div>
    `;
    document.getElementById('retry-extraction')?.addEventListener('click', extractAndShowVocabularySmart);
    return;
  }
  
  // Show loading state - Phase 2
  vocabTab.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <h3>🌐 Step 2/3: Translating Words...</h3>
      <p>Using Chrome AI to translate ${words.length} words</p>
    </div>
  `;
  
  // Phase 2: Chrome AI Translation
  const translations = await translateWordsWithChromeAI(words);
  
  if (translations.length === 0) {
    vocabTab.innerHTML = `
      <div class="error-message">
        <h3>❌ Translation Failed</h3>
        <p>Unable to translate words. Please check Chrome AI Translator is enabled.</p>
        <button id="retry-extraction" class="primary-btn">Try Again</button>
      </div>
    `;
    document.getElementById('retry-extraction')?.addEventListener('click', extractAndShowVocabularySmart);
    return;
  }
  
  // Display results directly (skip Gemini validation for now)
  await showVocabularySelectorSmart(translations);
}

// Display vocabulary with smart UI
async function showVocabularySelectorSmart(wordPairs) {
  if (!wordPairs || wordPairs.length === 0) {
    showNotification('No vocabulary to display', 'info');
    return;
  }
  
  const vocabTab = document.getElementById('vocabulary-tab');
  if (!vocabTab) return;
  
  // Filter by confidence
  const highConfidenceWords = wordPairs.filter(pair => pair.confidence >= 70);
  
  if (highConfidenceWords.length === 0) {
    vocabTab.innerHTML = `
      <div class="error-message">
        <h3>⚠️ Low Confidence Translations</h3>
        <p>No translations met the quality threshold (70%+ confidence)</p>
        <button id="retry-extraction" class="primary-btn">Try Again</button>
      </div>
    `;
    document.getElementById('retry-extraction')?.addEventListener('click', extractAndShowVocabularySmart);
    return;
  }
  
  // Generate descriptions for words
  // vocabTab.innerHTML = `
  //   <div class="loading-state">
  //     <div class="spinner"></div>
  //     <h3>✨ Generating Descriptions...</h3>
  //     <p>Adding helpful explanations for each word</p>
  //   </div>
  // `;
  
  //const wordsWithDescriptions = await generateDescriptionsForWords(highConfidenceWords);
  const words = highConfidenceWords;

  vocabTab.innerHTML = `
    <div class="vocab-extraction">
      <h3>📚 Found ${words.length} Words</h3>
      <p class="vocab-subtitle">
        Translated with Chrome AI 🌐
      </p>
      
      <div class="vocab-actions">
        <button id="select-all-vocab" class="action-btn">Select All</button>
        <button id="deselect-all-vocab" class="action-btn">Deselect All</button>
        <button id="add-selected-vocab" class="primary-btn">Add Selected (0)</button>
      </div>
      
      <div id="vocab-list" class="vocab-list"></div>
    </div>
  `;
  
  const vocabList = document.getElementById('vocab-list');
  const addSelectedBtn = document.getElementById('add-selected-vocab');
  
  // Create word items WITHOUT descriptions initially
  words.forEach((pair, index) => {
    const vocabItem = document.createElement('div');
    vocabItem.className = 'vocab-item';
    vocabItem.dataset.index = index;
    
    vocabItem.innerHTML = `
      <input type="checkbox" id="vocab-${index}" class="vocab-checkbox" data-index="${index}" checked>
      <div class="vocab-content">
        <div class="vocab-word">
          <strong>${pair.original}</strong>
          <button class="info-btn" data-index="${index}" title="Load description">ℹ️</button>
        </div>
        <div class="vocab-translation">${pair.translation}</div>
        <div class="vocab-description" id="desc-${index}" style="display: none;">
          <!-- Description loads on demand -->
        </div>
        <div class="vocab-meta">
          <span class="confidence-badge">${pair.confidence}%</span>
          <span class="source-badge">${pair.source || 'chrome-ai'}</span>
        </div>
      </div>
    `;
    vocabList.appendChild(vocabItem);
  });
  
  // Add info button click handlers
  document.querySelectorAll('.info-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      const descElement = document.getElementById(`desc-${index}`);
      const word = words[index];
      
      if (!descElement) return;
      
      // If already visible, just hide it
      if (descElement.style.display !== 'none') {
        descElement.style.display = 'none';
        btn.textContent = 'ℹ️';
        return;
      }
      
      // If no description yet, load it
      if (!word.description) {
        btn.textContent = '⏳';
        btn.disabled = true;
        
        try {
          // Generate description for just this word
          const description = await generateSingleDescription(word);
          word.description = description;
          descElement.textContent = description;
        } catch (error) {
          console.error('Error loading description:', error);
          descElement.textContent = 'Failed to load description';
        }
        
        btn.disabled = false;
        btn.textContent = '❌';
      }
      
      // Show the description
      descElement.style.display = 'block';
      btn.textContent = '❌';
    });
  });
  
  // Update selected count
  function updateSelectedCount() {
    const selected = document.querySelectorAll('.vocab-checkbox:checked').length;
    addSelectedBtn.textContent = `Add Selected (${selected})`;
    addSelectedBtn.disabled = selected === 0;
  }
  
  updateSelectedCount();
  
  // Select/deselect all
  document.getElementById('select-all-vocab').addEventListener('click', () => {
    document.querySelectorAll('.vocab-checkbox').forEach(cb => cb.checked = true);
    updateSelectedCount();
  });
  
  document.getElementById('deselect-all-vocab').addEventListener('click', () => {
    document.querySelectorAll('.vocab-checkbox').forEach(cb => cb.checked = false);
    updateSelectedCount();
  });
  
  vocabList.addEventListener('change', updateSelectedCount);
  
  // Add to flashcards
  // Add to flashcards
  addSelectedBtn.addEventListener('click', async () => {
    const selectedCheckboxes = document.querySelectorAll('.vocab-checkbox:checked');
    const selectedWords = Array.from(selectedCheckboxes).map(cb => {
      const index = parseInt(cb.dataset.index);
      return words[index]; // Changed from wordsWithDescriptions to words
    });
    
    if (selectedWords.length === 0) return;
    
    addSelectedBtn.disabled = true;
    addSelectedBtn.textContent = 'Adding...';
    
    // Create flashcard objects with descriptions (will be empty or loaded on-demand)
    const flashcardsToAdd = selectedWords.map(pair => ({
      word: pair.original,
      translation: pair.translation,
      context: pair.context || '',
      description: pair.description || '', // Will be empty unless user clicked ℹ️
      language: settings.targetLanguage,
      confidence: pair.confidence,
      source: pair.source
    }));
    
    try {
      // Add to IndexedDB
      await flashcardDB.addFlashcards(flashcardsToAdd);
      
      // Update local flashcards array
      flashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
      
      showNotification(`Added ${selectedWords.length} words to flashcards!`, 'success');
      
      // Show success
      vocabTab.innerHTML = `
        <div class="success-message">
          <h3>✅ Success!</h3>
          <p>${selectedWords.length} words added to your flashcards</p>
          <button id="extract-more-vocab" class="primary-btn">Extract More Words</button>
          <button id="start-practice-now" class="primary-btn">🎓 Practice Now</button>
        </div>
      `;
      
      document.getElementById('extract-more-vocab').addEventListener('click', extractAndShowVocabularySmart);
      document.getElementById('start-practice-now').addEventListener('click', () => startPracticeFromOverlay());
      
      // Update flashcard count display
      updateIndexedDBStatus();
      
    } catch (error) {
      console.error('Error adding flashcards:', error);
      showNotification('Error adding flashcards to database', 'error');
      addSelectedBtn.disabled = false;
      addSelectedBtn.textContent = 'Add Selected (0)';
    }
  });
  
  switchTab('vocabulary');
}

async function generateSingleDescription(wordPair) {
  // Try Chrome AI Writer first
  if (chromeAIAvailable.writer) {
    try {
      const prompt = `Explain the ${settings.targetLanguage} word "${wordPair.original}" (meaning: ${wordPair.translation}) in one simple sentence. Include when/how it's used.`;
      
      const result = await chromeAIBridge('generateContent', {
        prompt: prompt,
        context: 'Language learning vocabulary explanation'
      });
      
      if (result.success && result.content) {
        return result.content.trim().substring(0, 200);
      }
    } catch (error) {
      console.error('Error generating description with Chrome AI:', error);
    }
  }
  
  // Fallback to Gemini if available
  if (settings.geminiApiKey) {
    try {
      const prompt = `Explain "${wordPair.original}" (${wordPair.translation}) in ${settings.targetLanguage} in one simple, clear sentence.`;
      
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${settings.geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 100
          }
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.candidates[0].content.parts[0].text.trim().substring(0, 200);
      }
    } catch (error) {
      console.error('Gemini description error:', error);
    }
  }
  
  // Simple fallback
  return `"${wordPair.original}" means "${wordPair.translation}" in ${settings.targetLanguage}.`;
}

async function startPracticeFromOverlay() {
  try {
    // Get flashcards from IndexedDB
    const allFlashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
    
    if (allFlashcards.length === 0) {
      showNotification('No flashcards available. Add some words first!', 'error');
      return;
    }
    
    showNotification(`Loading practice session...`, 'info');
    
    // Select 5 random flashcards
    const shuffled = [...allFlashcards].sort(() => Math.random() - 0.5);
    const practiceCards = shuffled.slice(0, Math.min(5, shuffled.length));
    
    // Start practice quiz in the overlay
    startFlashcardPractice(practiceCards);
    
  } catch (error) {
    console.error('Error starting practice:', error);
    showNotification('Error loading flashcards for practice', 'error');
  }
}

async function generateDescriptionsForWords(wordPairs) {
  const results = [];
  let successCount = 0;
  
  for (let i = 0; i < wordPairs.length; i++) {
    const pair = wordPairs[i];
    let description = '';
    
    // Show progress
    if (i % 5 === 0) {
      showNotification(`Generating descriptions... ${i + 1}/${wordPairs.length}`, 'info');
    }
    
    // Try Chrome AI Writer first
    if (chromeAIAvailable.writer) {
      try {
        const prompt = `Explain the ${settings.targetLanguage} word "${pair.original}" (meaning: ${pair.translation}) in one simple sentence. Include when/how it's used.`;
        
        const result = await chromeAIBridge('generateContent', {
          prompt: prompt,
          context: 'Language learning vocabulary explanation'
        });
        
        if (result.success && result.content) {
          description = result.content.trim().substring(0, 200); // Limit length
          successCount++;
        }
      } catch (error) {
        console.error('Error generating description with Chrome AI:', error);
      }
    }
    
    // Fallback to Gemini if available and Chrome AI failed
    if (!description && settings.geminiApiKey) {
      try {
        const prompt = `Explain "${pair.original}" (${pair.translation}) in ${settings.targetLanguage} in one simple, clear sentence. Format: "${pair.original} means ${pair.translation}. [Usage note]. Simple sentence: [example]."`;
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${settings.geminiApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 100
            }
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          description = data.candidates[0].content.parts[0].text.trim().substring(0, 200);
          successCount++;
        }
      } catch (error) {
        console.error('Gemini description error:', error);
      }
    }
    
    // Fallback to simple description
    if (!description) {
      description = `"${pair.original}" means "${pair.translation}" in ${settings.targetLanguage}.`;
    }
    
    results.push({
      ...pair,
      description: description
    });
    
    // Small delay to avoid overwhelming APIs
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`Generated ${successCount}/${wordPairs.length} descriptions successfully`);
  return results;
}

// Extract vocabulary function
async function extractVocabulary() {
  await extractAndShowVocabularySmart();
}

// Create flashcards from vocabulary set (legacy function)
async function createFlashcardsFromVocab() {
  let addedCount = 0;
  
  for (const word of vocabularySet) {
    if (!flashcards.some(fc => fc.word === word)) {
      let translation = word;
      
      if (chromeAIAvailable.translator) {
        try {
          translation = await translateText(word);
        } catch (error) {
          console.error('Translation error:', error);
        }
      }
      
      try {
        await flashcardDB.addFlashcard({
          word: word,
          translation: translation,
          context: '',
          language: settings.targetLanguage
        });
        addedCount++;
      } catch (error) {
        console.error('Error adding flashcard:', error);
      }
    }
  }
  
  // Reload flashcards from IndexedDB
  flashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
  showNotification(`Added ${addedCount} new flashcards!`, 'success');
  updateIndexedDBStatus();
}

// Update vocabulary display
function updateVocabularyDisplay() {
  document.getElementById('vocab-count').textContent = vocabularySet.size;
  document.getElementById('flashcard-count').textContent = flashcards.length;
}

// Add word to flashcards
function addToFlashcards(word, translation) {
  const flashcard = {
    id: Date.now(),
    word: word,
    translation: translation,
    language: settings.targetLanguage,
    sets: [], // Ready for future set management
    difficulty: 0,
    lastReviewed: null,
    nextReview: Date.now()
  };
  
  flashcards.push(flashcard);
  
  // Save to storage (unfiltered, all languages)
  chrome.storage.sync.get(['flashcards'], (result) => {
    const allFlashcards = result.flashcards || [];
    allFlashcards.push(flashcard);
    chrome.storage.sync.set({ flashcards: allFlashcards });
  });
  
  updateVocabularyDisplay();
  showNotification(`Added "${word}" to flashcards!`, 'success');
}

// Create flashcards from vocabulary
async function createFlashcardsFromVocab() {
  let addedCount = 0;
  
  for (const word of vocabularySet) {
    if (!flashcards.some(fc => fc.word === word)) {
      let translation = word; // Default to same word
      
      if (chromeAIAvailable.translator) {
        try {
          translation = await translateText(word);
        } catch (error) {
          console.error('Translation error:', error);
        }
      }
      
      addToFlashcards(word, translation);
      addedCount++;
    }
  }
  
  showNotification(`Added ${addedCount} new flashcards!`, 'success');
}

// Quiz functionality using Chrome Writer API
async function startQuiz() {
  quizMode = true;
  const quizOverlay = document.getElementById('quiz-overlay');
  quizOverlay.style.display = 'flex';
  
  // Pause video
  const video = document.querySelector('video');
  if (video) video.pause();
  
  await generateQuiz();
}

async function generateQuiz() {
  const quizContent = document.getElementById('quiz-content');
  
  // Filter flashcards by current target language
  const languageFlashcards = flashcards.filter(fc => fc.language === settings.targetLanguage);
  
  if (!currentSubtitle && languageFlashcards.length === 0) {
    quizContent.innerHTML = '<p class="quiz-message">No content available for quiz. Watch more videos or add flashcards!</p>';
    return;
  }
  
  // Generate quiz using Chrome Writer API or fallback
  let quizQuestions = [];
  
  if (chromeAIAvailable.writer) {
    try {
      // Use Chrome Writer API to generate quiz questions
      const context = currentSubtitle || languageFlashcards.map(fc => fc.word).join(', ');
      const prompt = `Generate 3 language learning quiz questions based on: ${context}. Format as multiple choice with 4 options each.`;
      
      const response = await generateWithAI(prompt);
      // Parse the response and create quiz structure
      quizQuestions = parseWriterResponse(response);
    } catch (error) {
      console.error('Writer API error:', error);
      // Fallback to simple quiz generation
      quizQuestions = generateFallbackQuiz();
    }
  } else if (settings.geminiApiKey) {
    // Use Gemini API as fallback
    quizQuestions = await generateGeminiQuiz();
  } else {
    // Simple fallback quiz
    quizQuestions = generateFallbackQuiz();
  }
  
  displayQuiz(quizQuestions);
}

// Generate fallback quiz without AI
function generateFallbackQuiz() {
  const questions = [];
  
  // Filter flashcards by current target language
  const languageFlashcards = flashcards.filter(fc => fc.language === settings.targetLanguage);
  
  // Multiple choice from flashcards
  if (languageFlashcards.length >= 4) {
    const selectedCard = languageFlashcards[Math.floor(Math.random() * languageFlashcards.length)];
    const wrongAnswers = languageFlashcards
      .filter(fc => fc.id !== selectedCard.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map(fc => fc.translation);
    
    questions.push({
      type: 'multiple-choice',
      question: `What does "${selectedCard.word}" mean?`,
      options: [...wrongAnswers, selectedCard.translation].sort(() => Math.random() - 0.5),
      correct: selectedCard.translation
    });
  }
  
  // Fill in the blank
  if (currentSubtitle) {
    const words = currentSubtitle.split(' ');
    if (words.length > 3) {
      const blankIndex = Math.floor(Math.random() * words.length);
      const missingWord = words[blankIndex];
      words[blankIndex] = '_____';
      
      questions.push({
        type: 'fill-blank',
        question: 'Fill in the blank:',
        sentence: words.join(' '),
        correct: missingWord
      });
    }
  }
  
  // Vocabulary translation
  if (vocabularySet.size > 0) {
    const vocabArray = Array.from(vocabularySet);
    const randomWord = vocabArray[Math.floor(Math.random() * vocabArray.length)];
    
    questions.push({
      type: 'translation',
      question: `Translate this word to ${getLanguageName(settings.nativeLanguage)}:`,
      word: randomWord,
      correct: null // Will be checked with translation API
    });
  }
  
  return questions;
}

// Generate quiz using Gemini API
async function generateGeminiQuiz() {
  if (!settings.geminiApiKey) return generateFallbackQuiz();
  
  try {
    // Filter flashcards by current target language
    const languageFlashcards = flashcards.filter(fc => fc.language === settings.targetLanguage);
    const context = currentSubtitle || languageFlashcards.map(fc => `${fc.word}: ${fc.translation}`).join(', ');
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${settings.geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': settings.geminiApiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Create 3 language learning quiz questions for ${getLanguageName(settings.targetLanguage)} learners. Context: "${context}". 
            Return JSON format:
            [
              {
                "type": "multiple-choice",
                "question": "question text",
                "options": ["option1", "option2", "option3", "option4"],
                "correct": "correct answer"
              }
            ]`
          }]
        }]
      })
    });
    
    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;
    
    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('Gemini quiz generation error:', error);
  }
  
  return generateFallbackQuiz();
}

// Display quiz questions
function displayQuiz(questions) {
  const quizContent = document.getElementById('quiz-content');
  
  if (questions.length === 0) {
    quizContent.innerHTML = '<p class="quiz-message">No quiz questions available. Try again later!</p>';
    return;
  }
  
  currentQuiz = {
    questions: questions,
    currentIndex: 0,
    score: 0,
    answers: []
  };
  
  displayQuestion(0);
}

// Display individual question
function displayQuestion(index) {
  const question = currentQuiz.questions[index];
  const quizContent = document.getElementById('quiz-content');
  
  let html = `
    <div class="quiz-progress">
      Question ${index + 1} of ${currentQuiz.questions.length}
    </div>
    <div class="quiz-question">
      <h3>${question.question}</h3>
  `;
  
  switch (question.type) {
    case 'multiple-choice':
      html += '<div class="quiz-options">';
      question.options.forEach((option, i) => {
        html += `
          <button class="quiz-option" data-answer="${option}">
            ${String.fromCharCode(65 + i)}. ${option}
          </button>
        `;
      });
      html += '</div>';
      break;
      
    case 'fill-blank':
      html += `
        <p class="quiz-sentence">${question.sentence}</p>
        <input type="text" class="quiz-input" id="blank-answer" placeholder="Type your answer...">
        <button class="quiz-submit-btn" id="submit-blank-btn">Submit</button>
      `;
      break;
      
    case 'translation':
      html += `
        <p class="quiz-word">${question.word}</p>
        <input type="text" class="quiz-input" id="translation-answer" placeholder="Type the translation...">
        <button class="quiz-submit-btn" id="submit-translation-btn">Submit</button>
      `;
      break;
  }
  
  html += '</div>';
  quizContent.innerHTML = html;
  
  // Add event listeners based on question type
  if (question.type === 'multiple-choice') {
    document.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        checkQuizAnswer(e.target.dataset.answer);
      });
    });
  } else if (question.type === 'fill-blank') {
    document.getElementById('submit-blank-btn').addEventListener('click', () => {
      const answer = document.getElementById('blank-answer').value.trim();
      checkQuizAnswer(answer);
    });
    
    // Also allow Enter key
    document.getElementById('blank-answer').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const answer = document.getElementById('blank-answer').value.trim();
        checkQuizAnswer(answer);
      }
    });
  } else if (question.type === 'translation') {
    document.getElementById('submit-translation-btn').addEventListener('click', () => {
      checkTranslationAnswer();
    });
    
    // Also allow Enter key
    document.getElementById('translation-answer').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        checkTranslationAnswer();
      }
    });
  }
}

// Check translation answer (remove from window scope)
async function checkTranslationAnswer() {
  const answer = document.getElementById('translation-answer').value.trim();
  const question = currentQuiz.questions[currentQuiz.currentIndex];
  
  if (!answer) {
    showNotification('Please enter an answer', 'error');
    return;
  }
  
  // If we have translator API, verify the translation
  if (chromeAIAvailable.translator) {
    try {
      const correctTranslation = await translateText(question.word, settings.targetLanguage, settings.nativeLanguage);
      const isCorrect = answer.toLowerCase() === correctTranslation.toLowerCase();
      
      if (isCorrect) {
        currentQuiz.score++;
        showNotification('Correct! 🎉', 'success');
      } else {
        showNotification(`The translation was: ${correctTranslation}`, 'error');
      }
      
      currentQuiz.answers.push({ 
        question: question.question, 
        userAnswer: answer, 
        correctAnswer: correctTranslation, 
        isCorrect 
      });
    } catch (error) {
      console.error('Translation verification error:', error);
      // Accept any answer if translation fails
      currentQuiz.score++;
      currentQuiz.answers.push({ 
        question: question.question, 
        userAnswer: answer, 
        correctAnswer: 'Could not verify', 
        isCorrect: true 
      });
    }
  } else {
    // Without translator, accept any answer
    currentQuiz.score++;
    currentQuiz.answers.push({ 
      question: question.question, 
      userAnswer: answer, 
      correctAnswer: 'Not verified', 
      isCorrect: true 
    });
  }
  
  // Move to next question or show results
  proceedToNextQuestion();
}

function proceedToNextQuestion() {
  if (currentQuiz.currentIndex < currentQuiz.questions.length - 1) {
    currentQuiz.currentIndex++;
    setTimeout(() => displayQuestion(currentQuiz.currentIndex), 1500);
  } else {
    setTimeout(() => showQuizResults(), 1500);
  }
}

// Check quiz answer
function checkQuizAnswer(answer) {
  const question = currentQuiz.questions[currentQuiz.currentIndex];
  const isCorrect = answer === question.correct;
  
  if (isCorrect) {
    currentQuiz.score++;
    showNotification('Correct! 🎉', 'success');
  } else {
    showNotification(`Incorrect. The answer was: ${question.correct}`, 'error');
  }
  
  currentQuiz.answers.push({ question: question.question, answer, isCorrect });
  
  // Move to next question or show results
  if (currentQuiz.currentIndex < currentQuiz.questions.length - 1) {
    currentQuiz.currentIndex++;
    setTimeout(() => displayQuestion(currentQuiz.currentIndex), 1500);
  } else {
    setTimeout(() => showQuizResults(), 1500);
  }
}

// Handle flashcard practice
function startFlashcardPractice(flashcardsData) {
  if (!flashcardsData || flashcardsData.length === 0) {
    showNotification('No flashcards available for practice', 'error');
    return;
  }
  
  // Filter by current target language
  const languageFlashcards = flashcardsData.filter(fc => fc.language === settings.targetLanguage);
  
  if (languageFlashcards.length === 0) {
    showNotification(`No flashcards for ${getLanguageName(settings.targetLanguage)}`, 'error');
    return;
  }
  
  quizMode = true;
  const quizOverlay = document.getElementById('quiz-overlay');
  quizOverlay.style.display = 'flex';
  
  // Pause video
  const video = document.querySelector('video');
  if (video) video.pause();
  
  // Generate quiz from flashcards
  generateFlashcardQuiz(languageFlashcards);
}

// Generate quiz from flashcards
function generateFlashcardQuiz(flashcardsData) {
  const quizQuestions = [];
  
  // Shuffle flashcards
  const shuffledCards = [...flashcardsData].sort(() => Math.random() - 0.5);
  
  // Create multiple choice questions
  for (let i = 0; i < Math.min(5, shuffledCards.length); i++) {
    const card = shuffledCards[i];
    
    // Get wrong answers from other cards
    const wrongAnswers = shuffledCards
      .filter(fc => fc.id !== card.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map(fc => fc.translation);
    
    // Create question
    quizQuestions.push({
      type: 'multiple-choice',
      question: `What does "${card.word}" mean?`,
      options: [...wrongAnswers, card.translation].sort(() => Math.random() - 0.5),
      correct: card.translation
    });
  }
  
  // Start the quiz
  currentQuiz = {
    questions: quizQuestions,
    currentIndex: 0,
    score: 0,
    answers: []
  };
  
  displayQuestion(0);
}

// Show quiz results
function showQuizResults() {
  const quizContent = document.getElementById('quiz-content');
  const percentage = Math.round((currentQuiz.score / currentQuiz.questions.length) * 100);
  
  let html = `
    <div class="quiz-results">
      <h2>Quiz Complete! 🎊</h2>
      <div class="quiz-score">
        <div class="score-circle">
          <span class="score-percentage">${percentage}%</span>
        </div>
        <p>You got ${currentQuiz.score} out of ${currentQuiz.questions.length} correct!</p>
      </div>
      <div class="quiz-review">
        <h3>Review:</h3>
  `;
  
  currentQuiz.answers.forEach((answer, i) => {
    html += `
      <div class="review-item ${answer.isCorrect ? 'correct' : 'incorrect'}">
        <span>${i + 1}. ${answer.question}</span>
        <span>${answer.isCorrect ? '✅' : '❌'} ${answer.answer}</span>
      </div>
    `;
  });
  
  html += `
      </div>
      <button class="quiz-action-btn" onclick="startQuiz()">Try Another Quiz</button>
      <button class="quiz-action-btn secondary" onclick="closeQuiz()">Close</button>
    </div>
  `;
  
  quizContent.innerHTML = html;
  
  // Update stats
  updateQuizStats(currentQuiz.score, currentQuiz.questions.length);
}

// Close quiz
function closeQuiz() {
  document.getElementById('quiz-overlay').style.display = 'none';
  quizMode = false;
}

// Update stats after quiz/translation
function updateQuizStats(correct, total) {
  const incorrect = total - correct;
  
  chrome.storage.sync.get(['stats'], (result) => {
    const stats = result.stats || { correct: 0, incorrect: 0, streak: 0, total: 0 };
    
    stats.correct += correct;
    stats.incorrect += incorrect;
    stats.total += total;
    
    if (correct === total) {
      stats.streak++;
    } else {
      stats.streak = 0;
    }
    
    chrome.storage.sync.set({ stats });
    updateStats();
  });
}

// Update stats display
function updateStats() {
  chrome.storage.sync.get(['stats'], (result) => {
    const stats = result.stats || { correct: 0, incorrect: 0, streak: 0, total: 0 };
    
    document.getElementById('correct-count').textContent = stats.correct;
    document.getElementById('incorrect-count').textContent = stats.incorrect;
    document.getElementById('streak-count').textContent = stats.streak;
    
    const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    document.getElementById('accuracy').textContent = `${accuracy}%`;
  });
}

// Update pause status display
function updatePauseStatus(status) {
  const statusElement = document.getElementById('pause-status');
  if (statusElement) {
    statusElement.textContent = status;
  }
}

// Skip current subtitle
function skipSubtitle() {
  const inputField = document.getElementById('fluentai-input');
  const feedbackDiv = document.getElementById('fluentai-feedback');
  
  if (inputField) {
    inputField.value = '';
    inputField.placeholder = 'Waiting for next subtitle...';
  }
  
  if (feedbackDiv) {
    feedbackDiv.innerHTML = '';
  }
  
  currentSubtitle = '';
  updatePauseStatus('Waiting...');
  
  // Resume video
  const video = document.querySelector('video');
  if (video) {
    video.play();
    console.log('FluentAI: Video resumed after skip');
  }
}

// Toggle auto-pause
function togglePause() {
  settings.autoTranslate = !settings.autoTranslate;
  chrome.storage.sync.set({ autoTranslate: settings.autoTranslate });
  
  const toggleBtn = document.getElementById('toggle-btn');
  if (toggleBtn) {
    toggleBtn.textContent = settings.autoTranslate ? 'Pause ON' : 'Pause OFF';
  }
  
  // Update status
  const statusElement = document.querySelector('.fluentai-status');
  if (statusElement) {
    const statusHTML = statusElement.innerHTML;
    const newHTML = statusHTML.replace(
      /Auto-pause: <strong>(ON|OFF)<\/strong>/,
      `Auto-pause: <strong>${settings.autoTranslate ? 'ON' : 'OFF'}</strong>`
    );
    statusElement.innerHTML = newHTML;
  }
  
  showNotification(`Auto-pause ${settings.autoTranslate ? 'enabled' : 'disabled'}`, 'info');
}

// Show notification
function showNotification(message, type = 'info') {
  let notification = document.querySelector('.fluentai-notification');
  if (!notification) {
    notification = document.createElement('div');
    notification.className = 'fluentai-notification';
    document.body.appendChild(notification);
  }
  
  notification.textContent = message;
  notification.className = `fluentai-notification ${type}`;
  notification.classList.add('show');
  
  setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}

// Get language name
function getLanguageName(code) {
  const languages = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'pt': 'Portuguese',
    'it': 'Italian',
    'ru': 'Russian',
    'ar': 'Arabic',
    'hi': 'Hindi'
  };
  return languages[code] || code.toUpperCase();
}

// Parse Writer API response
function parseWriterResponse(response) {
  // Simple parser - in reality you'd need more robust parsing
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('Error parsing Writer response:', error);
  }
  return generateFallbackQuiz();
}

// **FIXED: Issue #1 - Observe subtitles with configurable delay AFTER segment ends**
function observeSubtitles() {
  const video = document.querySelector('video');
  if (!video) {
    console.error('FluentAI: Video element not found');
    return;
  }

  console.log('FluentAI: Starting subtitle observation with delay:', settings.pauseDelay, 'seconds');

  // Clear any existing interval
  if (videoTimeUpdateInterval) {
    clearInterval(videoTimeUpdateInterval);
  }

  // Monitor video playback
  videoTimeUpdateInterval = setInterval(() => {
    if (!settings.autoTranslate || quizMode) {
      return;
    }

    if (isAdPlaying()) {
      handleNewSubtitle('Ad is playing', 'easter egg');
    }

    else {

    const currentTime = video.currentTime;

    // Find segment that just ended (with configurable delay)
    const justEndedSegment = transcriptSegments.find(segment => {
      const segmentEndWithDelay = segment.end + settings.pauseDelay;
      const isAtEnd = currentTime >= segmentEndWithDelay && currentTime <= segmentEndWithDelay + 0.5;
      const notProcessed = !segmentsProcessed.has(segment.start);
      return isAtEnd && notProcessed;
    });

    // If we found a segment that just ended and video is playing, pause and show it
    if (justEndedSegment && !video.paused && settings.autoTranslate) {
      segmentsProcessed.add(justEndedSegment.start);
      lastProcessedSegment = justEndedSegment;
      
      console.log('FluentAI: Segment ended, pausing for translation:', justEndedSegment.text);
      handleNewSubtitle(justEndedSegment.text, justEndedSegment);
    }

    // Also handle case where user seeks backwards - reset processed segments
    if (lastProcessedSegment && currentTime < lastProcessedSegment.start) {
      // User went backwards, clear processed segments from this point
      segmentsProcessed.clear();
      transcriptSegments.forEach(segment => {
        if (segment.start >= currentTime) {
          segmentsProcessed.delete(segment.start);
        }
      });
      lastProcessedSegment = null;
    }
  }

  }, 300); // Check more frequently for better timing
}

async function initializeTranscript() {
  try {
    showNotification('Opening transcript panel...', 'info');
    
    // Open transcript panel
    await openTranscriptPanel();
    
    // Extract segments
    transcriptSegments = await extractTranscriptFromDOM();
    
    showNotification(`Loaded ${transcriptSegments.length} subtitle segments! Auto-pause is ${settings.autoTranslate ? 'ON' : 'OFF'}`, 'success');
    
    // Start observing video time
    observeSubtitles();
    
    // Update UI status
    // const statusElement = document.querySelector('.fluentai-status');
    // if (statusElement) {
    //   statusElement.innerHTML += `<p>📝 Loaded: <strong>${transcriptSegments.length} segments</strong></p>`;
    // }
    
    return true;
  } catch (error) {
    console.error('FluentAI: Error initializing transcript:', error);
    showNotification(`Error: ${error.message}`, 'error');
    return false;
  }
}

// Handle new subtitle
async function handleNewSubtitle(text, segment) {
  currentSubtitle = text;
  
  // Update display - make it clear this is a review of what was just shown
  const subtitleDisplay = document.getElementById('subtitle-display');
  if (subtitleDisplay) {
    subtitleDisplay.innerHTML = `
      <div class="subtitle-header">🎯 Translate what you just heard:</div>
      <div class="subtitle-content">
        <div class="subtitle-text">${text}</div>
        <button class="speak-btn" id="speak-btn">🔊</button>
      </div>
    `;
    
    // Re-add speak button listener
    document.getElementById('speak-btn')?.addEventListener('click', () => speakSubtitle(text));
  }
  
  // Auto-pause video at the END of subtitle segment
  if (settings.autoTranslate) {
    const video = document.querySelector('video');
    if (video && !isAdPlaying()) {
      setTimeout(() => {
        if (!isAdPlaying()) {
          video.pause();
        }
      }, (settings.pauseDelay || 1) * 1000);
    }
  }
  
  // Show translation input
  const inputField = document.getElementById('fluentai-input');
  if (inputField) {
    inputField.value = '';
    inputField.focus();
    inputField.placeholder = 'Type your translation...';
  }
  
  // Clear previous feedback
  const feedbackDiv = document.getElementById('fluentai-feedback');
  if (feedbackDiv) {
    feedbackDiv.innerHTML = '';
  }
  
  // Update status
  updatePauseStatus('Review & Translate');
  
  console.log('FluentAI: Paused for translation review:', text);
}

// Speak subtitle - only when user clicks audio button
function speakSubtitle(text) {
  if (!text) return;
  
  if (!('speechSynthesis' in window)) {
    showNotification('Text-to-speech not supported in this browser', 'error');
    return;
  }
  
  // Cancel any ongoing speech
  window.speechSynthesis.cancel();
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = settings.targetLanguage;
  utterance.rate = 0.8;
  utterance.pitch = 1;
  
  utterance.onstart = () => {
    showNotification('🔊 Playing audio...', 'info');
  };
  
  utterance.onend = () => {
    console.log('Audio playback finished');
  };
  
  utterance.onerror = (event) => {
    console.error('Speech synthesis error:', event);
    showNotification('Error playing audio', 'error');
  };
  
  window.speechSynthesis.speak(utterance);
}

// Play subtitle audio
function playSubtitleAudio(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve(); // No TTS available, continue anyway
      return;
    }
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = settings.targetLanguage;
    utterance.rate = 0.8;
    utterance.pitch = 1;
    
    utterance.onend = () => {
      resolve();
    };
    
    utterance.onerror = () => {
      resolve(); // Continue even if speech fails
    };
    
    window.speechSynthesis.speak(utterance);
  });
}

// Send notification for practice
function sendPracticeNotification() {
  if (!settings.notificationEnabled || flashcards.length === 0) return;
  
  const randomCard = flashcards[Math.floor(Math.random() * flashcards.length)];
  
  chrome.runtime.sendMessage({
    action: 'showNotification',
    data: {
      title: '🎓 FluentAI Practice',
      message: `How do you say "${randomCard.translation}" in ${getLanguageName(settings.targetLanguage)}?`,
      contextMessage: `Answer: ${randomCard.word}`
    }
  });
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startFlashcardPractice') {
    startFlashcardPractice(request.flashcards);
    sendResponse({ success: true });
  }

  if (request.action === 'settingsUpdated') {
    settings = request.settings;
    
    // Reload settings to get updated pause delay and filter flashcards
    loadSettings().then(() => {
      initializeChromeAI();
      updateAPIStatusDisplay();
      // Update UI with new settings
      if (overlay) {
        document.querySelector('.fluentai-status').innerHTML = `
          <p>🎯 Learning: <strong>${getLanguageName(settings.targetLanguage)}</strong></p>
          <p>📺 Auto-pause: <strong>${settings.autoTranslate ? 'ON' : 'OFF'}</strong></p>
        `;
      }
    });
  }
});

// **FIXED: Issue #2 - Check translation with proper feedback rendering**
async function checkTranslation() {
  const userInput = document.getElementById('fluentai-input')?.value.trim();
  
  console.log('FluentAI: checkTranslation called with input:', userInput);
  console.log('FluentAI: currentSubtitle:', currentSubtitle);
  
  if (!userInput || !currentSubtitle) {
    console.log('FluentAI: Missing input or subtitle');
    return;
  }
  
  const feedbackDiv = document.getElementById('fluentai-feedback');
  if (!feedbackDiv) {
    console.error('FluentAI: Feedback div not found!');
    return;
  }
  
  // Ensure feedback div is visible and has proper structure
  feedbackDiv.style.display = 'block';
  feedbackDiv.style.minHeight = '60px';
  feedbackDiv.innerHTML = '<div class="fluentai-loading">Checking translation...</div>';
  console.log('FluentAI: Showing loading state');
  
  try {
    let correctTranslation = '';
    let isCorrect = false;
    let validationResult = null;
    
    // Try Chrome Translator API first
    if (chromeAIAvailable.translator) {
      console.log('FluentAI: Using Chrome Translator API');
      try {
        correctTranslation = await translateText(currentSubtitle, settings.targetLanguage, settings.nativeLanguage);
        
        const normalizeText = (str) => {
          return str
            .toLowerCase()
            .replace(/[.,!?;:'"]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        };
        
        const normalizedInput = normalizeText(userInput);
        const normalizedCorrect = normalizeText(correctTranslation);
        const similarity = calculateSimilarity(normalizedInput, normalizedCorrect);
        
        console.log('FluentAI: Similarity score:', similarity);
        
        // High similarity - accept immediately (90%+)
        if (similarity >= 0.90) {
          isCorrect = true;
          validationResult = {
            correct: true,
            feedback: 'Perfect! ✅',
            correctAnswer: correctTranslation,
            similarity: Math.round(similarity * 100),
            method: 'exact'
          };
        } 
        // Lower similarity - validate with Gemini if available
        else if (settings.geminiApiKey && settings.useGeminiValidation) {
          console.log('FluentAI: Using Gemini for semantic validation');
          validationResult = await validateWithGemini(
            userInput,
            correctTranslation,
            currentSubtitle,
            settings.targetLanguage,
            settings.nativeLanguage
          );
          validationResult.similarity = Math.round(similarity * 100);
          isCorrect = validationResult.correct;
        }
        // No Gemini - use similarity threshold
        else {
          if (similarity >= 0.85) {
            validationResult = {
              correct: false,
              feedback: 'Very close! 🤔',
              correctAnswer: correctTranslation,
              similarity: Math.round(similarity * 100),
              showGeminiOption: true
            };
          } else if (similarity >= 0.60) {
            validationResult = {
              correct: false,
              feedback: 'Close, but not quite. 🤔',
              correctAnswer: correctTranslation,
              similarity: Math.round(similarity * 100),
              showGeminiOption: true
            };
          } else {
            validationResult = {
              correct: false,
              feedback: 'Not quite right. ❌',
              correctAnswer: correctTranslation,
              similarity: Math.round(similarity * 100),
              showGeminiOption: true
            };
          }
        }
        
      } catch (error) {
        console.error('Chrome Translator error:', error);
      }
    }
    
    // Fallback to Gemini if Chrome AI unavailable
    if (!correctTranslation && settings.geminiApiKey) {
      const response = await translateWithGemini(currentSubtitle);
      if (response) {
        correctTranslation = response;
        const normalizeText = (str) => str.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim();
        isCorrect = normalizeText(userInput) === normalizeText(correctTranslation);
        validationResult = {
          correct: isCorrect,
          feedback: isCorrect ? 'Perfect! ✅' : 'Not quite right. ❌',
          correctAnswer: correctTranslation
        };
      }
    }
    
    // No translation available
    if (!correctTranslation) {
      correctTranslation = `[Translation for: ${currentSubtitle}]`;
      validationResult = {
        correct: false,
        feedback: 'Unable to validate translation.',
        correctAnswer: correctTranslation
      };
    }
    
    // Display feedback
    if (isCorrect) {
      let successMessage = `
        <div class="success">✅ ${validationResult.feedback}</div>
        <div class="correct-answer">"${currentSubtitle}" → "${validationResult.correctAnswer}"</div>
      `;
      
      if (validationResult.chromeWasWrong) {
        successMessage += `<div style="margin-top: 8px; padding: 8px; background: #fef3c7; border-radius: 6px; font-size: 13px; color: #92400e;">
          ⭐ <strong>Great job!</strong> Your translation was more natural than Chrome's literal translation.
        </div>`;
      }
      
      feedbackDiv.innerHTML = successMessage;
      updateQuizStats(1, 1);
      
      if (settings.autoPlayAfterCorrect !== false) {
        setTimeout(() => {
          skipSubtitle();
          if (settings.autoTranslate) {
            document.querySelector('video')?.play();
          }
        }, 4000); // 4 seconds to read Gemini feedback
      } else {
        // Just clear input, don't skip - let user click Next
        document.getElementById('fluentai-input').value = '';
      }

    } else {
      let feedbackMessage = `
        <div class="incorrect">❌ ${validationResult.feedback}</div>
        <div class="correct-answer"><strong>Better translation:</strong> "${validationResult.correctAnswer}"</div>
      `;
      
      if (validationResult.similarity) {
        feedbackMessage += `<div class="similarity">Similarity: ${validationResult.similarity}%</div>`;
      }
      
      if (validationResult.chromeWasWrong) {
        feedbackMessage += `<div style="margin-top: 8px; padding: 8px; background: #fee2e2; border-radius: 6px; font-size: 13px; color: #991b1b;">
          ⚠️ Note: Chrome AI had a less natural translation for this phrase.
        </div>`;
      }

      if (validationResult.showGeminiOption && settings.geminiApiKey && !settings.useGeminiValidation) {
        feedbackMessage += `
          <button id="verify-with-gemini" style="
            width: 100%;
            margin-top: 10px;
            padding: 10px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.2s;
          ">
            🤖 Think this is wrong? Verify with Gemini
          </button>
        `;
      }
      
      feedbackDiv.innerHTML = feedbackMessage;

      const verifyButton = document.getElementById('verify-with-gemini');

      if (verifyButton) {
        verifyButton.addEventListener('click', async () => {
          verifyButton.textContent = '⏳ Checking with Gemini...';
          verifyButton.disabled = true;
          
          const geminiResult = await validateWithGemini(
            userInput,
            correctTranslation,
            currentSubtitle,
            settings.targetLanguage,
            settings.nativeLanguage
          );
          
          let geminiMessage = `
            <div class="${geminiResult.correct ? 'success' : 'incorrect'}">
              ${geminiResult.correct ? '✅' : '❌'} Gemini says: ${geminiResult.feedback}
            </div>
            <div class="correct-answer"><strong>Gemini's translation:</strong> "${geminiResult.correctAnswer}"</div>
          `;
          
          if (geminiResult.chromeWasWrong) {
            geminiMessage += `<div style="margin-top: 8px; padding: 8px; background: #fef3c7; border-radius: 6px; font-size: 13px; color: #92400e;">
              ⭐ Chrome AI's translation was less accurate. Your answer was ${geminiResult.correct ? 'correct' : 'closer'}!
            </div>`;
          }
          
          feedbackDiv.innerHTML = geminiMessage;
          
          // Update stats if Gemini says user was actually correct
          if (geminiResult.correct) {
            updateQuizStats(1, 0); // Add a correct, don't add another attempt
            
            // Handle auto-play if enabled
            if (settings.autoPlayAfterCorrect !== false) {
              setTimeout(() => {
                skipSubtitle();
                if (settings.autoTranslate) {
                  document.querySelector('video')?.play();
                }
              }, 4000); // 4 seconds to read Gemini feedback
            } else {
              // Just clear input, don't skip - let user click Next
              document.getElementById('fluentai-input').value = '';
            }
          }
        });
      }

      updateQuizStats(0, 1);
    }
    
  } catch (error) {
    console.error('Translation check error:', error);
    feedbackDiv.innerHTML = `
      <div class="error">Error checking translation. Please try again.</div>
      <div class="correct-answer">Original: "${currentSubtitle}"</div>
    `;
  }
}

// Translate with Gemini API
async function translateWithGemini(text) {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${settings.geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': settings.geminiApiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Translate this ${getLanguageName(settings.targetLanguage)} text to ${getLanguageName(settings.nativeLanguage)}. Only provide the translation, nothing else: "${text}"`
          }]
        }]
      })
    });
    
    const data = await response.json();
    return data.candidates[0].content.parts[0].text.trim();
  } catch (error) {
    console.error('Gemini translation error:', error);
    return null;
  }
}

// Validate translation semantically with Gemini
async function validateWithGemini(userAnswer, chromeTranslation, sourceText, sourceLang, targetLang) {
  try {
    const prompt = `You are a language learning tutor. Evaluate this translation exercise.

    SOURCE TEXT (${getLanguageName(sourceLang)}): "${sourceText}"
    CHROME AI TRANSLATION (${getLanguageName(targetLang)}): "${chromeTranslation}"
    STUDENT ANSWER (${getLanguageName(targetLang)}): "${userAnswer}"

    Tasks:
    1. Is the student's answer correct? (Consider natural phrasing, not just literal translation)
    2. Is Chrome AI's translation accurate? (It sometimes does literal word-by-word translations)
    3. Provide constructive feedback for the student

    Respond with JSON only, no other text:
    {
      "studentCorrect": true or false,
      "chromeCorrect": true or false,
      "bestTranslation": "the most natural translation",
      "feedback": "encouraging feedback for student (2-3 sentences max)",
      "confidence": 0-100
    }`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${settings.geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': settings.geminiApiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      })
    });
    
    const data = await response.json();
    const resultText = data.candidates[0].content.parts[0].text.trim();
    
    // Extract JSON from response (remove markdown code blocks if present)
    let jsonText = resultText;
    if (resultText.includes('```json')) {
      jsonText = resultText.split('```json')[1].split('```')[0].trim();
    } else if (resultText.includes('```')) {
      jsonText = resultText.split('```')[1].split('```')[0].trim();
    }
    
    const result = JSON.parse(jsonText);
    
    return {
      correct: result.studentCorrect,
      feedback: result.feedback,
      correctAnswer: result.bestTranslation,
      chromeWasWrong: !result.chromeCorrect,
      confidence: result.confidence
    };
  } catch (error) {
    console.error('Gemini validation error:', error);
    return {
      correct: false,
      feedback: 'Unable to validate. Try: ' + chromeTranslation,
      correctAnswer: chromeTranslation,
      chromeWasWrong: false,
      method: 'fallback',
      error: true
    };
  }
}

// Calculate similarity between two strings
function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / parseFloat(longer.length);
}

// Levenshtein distance algorithm
function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}
// Extract unique vocabulary from transcript
async function extractVocabularyFromTranscript() {
  if (!transcriptSegments || transcriptSegments.length === 0) {
    showNotification('Please load subtitles first', 'error');
    return [];
  }
  
  const fullText = transcriptSegments.map(seg => seg.text).join(' ');
  
  try {
    const prompt = `You are a language learning assistant. Extract the most useful vocabulary words from this ${getLanguageName(settings.targetLanguage)} text for a language learner.

TEXT: "${fullText}"

Extract 15-25 important words or short phrases (2-3 words max) that:
1. Are commonly used in conversations
2. Are appropriate for ${settings.difficulty || 'intermediate'} level learners
3. Are NOT basic words like "the", "is", "a", etc.
4. Include verbs, nouns, adjectives, and useful expressions
5. Are actually in ${getLanguageName(settings.targetLanguage)} (validate language)

Respond with JSON only:
{
  "vocabulary": [
    {
      "word": "word in ${getLanguageName(settings.targetLanguage)}",
      "category": "verb/noun/adjective/expression",
      "difficulty": "beginner/intermediate/advanced"
    }
  ]
}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${settings.geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2000 }
      })
    });
    
    const data = await response.json();
    const resultText = data.candidates[0].content.parts[0].text.trim();
    
    let jsonText = resultText;
    if (resultText.includes('```json')) {
      jsonText = resultText.split('```json')[1].split('```')[0].trim();
    } else if (resultText.includes('```')) {
      jsonText = resultText.split('```')[1].split('```')[0].trim();
    }
    
    const result = JSON.parse(jsonText);
    return result.vocabulary || [];
  } catch (error) {
    console.error('Error extracting vocabulary:', error);
    showNotification('Error extracting vocabulary', 'error');
    return [];
  }
}

// Check if a word already exists in flashcards
function isWordInFlashcards(word) {
  const normalizedWord = word.toLowerCase().trim();
  return flashcards.some(card => 
    card.word.toLowerCase().trim() === normalizedWord ||
    card.translation.toLowerCase().trim() === normalizedWord
  );
}

// Validate and enrich vocabulary with Gemini
async function validateAndEnrichVocabulary(vocabularyList) {
  if (!vocabularyList || vocabularyList.length === 0) return [];
  
  const newWords = vocabularyList.filter(item => !isWordInFlashcards(item.word));
  
  if (newWords.length === 0) {
    showNotification('All extracted words are already in your flashcards!', 'success');
    return [];
  }
  
  try {
    const wordsToValidate = newWords.map(item => item.word).join(', ');
    
    const prompt = `You are a language learning assistant. Validate and translate these ${getLanguageName(settings.targetLanguage)} words to ${getLanguageName(settings.nativeLanguage)}.

WORDS TO VALIDATE: ${wordsToValidate}

For each word:
1. Verify it's actually in ${getLanguageName(settings.targetLanguage)} (if not, skip it)
2. Provide accurate translation to ${getLanguageName(settings.nativeLanguage)}
3. Add a brief, helpful description or usage note (1 sentence)
4. Provide a simple example sentence in ${getLanguageName(settings.targetLanguage)}

Respond with JSON only:
{
  "validatedWords": [
    {
      "word": "${getLanguageName(settings.targetLanguage)} word",
      "translation": "${getLanguageName(settings.nativeLanguage)} translation",
      "description": "brief usage note",
      "example": "example sentence in ${getLanguageName(settings.targetLanguage)}",
      "confidence": 0-100
    }
  ]
}

Only include words with confidence > 70.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${settings.geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 3000 }
      })
    });
    
    const data = await response.json();
    const resultText = data.candidates[0].content.parts[0].text.trim();
    
    let jsonText = resultText;
    if (resultText.includes('```json')) {
      jsonText = resultText.split('```json')[1].split('```')[0].trim();
    } else if (resultText.includes('```')) {
      jsonText = resultText.split('```')[1].split('```')[0].trim();
    }
    
    const result = JSON.parse(jsonText);
    return result.validatedWords || [];
  } catch (error) {
    console.error('Error validating vocabulary:', error);
    return newWords.map(item => ({
      word: item.word,
      translation: '',
      description: 'Translation not available',
      example: '',
      confidence: 50
    }));
  }
}

// Initialize extension
async function init() {
  injectPageScript();
  await initializeDB();
  await loadSettings();
  createOverlay();
  addTranscriptButton();
  updateAPIStatusDisplay();
  setTimeout(async () => {
    if (isEnabled) {
      await initializeTranscript();
    }
  }, 3000);
  
  // Set up periodic notifications
  if (settings.notificationEnabled) {
    setInterval(() => {
      sendPracticeNotification();
    }, settings.quizFrequency * 60 * 1000);
  }
}

function addTranscriptButton() {
  // Add to your overlay UI
  const translateTab = document.getElementById('translate-tab');
  if (translateTab) {
    const loadButton = document.createElement('button');
    loadButton.className = 'action-btn';
    loadButton.id = 'load-transcript-btn';
    loadButton.textContent = '📝 Load Subtitles';
    loadButton.style.marginTop = '10px';
    
    loadButton.addEventListener('click', async () => {
      loadButton.disabled = true;
      loadButton.textContent = 'Loading...';
      
      const success = await initializeTranscript();
      
      if (success) {
        loadButton.textContent = '✅ Subtitles Loaded';
      } else {
        loadButton.disabled = false;
        loadButton.textContent = '📝 Retry Load Subtitles';
      }
    });
    
    // Insert after the exercise div
    const exerciseDiv = document.querySelector('.fluentai-exercise');
    if (exerciseDiv) {
      exerciseDiv.insertAdjacentElement('afterend', loadButton);
    }
  }
}

// Wait for page to load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Check if an ad is currently playing
function isAdPlaying() {
  // Check for ad-showing class on video player
  const player = document.querySelector('.html5-video-player');
  if (player && player.classList.contains('ad-showing')) {
    return true;
  }
  return false;
}

function updateAPIStatusDisplay() {
  // Update Chrome AI status in Status tab
  document.getElementById('translator-status').innerHTML = 
    `🌐 Translator: <strong>${chromeAIAvailable.translator ? '✅ Ready' : '❌ Not available'}</strong>`;
  document.getElementById('detector-status').innerHTML = 
    `🔍 Language Detector: <strong>${chromeAIAvailable.languageDetector ? '✅ Ready' : '❌ Not available'}</strong>`;
  document.getElementById('summarizer-status').innerHTML = 
    `📝 Summarizer: <strong>${chromeAIAvailable.summarizer ? '✅ Ready' : '❌ Not available'}</strong>`;
  document.getElementById('writer-status').innerHTML = 
    `✍️ Writer: <strong>${chromeAIAvailable.writer ? '✅ Ready' : '❌ Not available'}</strong>`;
  
  // Update Gemini status
  document.getElementById('gemini-status').innerHTML = 
    `🔑 API Key: <strong>${settings.geminiApiKey ? '✅ Set' : '❌ Not set'}</strong>`;
}// Show vocabulary selection UI
async function showVocabularySelector(validatedWords) {
  if (!validatedWords || validatedWords.length === 0) {
    showNotification('No new vocabulary found', 'info');
    return;
  }
  
  const vocabTab = document.getElementById('vocabulary-tab');
  if (!vocabTab) return;
  
  vocabTab.innerHTML = `
    <div class="vocab-extraction">
      <h3>📚 Found ${validatedWords.length} New Words</h3>
      <p class="vocab-subtitle">Select words to add to your flashcards</p>
      
      <div class="vocab-actions">
        <button id="select-all-vocab" class="action-btn">Select All</button>
        <button id="deselect-all-vocab" class="action-btn">Deselect All</button>
        <button id="add-selected-vocab" class="primary-btn">Add Selected (0)</button>
      </div>
      
      <div id="vocab-list" class="vocab-list"></div>
    </div>
  `;
  
  const vocabList = document.getElementById('vocab-list');
  const addSelectedBtn = document.getElementById('add-selected-vocab');
  
  validatedWords.forEach((item, index) => {
    const vocabItem = document.createElement('div');
    vocabItem.className = 'vocab-item';
    vocabItem.innerHTML = `
      <input type="checkbox" id="vocab-${index}" class="vocab-checkbox" data-index="${index}" checked>
      <div class="vocab-content">
        <div class="vocab-word">
          <strong>${item.word}</strong>
          <span class="confidence-badge">${item.confidence}% confident</span>
        </div>
        <div class="vocab-translation">${item.translation || 'Translation pending...'}</div>
        <div class="vocab-description">${item.description || ''}</div>
        ${item.example ? `<div class="vocab-example">💬 ${item.example}</div>` : ''}
      </div>
    `;
    vocabList.appendChild(vocabItem);
  });
  
  function updateSelectedCount() {
    const selected = document.querySelectorAll('.vocab-checkbox:checked').length;
    addSelectedBtn.textContent = `Add Selected (${selected})`;
    addSelectedBtn.disabled = selected === 0;
  }
  
  updateSelectedCount();
  
  document.getElementById('select-all-vocab').addEventListener('click', () => {
    document.querySelectorAll('.vocab-checkbox').forEach(cb => cb.checked = true);
    updateSelectedCount();
  });
  
  document.getElementById('deselect-all-vocab').addEventListener('click', () => {
    document.querySelectorAll('.vocab-checkbox').forEach(cb => cb.checked = false);
    updateSelectedCount();
  });
  
  vocabList.addEventListener('change', updateSelectedCount);
  
  addSelectedBtn.addEventListener('click', async () => {
    const selectedCheckboxes = document.querySelectorAll('.vocab-checkbox:checked');
    const selectedWords = Array.from(selectedCheckboxes).map(cb => {
      const index = parseInt(cb.dataset.index);
      return validatedWords[index];
    });
    
    if (selectedWords.length === 0) return;
    
    addSelectedBtn.disabled = true;
    addSelectedBtn.textContent = 'Adding...';
    
    for (const item of selectedWords) {
      const flashcard = {
        word: item.word,
        translation: item.translation,
        context: item.example || '',
        addedDate: Date.now(),
        reviewCount: 0,
        correctCount: 0,
        lastReview: null,
        nextReview: Date.now(),
        description: item.description || ''
      };
      
      flashcards.push(flashcard);
    }
    
    await chrome.storage.sync.set({ flashcards });
    
    showNotification(`Added ${selectedWords.length} words to flashcards!`, 'success');
    
    vocabTab.innerHTML = `
      <div class="success-message">
        <h3>✅ Success!</h3>
        <p>${selectedWords.length} words added to your flashcards</p>
        <button id="extract-more-vocab" class="primary-btn">Extract More Words</button>
      </div>
    `;
    
    document.getElementById('extract-more-vocab').addEventListener('click', extractAndShowVocabulary);
  });
  
  switchTab('vocab');
}

// Main function to extract and show vocabulary
async function extractAndShowVocabulary() {
  if (!settings.geminiApiKey) {
    showNotification('Please set your Gemini API key in settings', 'error');
    switchTab('settings');
    return;
  }
  
  if (!transcriptSegments || transcriptSegments.length === 0) {
    showNotification('Please load subtitles first', 'error');
    return;
  }
  
  const vocabTab = document.getElementById('vocabulary-tab');
  if (vocabTab) {
    vocabTab.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <h3>🔍 Analyzing Video Vocabulary...</h3>
        <p>Extracting unique words from subtitles</p>
      </div>
    `;
    switchTab('vocab');
  }
  
  const vocabulary = await extractVocabularyFromTranscript();
  
  if (vocabulary.length === 0) {
    vocabTab.innerHTML = `
      <div class="error-message">
        <h3>❌ No Vocabulary Found</h3>
        <p>Unable to extract vocabulary from this video</p>
        <button id="retry-extraction" class="primary-btn">Try Again</button>
      </div>
    `;
    document.getElementById('retry-extraction').addEventListener('click', extractAndShowVocabulary);
    return;
  }
  
  vocabTab.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <h3>✨ Validating & Translating...</h3>
      <p>Found ${vocabulary.length} words, checking translations</p>
    </div>
  `;
  
  const validatedWords = await validateAndEnrichVocabulary(vocabulary);
  
  await showVocabularySelector(validatedWords);
}

// ============================================================================
// CHROME AI TRANSLATOR READINESS CHECK & FALLBACK SYSTEM
// ============================================================================

// Check if Chrome AI Translator is ready for a language pair
async function checkTranslatorReadiness(sourceLang, targetLang) {
  try {
    const result = await chromeAIBridge('checkTranslatorReady', {
      sourceLanguage: sourceLang,
      targetLanguage: targetLang
    });
    
    return result;
  } catch (error) {
    console.error('Error checking translator readiness:', error);
    return { ready: false, status: 'error' };
  }
}

// Wait for translator to download (with progress updates)
async function waitForTranslatorDownload(sourceLang, targetLang, onProgress) {
  console.log(`Waiting for ${sourceLang} → ${targetLang} translator to download...`);
  
  const maxWaitTime = 60000; // 60 seconds max
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime) {
    const status = await checkTranslatorReadiness(sourceLang, targetLang);
    
    if (status.ready) {
      console.log('Translator is ready!');
      return true;
    }
    
    if (status.status === 'downloading') {
      if (onProgress) {
        onProgress(status.progress || 0);
      }
    }
    
    // Wait 1 second before checking again
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.warn('Translator download timeout');
  return false;
}

// Improved translation function with fallbacks
async function translateWordSmart(word, sourceLang, targetLang) {
  console.log(`Translating: "${word}" (${sourceLang} → ${targetLang})`);
  
  // Strategy 1: Try Chrome AI Translator
  try {
    const result = await chromeAIBridge('translate', {
      text: word,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang
    });
    
    if (result.success && result.translation) {
      const translation = result.translation.trim();
      
      // Check if translation actually happened (not just echoing input)
      if (translation.toLowerCase() !== word.toLowerCase()) {
        console.log(`✅ Chrome AI Translator: "${word}" → "${translation}"`);
        return {
          translation: translation,
          confidence: 80,
          source: 'chrome-ai-translator',
          method: 'direct'
        };
      } else {
        console.warn(`⚠️ Chrome AI returned unchanged: "${word}" → "${translation}"`);
      }
    }
  } catch (error) {
    console.error('Chrome AI Translator error:', error);
  }
  
  // Strategy 2: Try Chrome AI Writer as fallback
  if (chromeAIAvailable.writer) {
    try {
      console.log(`Trying Chrome AI Writer fallback for "${word}"...`);
      
      const prompt = `Translate the ${sourceLang} word "${word}" to ${targetLang}. 
Provide ONLY the ${targetLang} translation, nothing else. 
Do not include the original word, explanations, or punctuation.`;
      
      const result = await chromeAIBridge('generateContent', {
        prompt: prompt,
        context: `Simple word translation: ${sourceLang} to ${targetLang}`
      });
      
      if (result.success && result.content) {
        const translation = result.content.trim()
          .replace(/['"`.]/g, '') // Remove quotes and punctuation
          .split('\n')[0] // Take first line only
          .trim();
        
        if (translation && translation.toLowerCase() !== word.toLowerCase()) {
          console.log(`✅ Chrome AI Writer: "${word}" → "${translation}"`);
          return {
            translation: translation,
            confidence: 75,
            source: 'chrome-ai-writer',
            method: 'fallback'
          };
        }
      }
    } catch (error) {
      console.error('Chrome AI Writer error:', error);
    }
  }
  
  // Strategy 3: Try Gemini if available
  if (settings.geminiApiKey) {
    try {
      console.log(`Trying Gemini fallback for "${word}"...`);
      
      const prompt = `Translate this ${sourceLang} word to ${targetLang}: "${word}"
Respond with ONLY the ${targetLang} translation. One word or short phrase only, no explanation.`;
      
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${settings.geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 50
          }
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const translation = data.candidates[0].content.parts[0].text.trim()
          .replace(/['"`.]/g, '')
          .split('\n')[0]
          .trim();
        
        if (translation && translation.toLowerCase() !== word.toLowerCase()) {
          console.log(`✅ Gemini: "${word}" → "${translation}"`);
          return {
            translation: translation,
            confidence: 90,
            source: 'gemini-direct',
            method: 'fallback'
          };
        }
      }
    } catch (error) {
      console.error('Gemini translation error:', error);
    }
  }
  
  // Strategy 4: Last resort - return original with warning
  console.error(`❌ All translation methods failed for "${word}"`);
  return {
    translation: word,
    confidence: 20,
    source: 'failed',
    method: 'none',
    error: true
  };
}

// Improved batch translation with smart fallbacks
async function translateWordsWithSmartFallback(words, onProgress) {
  console.log('Phase 2: Smart Translation with Fallbacks...');
  
  // First, check if translator is ready
  const translatorStatus = await checkTranslatorReadiness(
    settings.targetLanguage,
    settings.nativeLanguage
  );
  
  if (translatorStatus.status === 'after-download') {
    console.log('Translator needs to download...');
    showNotification('Downloading translation model, please wait...', 'info');
    
    const downloaded = await waitForTranslatorDownload(
      settings.targetLanguage,
      settings.nativeLanguage,
      (progress) => {
        if (onProgress) {
          onProgress(`Downloading translator: ${progress}%`);
        }
      }
    );
    
    if (!downloaded) {
      showNotification('Translator download timeout, using fallback methods', 'warning');
    }
  }
  
  const translations = [];
  const totalWords = words.length;
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    
    if (onProgress) {
      onProgress(`Translating ${i + 1}/${totalWords}: "${word}"`);
    }
    
    const result = await translateWordSmart(
      word,
      settings.targetLanguage,
      settings.nativeLanguage
    );
    
    if (!result.error) {
      translations.push({
        original: word,
        translation: result.translation,
        confidence: result.confidence,
        source: result.source,
        method: result.method
      });
    } else {
      console.warn(`Skipping word "${word}" - all translation methods failed`);
    }
    
    // Small delay to avoid overwhelming APIs
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`Successfully translated ${translations.length}/${totalWords} words`);
  
  return translations;
}
