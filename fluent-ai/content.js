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

// Helper function to detect language using the bridge
async function detectLanguage(text) {
  if (!chromeAIAvailable.languageDetector) {
    throw new Error('Chrome Language Detector API not available');
  }
  
  const result = await chromeAIBridge('detectLanguage', { text });
  
  if (result.success) {
    return result.results;
  } else {
    throw new Error(result.error || 'Language detection failed');
  }
}

// Helper function to summarize text using the bridge
async function summarizeContent(text, type = 'key-points', length = 'short') {
  if (!chromeAIAvailable.summarizer) {
    throw new Error('Chrome Summarizer API not available');
  }
  
  const result = await chromeAIBridge('summarize', { text, type, length });
  
  if (result.success) {
    return result.summary;
  } else {
    throw new Error(result.error || 'Summarization failed');
  }
}

// Helper function to generate content using the bridge
async function generateWithAI(prompt, context = '') {
  if (!chromeAIAvailable.writer) {
    throw new Error('Chrome Writer API not available');
  }
  
  const result = await chromeAIBridge('generateContent', { prompt, context });
  
  if (result.success) {
    return result.content;
  } else {
    throw new Error(result.error || 'Content generation failed');
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
    'flashcards',
    'quizFrequency',
    'notificationEnabled',
    'pauseDelay' // NEW: configurable pause delay
  ]);
  
  settings = {
    nativeLanguage: result.nativeLanguage || 'en',
    targetLanguage: result.targetLanguage || 'es',
    autoTranslate: result.autoTranslate !== false,
    geminiApiKey: result.geminiApiKey || '',
    flashcards: result.flashcards || [],
    quizFrequency: result.quizFrequency || 5, // minutes
    notificationEnabled: result.notificationEnabled !== false,
    pauseDelay: result.pauseDelay !== undefined ? result.pauseDelay : 1.0 // Default 1 second
  };
  
  // Filter flashcards by target language
  flashcards = (settings.flashcards || []).filter(card => card.language === settings.targetLanguage);
  console.log(`FluentAI: Loaded ${flashcards.length} flashcards for ${settings.targetLanguage}`);
  
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
        <span class="fluentai-logo">🎓 FluentAI Pro</span>
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

// Extract vocabulary from current subtitles
async function extractVocabulary() {
  if (!currentSubtitle) {
    showNotification('No subtitle available', 'error');
    return;
  }
  
  const words = currentSubtitle.split(/\s+/).filter(word => {
    // Filter out common words and punctuation
    return word.length > 2 && !/^\W+$/.test(word);
  });
  
  // Add unique words to vocabulary
  for (const word of words) {
    const cleanWord = word.replace(/[^\w\s]/g, '').toLowerCase();
    if (cleanWord) {
      vocabularySet.add(cleanWord);
    }
  }
  
  updateVocabularyDisplay();
  
  // Try to translate each word if Chrome Translator is available
  if (chromeAIAvailable.translator) {
    const vocabList = document.getElementById('vocab-list');
    vocabList.innerHTML = '';
    
    for (const word of vocabularySet) {
      try {
        const translation = await translateText(word);
        const vocabItem = document.createElement('div');
        vocabItem.className = 'vocab-item';
        vocabItem.innerHTML = `
          <span class="vocab-word">${word}</span>
          <span class="vocab-translation">${translation}</span>
          <button class="add-flashcard-btn" data-word="${word}" data-translation="${translation}">+📇</button>
        `;
        vocabList.appendChild(vocabItem);
      } catch (error) {
        console.error('Translation error for word:', word, error);
      }
    }
    
    // Add flashcard buttons listeners
    document.querySelectorAll('.add-flashcard-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        addToFlashcards(e.target.dataset.word, e.target.dataset.translation);
      });
    });
  }
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
    const statusElement = document.querySelector('.fluentai-status');
    if (statusElement) {
      statusElement.innerHTML += `<p>📝 Loaded: <strong>${transcriptSegments.length} segments</strong></p>`;
    }
    
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
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div class="subtitle-text" style="flex: 1; margin-bottom: 0;">${text}</div>
        <button class="speak-btn" id="speak-btn" style="margin-left: 10px;">🔊 Hear Again</button>
      </div>
    `;
    
    // Re-add speak button listener
    document.getElementById('speak-btn')?.addEventListener('click', () => speakSubtitle(text));
  }
  
  // Auto-pause video at the END of subtitle segment
  if (settings.autoTranslate) {
    const video = document.querySelector('video');
    if (video) {
      video.pause();
      
      // Stay at the end of the segment (don't rewind)
      if (segment && segment.end) {
        video.currentTime = segment.end;
      }
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
    
    // Try Chrome Translator API first
    if (chromeAIAvailable.translator) {
      console.log('FluentAI: Using Chrome Translator API');
      try {
        correctTranslation = await translateText(currentSubtitle, settings.targetLanguage, settings.nativeLanguage);
        
        // Normalize both strings for comparison - remove punctuation, extra spaces, lowercase
        const normalizeText = (str) => {
          return str
            .toLowerCase()
            .replace(/[.,!?;:'"]/g, '') // Remove punctuation
            .replace(/\s+/g, ' ')       // Normalize whitespace
            .trim();
        };
        
        const normalizedInput = normalizeText(userInput);
        const normalizedCorrect = normalizeText(correctTranslation);
        
        isCorrect = normalizedInput === normalizedCorrect;
        console.log('FluentAI: Translation result:', { 
          correctTranslation, 
          normalizedInput, 
          normalizedCorrect, 
          isCorrect 
        });
      } catch (error) {
        console.error('Chrome Translator error:', error);
      }
    }
    
    // Fallback to Gemini API if available
    if (!correctTranslation && settings.geminiApiKey) {
      console.log('FluentAI: Using Gemini API as fallback');
      const response = await translateWithGemini(currentSubtitle);
      if (response) {
        correctTranslation = response;
        
        const normalizeText = (str) => {
          return str
            .toLowerCase()
            .replace(/[.,!?;:'"]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        };
        
        isCorrect = normalizeText(userInput) === normalizeText(correctTranslation);
        console.log('FluentAI: Gemini translation:', { correctTranslation, isCorrect });
      }
    }
    
    // If still no translation, use a simple comparison (fallback)
    if (!correctTranslation) {
      console.log('FluentAI: No translation available, using fallback');
      correctTranslation = `[Translation for: ${currentSubtitle}]`;
      isCorrect = false;
    }
    
    // Display feedback
    console.log('FluentAI: Displaying feedback - isCorrect:', isCorrect);
    if (isCorrect) {
      feedbackDiv.innerHTML = `
        <div class="success">✅ Correct! Great job!</div>
        <div class="correct-answer">"${currentSubtitle}" → "${correctTranslation}"</div>
      `;
      
      // Update stats
      updateQuizStats(1, 1);
      
      // Auto-advance after delay and RESUME VIDEO
      setTimeout(() => {
        skipSubtitle();
        // Resume video automatically when correct
        if (settings.autoTranslate) {
          const video = document.querySelector('video');
          if (video) {
            video.play();
            console.log('FluentAI: Resuming video after correct translation');
          }
        }
      }, 2000);
    } else {
      const similarity = calculateSimilarity(userInput.toLowerCase(), correctTranslation.toLowerCase());
      console.log('FluentAI: Similarity score:', similarity);
      
      let feedbackMessage = '';
      // Lowered threshold from 0.7 to 0.85 for "close" feedback
      if (similarity >= 0.85) {
        feedbackMessage = `
          <div class="partial">🤔 Very close! The correct translation is:</div>
          <div class="correct-answer">"${correctTranslation}"</div>
          <div class="similarity">Similarity: ${Math.round(similarity * 100)}%</div>
        `;
      } else if (similarity >= 0.6) {
        feedbackMessage = `
          <div class="partial">🤔 Close! The correct translation is:</div>
          <div class="correct-answer">"${correctTranslation}"</div>
          <div class="similarity">Similarity: ${Math.round(similarity * 100)}%</div>
        `;
      } else {
        feedbackMessage = `
          <div class="incorrect">❌ Not quite. The correct translation is:</div>
          <div class="correct-answer">"${correctTranslation}"</div>
        `;
      }
      
      feedbackDiv.innerHTML = feedbackMessage;
      
      // Update stats
      updateQuizStats(0, 1);
      
      // Don't auto-resume video if incorrect - let user try again or skip
    }
    
    console.log('FluentAI: Feedback displayed successfully');
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

// Initialize extension
async function init() {
  injectPageScript();
  await loadSettings();
  createOverlay();
  addTranscriptButton();

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