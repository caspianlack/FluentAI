// Main orchestration: settings, overlay UI, event wiring, and init.
// All logic lives in the specialised modules loaded before this file.

async function loadSettings() {
  const result = await chrome.storage.sync.get([
    'nativeLanguage', 'targetLanguage', 'autoTranslate', 'geminiApiKey',
    'quizFrequency', 'notificationEnabled', 'pauseDelay',
    'useGeminiValidation', 'autoPlayAfterCorrect', 'theme'
  ]);

  settings = {
    nativeLanguage: result.nativeLanguage || 'en',
    targetLanguage: result.targetLanguage || 'fr',
    autoTranslate: result.autoTranslate !== false,
    geminiApiKey: result.geminiApiKey || '',
    quizFrequency: result.quizFrequency || 5,
    notificationEnabled: result.notificationEnabled !== false,
    pauseDelay: result.pauseDelay !== undefined ? result.pauseDelay : 0.0,
    useGeminiValidation: result.useGeminiValidation !== false,
    autoPlayAfterCorrect: result.autoPlayAfterCorrect !== false,
    theme: result.theme || 'theme-ink'
  };

  try {
    flashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
  } catch (e) {
    console.error('Error loading flashcards:', e);
    flashcards = [];
  }

  await initializeChromeAI();
}

function createOverlay() {
  if (overlay) return;

  overlay = document.createElement('div');
  overlay.id = 'fluentai-overlay';
  overlay.innerHTML = `
    <!-- Side Panel -->
    <div class="fluentai-panel" id="side-panel">
      <div class="fluentai-header">
        <span class="fluentai-logo">FluentAI</span>
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
          <div class="fluentai-exercise">
            <div class="fluentai-subtitle" id="subtitle-display">
              <span class="subtitle-text">Waiting for subtitles...</span>
              <button class="speak-btn" id="speak-btn">🔊</button>
            </div>
            <input type="text" id="fluentai-input" placeholder="Type the translation..." />
            <div class="button-box">
              <button id="fluentai-submit">Check Translation</button>
              <button class="fluentai-skip-btn" id="skip-btn">Skip</button>
            </div>
            <div class="fluentai-feedback" id="fluentai-feedback"></div>
          </div>
        </div>

        <!-- Vocabulary Tab -->
        <div class="tab-content" id="vocabulary-tab" style="display: none;">
          <div class="vocabulary-header">
            <h3>📚 My Flashcards</h3>
            <div class="vocabulary-stats">
              <p>🎯 Total Cards: <span id="flashcard-count">0</span></p>
              <p>🌐 Language: <strong>${getLanguageName(settings.targetLanguage)}</strong></p>
            </div>
          </div>
          <div class="flashcard-actions">
            <button class="action-btn" id="add-new-card-btn">➕ Add New Card</button>
            <button class="action-btn primary-btn" id="practice-now-btn">📝 Practice Now</button>
            <button class="action-btn" id="export-flashcards-btn">📥 Export</button>
            <button class="action-btn" id="import-flashcards-btn">📤 Import</button>
          </div>
          <button class="action-btn" id="extract-vocab-btn" style="margin-top: 15px;">
            🎬 Extract Vocabulary from Video
          </button>
          <div class="search-container">
            <input type="text" id="flashcard-search" placeholder="Search existing words..." />
          </div>
          <div class="flashcard-list" id="flashcard-list">
            <p class="empty-state">No flashcards yet. Add your first one or extract vocabulary from YouTube videos!</p>
          </div>
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
            <h3>🎨 Theme</h3>
            <div class="theme-swatches">
              <button class="theme-swatch" data-theme="theme-ink">
                <div class="swatch-preview swatch-ink"></div>
                <span>Ink</span>
              </button>
              <button class="theme-swatch" data-theme="theme-midnight">
                <div class="swatch-preview swatch-midnight"></div>
                <span>Midnight</span>
              </button>
              <button class="theme-swatch" data-theme="theme-warm">
                <div class="swatch-preview swatch-warm"></div>
                <span>Warm</span>
              </button>
              <button class="theme-swatch" data-theme="theme-forest">
                <div class="swatch-preview swatch-forest"></div>
                <span>Forest</span>
              </button>
            </div>
          </div>

          <div class="fluentai-status">
            <h3>Learning Settings</h3>
            <p>🎯 Learning: <strong>${getLanguageName(settings.targetLanguage)}</strong></p>
            <p>🗣️ Native: <strong>${getLanguageName(settings.nativeLanguage)}</strong></p>
            <p>📺 Auto-pause: <strong>${settings.autoTranslate ? 'ON' : 'OFF'}</strong></p>
            <p>⏱️ Pause delay: <strong>${settings.pauseDelay || 0}s</strong></p>
            <p>🤖 Gemini validation: <strong>${settings.useGeminiValidation !== false ? 'ON' : 'OFF'}</strong></p>
            <p>▶️ Auto-play after correct: <strong>${settings.autoPlayAfterCorrect !== false ? 'ON' : 'OFF'}</strong></p>
          </div>

          <div class="fluentai-status" style="margin-top: 10px;">
            <h3>Chrome AI Status</h3>
            <p id="translator-status">🌐 Translator: <strong>⏳ Checking...</strong></p>
            <p id="detector-status">🔍 Language Detector: <strong>⏳ Checking...</strong></p>
            <p id="summarizer-status">📝 Summarizer: <strong>⏳ Checking...</strong></p>
            <p id="writer-status">✍️ Writer: <strong>⏳ Checking...</strong></p>
          </div>

          <div class="fluentai-status" style="margin-top: 10px;">
            <h3>Storage Status</h3>
            <p id="indexeddb-status">💾 IndexedDB: <strong>⏳ Checking...</strong></p>
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
        <div class="quiz-content" id="quiz-content"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  setupEventListeners();
  updateStats();
  updateIndexedDBStatus();
}

function applyTheme(themeName) {
  if (!overlay) return;
  overlay.className = overlay.className.split(' ').filter(c => !c.startsWith('theme-')).join(' ');
  overlay.classList.add(themeName);
  settings.theme = themeName;
  document.querySelectorAll('.theme-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.theme === themeName);
  });
  chrome.storage.sync.set({ theme: themeName });
}

function setupEventListeners() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
  });

  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  document.getElementById('collapse-btn')?.addEventListener('click', collapsePanel);
  document.getElementById('expand-btn')?.addEventListener('click', expandPanel);
  document.getElementById('toggle-btn')?.addEventListener('click', togglePause);
  document.getElementById('fluentai-submit')?.addEventListener('click', checkTranslation);
  document.getElementById('skip-btn')?.addEventListener('click', skipSubtitle);
  document.getElementById('speak-btn')?.addEventListener('click', () => speakSubtitle(currentSubtitle));

  document.getElementById('extract-vocab-btn')?.addEventListener('click', extractAndShowVocabulary);
  document.getElementById('start-quiz-btn')?.addEventListener('click', startQuiz);
  document.getElementById('quiz-close-btn')?.addEventListener('click', closeQuiz);

  document.getElementById('fluentai-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') checkTranslation();
  });

  document.getElementById('refresh-status-btn')?.addEventListener('click', async () => {
    await initializeChromeAI();
    updateAPIStatusDisplay();
    updateIndexedDBStatus();
    showNotification('Status refreshed!', 'success');
  });

  document.getElementById('add-new-card-btn')?.addEventListener('click', showAddCardModal);
  document.getElementById('practice-now-btn')?.addEventListener('click', startPracticeFromOverlay);
  document.getElementById('export-flashcards-btn')?.addEventListener('click', exportFlashcards);
  document.getElementById('import-flashcards-btn')?.addEventListener('click', importFlashcards);
  document.getElementById('flashcard-search')?.addEventListener('input', searchFlashcards);

  loadFlashcardList();
}

function switchTab(tabName) {
  const targetTab = document.getElementById(`${tabName}-tab`);
  if (!targetTab) { console.warn(`Tab "${tabName}-tab" not found`); return; }
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  targetTab.style.display = 'block';
}

function collapsePanel() {
  document.getElementById('side-panel').style.display = 'none';
  document.getElementById('collapsed-panel').style.display = 'block';
}

function expandPanel() {
  document.getElementById('side-panel').style.display = 'block';
  document.getElementById('collapsed-panel').style.display = 'none';
}

function togglePause() {
  settings.autoTranslate = !settings.autoTranslate;
  chrome.storage.sync.set({ autoTranslate: settings.autoTranslate });
  const toggleBtn = document.getElementById('toggle-btn');
  if (toggleBtn) toggleBtn.textContent = settings.autoTranslate ? 'Pause ON' : 'Pause OFF';
  showNotification(`Auto-pause ${settings.autoTranslate ? 'enabled' : 'disabled'}`, 'info');
}

function skipSubtitle() {
  const inputField = document.getElementById('fluentai-input');
  const feedbackDiv = document.getElementById('fluentai-feedback');
  if (inputField) { inputField.value = ''; inputField.placeholder = 'Waiting for next subtitle...'; }
  if (feedbackDiv) feedbackDiv.innerHTML = '';
  currentSubtitle = '';
  updatePauseStatus('Waiting...');
  document.querySelector('video')?.play();
}

function updatePauseStatus(status) {
  const el = document.getElementById('pause-status');
  if (el) el.textContent = status;
}

function showNotification(message, type) {
  type = type || 'info';
  let notification = document.querySelector('.fluentai-notification');
  if (!notification) {
    notification = document.createElement('div');
    notification.className = 'fluentai-notification';
    document.body.appendChild(notification);
  }
  notification.textContent = message;
  notification.className = `fluentai-notification ${type}`;
  notification.classList.add('show');
  setTimeout(() => notification.classList.remove('show'), 3000);
}

function sendPracticeNotification() {
  if (!settings.notificationEnabled || flashcards.length === 0) return;
  const randomCard = flashcards[Math.floor(Math.random() * flashcards.length)];
  chrome.runtime.sendMessage({
    action: 'showNotification',
    data: {
      title: '🎓 FluentAI Practice',
      message: `How do you say "${randomCard.translations[0]}" in ${getLanguageName(settings.targetLanguage)}?`,
      contextMessage: `Answer: ${randomCard.word}`
    }
  });
}

function addTranscriptButton() {
  const translateTab = document.getElementById('translate-tab');
  if (!translateTab) return;

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

  const exerciseDiv = document.querySelector('.fluentai-exercise');
  if (exerciseDiv) exerciseDiv.insertAdjacentElement('afterend', loadButton);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startFlashcardPractice') {
    startFlashcardPractice(request.flashcards);
    sendResponse({ success: true });
  }

  if (request.action === 'settingsUpdated') {
    loadSettings().then(() => {
      initializeChromeAI();
      updateAPIStatusDisplay();
    });
  }
});

async function init() {
  injectPageScript();
  await flashcardDB.waitForReady();
  await loadSettings();
  createOverlay();
  applyTheme(settings.theme || 'theme-ink');
  addTranscriptButton();
  updateAPIStatusDisplay();

  setTimeout(async () => {
    if (isEnabled) await initializeTranscript();
  }, 3000);

  if (settings.notificationEnabled) {
    setInterval(sendPracticeNotification, settings.quizFrequency * 60 * 1000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
