let flashcards = [];
let stats = { correct: 0, incorrect: 0, streak: 0, total: 0 };

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadFlashcards();
  await loadStats();
  await checkChromeAIAPIs();
  setupEventListeners();
  updateUI();
});

// Setup event listeners
function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.popup-tab').forEach(tab => {
    tab.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
  });
  
  // Settings
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  
  // Flashcards
  document.getElementById('addFlashcard').addEventListener('click', showFlashcardForm);
  document.getElementById('saveFlashcard').addEventListener('click', saveFlashcard);
  document.getElementById('cancelFlashcard').addEventListener('click', hideFlashcardForm);
  document.getElementById('practiceFlashcards').addEventListener('click', practiceFlashcards);
  document.getElementById('exportFlashcards').addEventListener('click', exportFlashcards);
  document.getElementById('importFlashcards').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importFlashcards);
  
  // Stats
  document.getElementById('resetStats').addEventListener('click', resetStats);
  
  // API
  document.getElementById('testGeminiApi').addEventListener('click', testGeminiApi);
  document.getElementById('geminiApiKey').addEventListener('input', (e) => {
    updateGeminiStatus(e.target.value);
  });
  
  // Help
  document.getElementById('openHelp').addEventListener('click', (e) => {
    e.preventDefault();
    showHelp();
  });
}

// Tab switching
function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.popup-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Update tab content
  document.querySelectorAll('.popup-tab-content').forEach(content => {
    const isTargetTab = content.id === `${tabName}-tab`;
    content.style.display = isTargetTab ? 'block' : 'none';
  });
  
  // Special actions for specific tabs
  if (tabName === 'flashcards') {
    displayFlashcards();
  } else if (tabName === 'stats') {
    updateStatsDisplay();
    drawProgressChart();
  }
}

// Load settings
async function loadSettings() {
  const result = await chrome.storage.sync.get([
    'nativeLanguage',
    'targetLanguage',
    'autoTranslate',
    'geminiApiKey',
    'notificationEnabled',
    'quizFrequency',
    'difficulty',
    'pauseDelay',
    'useGeminiValidation',
    'autoPlayAfterCorrect'
  ]);
  
  // Apply settings to UI
  if (result.nativeLanguage) {
    document.getElementById('nativeLanguage').value = result.nativeLanguage;
  }
  if (result.targetLanguage) {
    document.getElementById('targetLanguage').value = result.targetLanguage;
  }
  if (result.autoTranslate !== undefined) {
    document.getElementById('autoTranslate').checked = result.autoTranslate;
  }
  if (result.notificationEnabled !== undefined) {
    document.getElementById('notificationEnabled').checked = result.notificationEnabled;
  }
  if (result.quizFrequency) {
    document.getElementById('quizFrequency').value = result.quizFrequency;
  }
  if (result.difficulty) {
    document.getElementById('difficulty').value = result.difficulty;
  }
  if (result.pauseDelay !== undefined) {
    document.getElementById('pauseDelay').value = result.pauseDelay;
  }
  if (result.geminiApiKey) {
    document.getElementById('geminiApiKey').value = result.geminiApiKey;
    updateGeminiStatus(result.geminiApiKey);
  }

  document.getElementById('useGeminiValidation').checked = result.useGeminiValidation !== false;
  document.getElementById('autoPlayAfterCorrect').checked = result.autoPlayAfterCorrect !== false;
}

// Save settings
async function saveSettings() {
  const nativeLanguage = document.getElementById('nativeLanguage').value;
  const targetLanguage = document.getElementById('targetLanguage').value;
  const autoTranslate = document.getElementById('autoTranslate').checked;
  const notificationEnabled = document.getElementById('notificationEnabled').checked;
  const quizFrequency = parseInt(document.getElementById('quizFrequency').value);
  const difficulty = document.getElementById('difficulty').value;
  const pauseDelay = parseFloat(document.getElementById('pauseDelay').value);
  const geminiApiKey = document.getElementById('geminiApiKey').value.trim();
  const useGeminiValidation = document.getElementById('useGeminiValidation').checked;
  const autoPlayAfterCorrect = document.getElementById('autoPlayAfterCorrect').checked;
  
  // Validate
  if (nativeLanguage === targetLanguage) {
    showStatus('settingsStatus', '⚠️ Native and learning languages must be different!', 'error');
    return;
  }
  
  if (geminiApiKey && !geminiApiKey.startsWith('AIza')) {
    showStatus('settingsStatus', '⚠️ Invalid API key format', 'error');
    return;
  }
  
  // Save to storage
  await chrome.storage.sync.set({
    nativeLanguage,
    targetLanguage,
    autoTranslate,
    geminiApiKey,
    notificationEnabled,
    quizFrequency,
    difficulty,
    pauseDelay,
    useGeminiValidation,
    autoPlayAfterCorrect
  });
  
  // Update alarm for notifications
  chrome.runtime.sendMessage({
    action: 'updateAlarm',
    data: {
      enabled: notificationEnabled,
      frequency: quizFrequency
    }
  });
  
  // Notify content script
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'settingsUpdated',
        settings: {
          nativeLanguage,
          targetLanguage,
          autoTranslate,
          geminiApiKey,
          notificationEnabled,
          quizFrequency,
          difficulty,
          pauseDelay,
          useGeminiValidation,
          autoPlayAfterCorrect
        }
      }).catch(err => console.log('Content script not ready'));
    }
  });
  
  showStatus('settingsStatus', '✅ Settings saved successfully!', 'success');
}

// Flashcard management
async function loadFlashcards() {
  const result = await chrome.storage.sync.get(['flashcards', 'targetLanguage']);
  const allFlashcards = result.flashcards || [];
  const targetLanguage = result.targetLanguage || 'es';
  
  // Filter by target language
  flashcards = allFlashcards.filter(card => card.language === targetLanguage);
  console.log(`Loaded ${flashcards.length} flashcards for ${targetLanguage} (${allFlashcards.length} total)`);
  
  updateFlashcardStats();
}

function updateFlashcardStats() {
  document.getElementById('totalFlashcards').textContent = flashcards.length;
  
  // Calculate due cards (simplified - cards not reviewed in last 24 hours)
  const now = Date.now();
  const dayInMs = 24 * 60 * 60 * 1000;
  const dueCards = flashcards.filter(card => 
    !card.lastReviewed || (now - card.lastReviewed) > dayInMs
  ).length;
  
  document.getElementById('dueFlashcards').textContent = dueCards;
}

function showFlashcardForm() {
  document.getElementById('flashcardForm').style.display = 'block';
  document.getElementById('flashcardWord').focus();
}

function hideFlashcardForm() {
  document.getElementById('flashcardForm').style.display = 'none';
  document.getElementById('flashcardWord').value = '';
  document.getElementById('flashcardTranslation').value = '';
  document.getElementById('flashcardContext').value = '';
}

async function saveFlashcard() {
  const word = document.getElementById('flashcardWord').value.trim();
  const translation = document.getElementById('flashcardTranslation').value.trim();
  const context = document.getElementById('flashcardContext').value.trim();
  
  if (!word || !translation) {
    alert('Please enter both word and translation');
    return;
  }
  
  const targetLanguage = (await chrome.storage.sync.get(['targetLanguage'])).targetLanguage || 'es';
  
  const flashcard = {
    id: Date.now(),
    word,
    translation,
    context,
    language: targetLanguage,
    sets: [], // Ready for future set management
    difficulty: 0,
    lastReviewed: null,
    nextReview: Date.now(),
    reviewCount: 0,
    correctCount: 0
  };
  
  // Load all flashcards, add new one, save all
  const result = await chrome.storage.sync.get(['flashcards']);
  const allFlashcards = result.flashcards || [];
  allFlashcards.push(flashcard);
  await chrome.storage.sync.set({ flashcards: allFlashcards });
  
  // Reload filtered flashcards
  await loadFlashcards();
  
  hideFlashcardForm();
  displayFlashcards();
  updateFlashcardStats();
}

function displayFlashcards() {
  const list = document.getElementById('flashcardList');
  
  if (flashcards.length === 0) {
    chrome.storage.sync.get(['targetLanguage'], (result) => {
      const lang = result.targetLanguage || 'es';
      const langName = getLanguageName(lang);
      list.innerHTML = `<p style="text-align: center; color: #666; padding: 20px;">
        No flashcards for ${langName} yet. Add your first one!<br>
        <small style="color: #999; font-size: 12px; margin-top: 8px; display: block;">Flashcards are filtered by your target language</small>
      </p>`;
    });
    return;
  }
  
  list.innerHTML = flashcards.map(card => `
    <div class="flashcard-item" data-id="${card.id}">
      <div class="flashcard-content">
        <div class="flashcard-word">${card.word}</div>
        <div class="flashcard-translation">${card.translation}</div>
      </div>
      <button class="flashcard-delete" data-id="${card.id}">Delete</button>
    </div>
  `).join('');
  
  // Add delete listeners
  document.querySelectorAll('.flashcard-delete').forEach(btn => {
    btn.addEventListener('click', (e) => deleteFlashcard(e.target.dataset.id));
  });
}

async function deleteFlashcard(id) {
  // Delete from all flashcards in storage
  const result = await chrome.storage.sync.get(['flashcards']);
  const allFlashcards = result.flashcards || [];
  const updatedFlashcards = allFlashcards.filter(card => card.id !== parseInt(id));
  await chrome.storage.sync.set({ flashcards: updatedFlashcards });
  
  // Reload filtered flashcards
  await loadFlashcards();
  displayFlashcards();
  updateFlashcardStats();
}

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

function practiceFlashcards() {
  if (flashcards.length === 0) {
    alert('No flashcards to practice. Add some first!');
    return;
  }
  
  // Open YouTube with a message to start practice
  chrome.tabs.create({
    url: 'https://www.youtube.com'
  }, (tab) => {
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'startPractice',
        flashcards: flashcards
      });
    }, 2000);
  });
}

async function exportFlashcards() {
  if (flashcards.length === 0) {
    alert('No flashcards to export for the current language');
    return;
  }
  
  const result = await chrome.storage.sync.get(['targetLanguage']);
  const lang = result.targetLanguage || 'es';
  
  // Export only flashcards for current language (filtered)
  const dataStr = JSON.stringify(flashcards, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
  
  const exportFileDefaultName = `fluentai-${lang}-flashcards-${new Date().toISOString().split('T')[0]}.json`;
  
  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
}

async function importFlashcards(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const importedCards = JSON.parse(text);
    
    if (!Array.isArray(importedCards)) {
      alert('Invalid file format');
      return;
    }
    
    // Ensure imported cards have sets array for future compatibility
    const cardsWithSets = importedCards.map(card => ({
      ...card,
      sets: card.sets || []
    }));
    
    // Merge with ALL existing flashcards (not just filtered ones)
    const result = await chrome.storage.sync.get(['flashcards']);
    const allFlashcards = result.flashcards || [];
    const mergedFlashcards = [...allFlashcards, ...cardsWithSets];
    await chrome.storage.sync.set({ flashcards: mergedFlashcards });
    
    // Reload filtered flashcards for current language
    await loadFlashcards();
    displayFlashcards();
    updateFlashcardStats();
    
    const languages = [...new Set(importedCards.map(c => c.language))].join(', ');
    alert(`Imported ${importedCards.length} flashcards successfully!\nLanguages: ${languages}`);
  } catch (error) {
    alert('Error importing flashcards: ' + error.message);
  }
  
  // Reset file input
  event.target.value = '';
}

function practiceFlashcards() {
  if (flashcards.length === 0) {
    alert('No flashcards to practice. Add some first!');
    return;
  }
  
  // Get current active YouTube tab or create one
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const currentTab = tabs[0];
    
    if (currentTab && currentTab.url.includes('youtube.com')) {
      // Use current YouTube tab
      chrome.tabs.sendMessage(currentTab.id, {
        action: 'startFlashcardPractice',
        flashcards: flashcards
      }).catch(err => {
        // If content script isn't ready, reload the tab
        chrome.tabs.reload(currentTab.id, () => {
          setTimeout(() => {
            chrome.tabs.sendMessage(currentTab.id, {
              action: 'startFlashcardPractice',
              flashcards: flashcards
            });
          }, 2000);
        });
      });
    } else {
      // Create new YouTube tab
      chrome.tabs.create({
        url: 'https://www.youtube.com'
      }, (tab) => {
        // Wait for page to load, then send message
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, {
                action: 'startFlashcardPractice', 
                flashcards: flashcards
              });
            }, 3000);
          }
        });
      });
    }
  });
}

// Stats management
async function loadStats() {
  const result = await chrome.storage.sync.get(['stats']);
  stats = result.stats || { correct: 0, incorrect: 0, streak: 0, total: 0 };
}

function updateStatsDisplay() {
  document.getElementById('totalCorrect').textContent = stats.correct;
  document.getElementById('currentStreak').textContent = stats.streak;
  document.getElementById('wordsLearned').textContent = flashcards.length;
  
  const accuracy = stats.total > 0 
    ? Math.round((stats.correct / stats.total) * 100) 
    : 0;
  document.getElementById('accuracyRate').textContent = `${accuracy}%`;
}

function drawProgressChart() {
  const canvas = document.getElementById('progressChart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const width = canvas.width = canvas.offsetWidth;
  const height = canvas.height = 150;
  
  // Sample data for weekly progress (in real app, would track actual data)
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const values = [12, 19, 15, 25, 22, 30, 28]; // Sample correct answers per day
  
  // Clear canvas
  ctx.clearRect(0, 0, width, height);
  
  // Draw bars
  const barWidth = width / days.length * 0.6;
  const spacing = width / days.length;
  const maxValue = Math.max(...values);
  
  values.forEach((value, index) => {
    const barHeight = (value / maxValue) * (height - 40);
    const x = index * spacing + (spacing - barWidth) / 2;
    const y = height - barHeight - 20;
    
    // Draw bar
    const gradient = ctx.createLinearGradient(0, y, 0, height - 20);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barWidth, barHeight);
    
    // Draw label
    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(days[index], x + barWidth / 2, height - 5);
    
    // Draw value
    ctx.fillStyle = '#667eea';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(value, x + barWidth / 2, y - 5);
  });
}

async function resetStats() {
  if (confirm('Are you sure you want to reset all statistics?')) {
    stats = { correct: 0, incorrect: 0, streak: 0, total: 0 };
    await chrome.storage.sync.set({ stats });
    updateStatsDisplay();
    drawProgressChart();
    showStatus('statsStatus', 'Statistics reset successfully', 'success');
  }
}

// Chrome AI APIs check using background bridge
async function checkChromeAIAPIs() {
  try {
    // Get active tab to check AI APIs
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      console.log('No active tab found for Chrome AI API check');
      return;
    }
    
    // Send message to background script to check Chrome AI APIs
    chrome.runtime.sendMessage(
      { action: 'checkChromeAI', data: {} },
      (response) => {
        if (response && response.success) {
          const apis = response.apis;
          
          // Update UI based on API availability
          updateAPIStatus('translatorStatus', apis.translatorNew || apis.translator);
          updateAPIStatus('languageDetectorStatus', apis.languageDetectorNew || apis.languageDetector);
          updateAPIStatus('summarizerStatus', apis.summarizerNew || apis.summarizer);
          updateAPIStatus('writerStatus', apis.writerNew || apis.writer);
          
          // Store the status
          chrome.storage.local.set({ chromeAIAPIs: apis });
        } else {
          console.error('Failed to check Chrome AI APIs:', response?.error);
          // Update all to unavailable
          updateAPIStatus('translatorStatus', false);
          updateAPIStatus('languageDetectorStatus', false);
          updateAPIStatus('summarizerStatus', false);
          updateAPIStatus('writerStatus', false);
        }
      }
    );
  } catch (error) {
    console.error('Error checking Chrome AI APIs:', error);
    // Update all to unavailable
    updateAPIStatus('translatorStatus', false);
    updateAPIStatus('languageDetectorStatus', false);
    updateAPIStatus('summarizerStatus', false);
    updateAPIStatus('writerStatus', false);
  }
}

function updateAPIStatus(elementId, isAvailable) {
  const element = document.getElementById(elementId);
  if (element) {
    const indicator = element.querySelector('.api-indicator');
    indicator.textContent = isAvailable ? '✅' : '❌';
    indicator.className = `api-indicator ${isAvailable ? 'available' : 'unavailable'}`;
  }
}

// Gemini API
function updateGeminiStatus(apiKey) {
  const hasKey = apiKey && apiKey.trim().length > 0;
  // Visual feedback could be added here
}

async function testGeminiApi() {
  const apiKey = document.getElementById('geminiApiKey').value.trim();
  const resultDiv = document.getElementById('geminiTestResult');
  
  if (!apiKey) {
    resultDiv.className = 'test-result error';
    resultDiv.textContent = '❌ Please enter an API key first';
    resultDiv.style.display = 'block';
    return;
  }
  
  resultDiv.className = 'test-result';
  resultDiv.textContent = '⏳ Testing API connection...';
  resultDiv.style.display = 'block';
  
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: 'Hello' }]
        }]
      })
    });
    
    if (response.ok) {
      resultDiv.className = 'test-result success';
      resultDiv.textContent = '✅ API key is valid and working!';
      
      // Save the API key
      await chrome.storage.sync.set({ geminiApiKey: apiKey });
    } else {
      const error = await response.json();
      resultDiv.className = 'test-result error';
      resultDiv.textContent = `❌ API error: ${error.error?.message || 'Invalid API key'}`;
    }
  } catch (error) {
    resultDiv.className = 'test-result error';
    resultDiv.textContent = '❌ Connection error. Check your API key.';
  }
}

// Helper functions
function showStatus(elementId, message, type = 'success') {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.className = `status-message ${type}`;
    element.style.display = 'block';
    
    setTimeout(() => {
      element.style.display = 'none';
    }, 3000);
  }
}

function showHelp() {
  alert(`FluentAI Pro - Help

Features:
• Auto-pause YouTube videos for translation practice
• Chrome AI APIs for offline translation (Chrome 138+)
• Gemini API fallback for advanced features
• Flashcard system with spaced repetition
• Comprehension quizzes
• Progress tracking and statistics
• Practice notifications

Tips:
1. Enable Chrome AI APIs in chrome://flags
2. Get a free Gemini API key for enhanced features
3. Add flashcards while watching videos
4. Review flashcards regularly for best results
5. Use the quiz feature to test comprehension

Need more help? Visit our GitHub page!`);
}

function updateUI() {
  updateFlashcardStats();
  updateStatsDisplay();
}

// Initialize everything
updateUI();