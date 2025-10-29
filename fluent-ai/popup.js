let stats = { correct: 0, incorrect: 0, streak: 0, total: 0 };
let currentLanguage = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
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
  
  if (tabName === 'stats') {
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
    currentLanguage = result.targetLanguage;
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

// Stats management
async function loadStats() {
  const result = await chrome.storage.sync.get(['stats']);
  stats = result.stats || { correct: 0, incorrect: 0, streak: 0, total: 0 };
}

function updateStatsDisplay() {
  document.getElementById('totalCorrect').textContent = stats.correct;
  document.getElementById('currentStreak').textContent = stats.streak;
  
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
  
  // Sample data for weekly progress
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const values = [12, 19, 15, 25, 22, 30, 28];
  
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
• Flashcard system with IndexedDB (unlimited storage!)
• Comprehension quizzes
• Progress tracking and statistics
• Practice notifications

Tips:
1. Enable Chrome AI APIs in chrome://flags
2. Get a free Gemini API key for enhanced features
3. Add flashcards while watching videos
4. Use search to quickly find flashcards
5. Export/import your flashcard collection

Need more help? Visit our GitHub page!`);
}

function updateUI() {
  updateStatsDisplay();
}