let flashcards = [];
let stats = { correct: 0, incorrect: 0, streak: 0, total: 0 };
let currentLanguage = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await initializeDB();
  await loadFlashcards();
  await loadStats();
  await checkChromeAIAPIs();
  setupEventListeners();
  updateUI();
});

// Initialize IndexedDB
async function initializeDB() {
  try {
    await flashcardDB.waitForReady();
    console.log('IndexedDB ready for popup');
  } catch (error) {
    console.error('Failed to initialize IndexedDB:', error);
  }
}

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
  
  // Update current language and reload flashcards if language changed
  if (currentLanguage !== targetLanguage) {
    currentLanguage = targetLanguage;
    await loadFlashcards();
  }
  
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
  try {
    // If no language is set yet, load all flashcards
    if (!currentLanguage) {
      flashcards = await flashcardDB.getAllFlashcards();
      console.log(`Loaded ${flashcards.length} flashcards (all languages)`);
    } else {
      flashcards = await flashcardDB.getFlashcardsByLanguage(currentLanguage);
      console.log(`Loaded ${flashcards.length} flashcards for ${currentLanguage}`);
      
      // If no flashcards for current language but flashcards exist, show all
      if (flashcards.length === 0) {
        const allCards = await flashcardDB.getAllFlashcards();
        console.log(`Total flashcards in DB: ${allCards.length}`);
        
        if (allCards.length > 0) {
          const languages = [...new Set(allCards.map(c => c.language || 'undefined'))];
          console.warn(`No flashcards for language "${currentLanguage}", but ${allCards.length} exist in other languages:`, languages);
          
          // Show a notification to the user after a brief delay
          setTimeout(() => {
            const langNames = languages.map(l => getLanguageName(l)).join(', ');
            alert(`No flashcards found for ${getLanguageName(currentLanguage)}.\n\nYou have ${allCards.length} flashcards in: ${langNames}\n\nChange your target language in Settings to see them, or the extension will auto-load them.`);
          }, 500);
        }
      }
    }
    updateFlashcardStats();
  } catch (error) {
    console.error('Error loading flashcards:', error);
    flashcards = [];
    updateFlashcardStats();
  }
}

function updateFlashcardStats() {
  const totalElement = document.getElementById('totalFlashcards');
  const dueElement = document.getElementById('dueFlashcards');
  
  totalElement.textContent = flashcards.length;
  
  // Add language indicator if flashcards exist
  if (flashcards.length > 0 && currentLanguage) {
    const langName = getLanguageName(currentLanguage);
    totalElement.title = `${flashcards.length} flashcards for ${langName}`;
  }
  
  // Calculate due cards (cards not reviewed in last 24 hours)
  const now = Date.now();
  const dayInMs = 24 * 60 * 60 * 1000;
  const dueCards = flashcards.filter(card => 
    !card.lastReviewed || (now - card.lastReviewed) > dayInMs
  ).length;
  
  dueElement.textContent = dueCards;
  
  // Debug logging
  console.log('Flashcard stats updated:', {
    currentLanguage: currentLanguage || 'all',
    total: flashcards.length,
    due: dueCards,
    sample: flashcards[0] || 'none'
  });
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
  
  // Check if word already exists
  const exists = await flashcardDB.wordExists(word, currentLanguage);
  if (exists) {
    if (!confirm(`"${word}" already exists in your ${getLanguageName(currentLanguage)} flashcards. Add anyway?`)) {
      return;
    }
  }
  
  const flashcard = {
    word,
    translation,
    context,
    language: currentLanguage
  };
  
  try {
    await flashcardDB.addFlashcard(flashcard);
    await loadFlashcards(); // Reload to get the updated list
    hideFlashcardForm();
    displayFlashcards();
    updateFlashcardStats();
    showStatus('flashcardStatus', `✅ Added "${word}" to flashcards!`, 'success');
  } catch (error) {
    console.error('Error saving flashcard:', error);
    showStatus('flashcardStatus', '❌ Error saving flashcard', 'error');
  }
}

function displayFlashcards() {
  const list = document.getElementById('flashcardList');
  
  if (flashcards.length === 0) {
    const langName = getLanguageName(currentLanguage || 'selected');
    list.innerHTML = `
      <div style="text-align: center; color: #666; padding: 40px 20px; background: #f8f9fa; border-radius: 8px;">
        <p style="margin: 0 0 10px 0; font-size: 16px;">No flashcards for ${langName} yet.</p>
        <p style="margin: 0; font-size: 14px; color: #999;">
          Add your first one or extract vocabulary from YouTube videos!
        </p>
        <div style="margin-top: 20px;">
          <button id="searchFlashcards" class="action-btn" style="margin: 5px;">
            🔍 Search All Words
          </button>
          <button id="exportAllFlashcards" class="action-btn" style="margin: 5px;">
            📥 Export All Languages
          </button>
          <button id="debugFlashcards" class="action-btn" style="margin: 5px; background: #ff6b6b; color: white;">
            🐛 Debug Database
          </button>
        </div>
      </div>
    `;
    
    // Add event listeners for the new buttons
    document.getElementById('searchFlashcards')?.addEventListener('click', searchAllFlashcards);
    document.getElementById('exportAllFlashcards')?.addEventListener('click', exportAllFlashcards);
    document.getElementById('debugFlashcards')?.addEventListener('click', async () => {
      const allCards = await flashcardDB.getAllFlashcards();
      const languages = [...new Set(allCards.map(c => c.language || 'undefined'))];
      let message = `📊 Database Debug Info\n\n`;
      message += `Total flashcards: ${allCards.length}\n`;
      message += `Current language filter: ${currentLanguage || 'none'}\n\n`;
      message += `Flashcards by language:\n`;
      languages.forEach(lang => {
        const count = allCards.filter(c => (c.language || 'undefined') === lang).length;
        message += `  ${getLanguageName(lang)}: ${count}\n`;
      });
      if (allCards.length > 0) {
        message += `\nSample flashcard:\n`;
        message += `  Word: ${allCards[0].word}\n`;
        message += `  Language: ${allCards[0].language}\n`;
        message += `  Translation: ${allCards[0].translation}\n`;
      }
      alert(message);
    });
    return;
  }
  
  // Add search header
  const headerHtml = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding: 0 10px;">
      <h3 style="margin: 0; font-size: 16px; color: #2d3748;">Your ${getLanguageName(currentLanguage)} Flashcards</h3>
      <div>
        <input type="text" id="searchFlashcardsInput" placeholder="Search words..." 
               style="padding: 8px 12px; border: 1px solid #e1e4e8; border-radius: 6px; margin-right: 10px; width: 200px;">
        <button id="refreshFlashcards" class="secondary-btn small">🔄 Refresh</button>
      </div>
    </div>
  `;
  
  list.innerHTML = headerHtml + flashcards.map(card => `
    <div class="flashcard-item" data-id="${card.id}">
      <div class="flashcard-content">
        <div class="flashcard-word">${card.word}</div>
        <div class="flashcard-translation">${card.translation}</div>
        ${card.context ? `<div class="flashcard-context" style="font-size: 12px; color: #666; margin-top: 4px;">${card.context}</div>` : ''}
        <div class="flashcard-meta" style="font-size: 11px; color: #999; margin-top: 4px;">
          Added: ${new Date(card.addedDate).toLocaleDateString()}
          ${card.reviewCount > 0 ? ` • Reviewed: ${card.reviewCount} times` : ''}
          ${card.correctCount > 0 ? ` • Correct: ${card.correctCount}` : ''}
        </div>
      </div>
      <button class="flashcard-delete" data-id="${card.id}">Delete</button>
    </div>
  `).join('');
  
  // Add search functionality
  const searchInput = document.getElementById('searchFlashcardsInput');
  searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase().trim();
    if (searchTerm) {
      const filtered = flashcards.filter(card => 
        card.word.toLowerCase().includes(searchTerm) || 
        card.translation.toLowerCase().includes(searchTerm)
      );
      displayFilteredFlashcards(filtered);
    } else {
      displayFilteredFlashcards(flashcards);
    }
  });
  
  // Add refresh button listener
  document.getElementById('refreshFlashcards')?.addEventListener('click', async () => {
    await loadFlashcards();
    displayFlashcards();
    showStatus('flashcardStatus', 'Flashcards refreshed!', 'success');
  });
  
  // Add delete listeners
  document.querySelectorAll('.flashcard-delete').forEach(btn => {
    btn.addEventListener('click', (e) => deleteFlashcard(e.target.dataset.id));
  });
}

function displayFilteredFlashcards(filteredFlashcards) {
  const list = document.getElementById('flashcardList');
  const existingHeader = list.querySelector('div:first-child');
  
  if (filteredFlashcards.length === 0) {
    list.innerHTML = existingHeader.outerHTML + `
      <div style="text-align: center; color: #666; padding: 20px;">
        No flashcards match your search.
      </div>
    `;
    return;
  }
  
  const flashcardsHtml = filteredFlashcards.map(card => `
    <div class="flashcard-item" data-id="${card.id}">
      <div class="flashcard-content">
        <div class="flashcard-word">${card.word}</div>
        <div class="flashcard-translation">${card.translation}</div>
        ${card.context ? `<div class="flashcard-context" style="font-size: 12px; color: #666; margin-top: 4px;">${card.context}</div>` : ''}
      </div>
      <button class="flashcard-delete" data-id="${card.id}">Delete</button>
    </div>
  `).join('');
  
  list.innerHTML = existingHeader.outerHTML + flashcardsHtml;
  
  // Re-add delete listeners for filtered items
  document.querySelectorAll('.flashcard-delete').forEach(btn => {
    btn.addEventListener('click', (e) => deleteFlashcard(e.target.dataset.id));
  });
}

async function deleteFlashcard(id) {
  if (confirm('Are you sure you want to delete this flashcard?')) {
    try {
      await flashcardDB.deleteFlashcard(parseInt(id));
      await loadFlashcards();
      displayFlashcards();
      updateFlashcardStats();
      showStatus('flashcardStatus', 'Flashcard deleted', 'success');
    } catch (error) {
      console.error('Error deleting flashcard:', error);
      showStatus('flashcardStatus', 'Error deleting flashcard', 'error');
    }
  }
}

async function searchAllFlashcards() {
  try {
    const allFlashcards = await flashcardDB.getAllFlashcards();
    const languages = [...new Set(allFlashcards.map(card => card.language))];
    
    let message = `Total flashcards across all languages: ${allFlashcards.length}\n\n`;
    languages.forEach(lang => {
      const count = allFlashcards.filter(card => card.language === lang).length;
      message += `${getLanguageName(lang)}: ${count} cards\n`;
    });
    
    alert(message);
  } catch (error) {
    console.error('Error searching all flashcards:', error);
    alert('Error loading flashcard statistics');
  }
}

async function exportAllFlashcards() {
  try {
    const allFlashcards = await flashcardDB.getAllFlashcards();
    
    if (allFlashcards.length === 0) {
      alert('No flashcards to export');
      return;
    }
    
    const dataStr = JSON.stringify(allFlashcards, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `fluentai-all-flashcards-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  } catch (error) {
    console.error('Error exporting all flashcards:', error);
    alert('Error exporting flashcards');
  }
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

async function practiceFlashcards() {
  try {
    const dueFlashcards = await flashcardDB.getDueFlashcards(currentLanguage);
    
    if (dueFlashcards.length === 0) {
      // If no due cards, offer to practice random cards
      const allCards = await flashcardDB.getFlashcardsByLanguage(currentLanguage);
      
      if (allCards.length === 0) {
        alert('No flashcards available! Add some vocabulary first.');
        return;
      }
      
      const practiceRandom = confirm(
        `No flashcards due for review! You have ${allCards.length} total cards.\n\n` +
        `Would you like to practice 5 random cards instead?`
      );
      
      if (!practiceRandom) return;
      
      // Get 5 random cards
      const shuffled = [...allCards].sort(() => Math.random() - 0.5);
      const practiceCards = shuffled.slice(0, Math.min(5, shuffled.length));
      
      // Send to active YouTube tab
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'startFlashcardPractice',
            flashcards: practiceCards
          });
          window.close(); // Close popup
        } else {
          // Open YouTube and start practice
          chrome.tabs.create({
            url: 'https://www.youtube.com'
          }, (tab) => {
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, {
                action: 'startFlashcardPractice',
                flashcards: practiceCards
              });
            }, 2000);
          });
          window.close();
        }
      });
      
      return;
    }
    
    // Practice due flashcards
    const practiceCards = dueFlashcards.slice(0, Math.min(5, dueFlashcards.length));
    
    // Send to active YouTube tab or open new one
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'startFlashcardPractice',
          flashcards: practiceCards
        });
        window.close(); // Close popup
      } else {
        // Open YouTube and start practice
        chrome.tabs.create({
          url: 'https://www.youtube.com'
        }, (tab) => {
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'startFlashcardPractice',
              flashcards: practiceCards
            });
          }, 2000);
        });
        window.close();
      }
    });
    
  } catch (error) {
    console.error('Error starting practice:', error);
    alert('Error starting flashcard practice');
  }
}

async function exportFlashcards() {
  if (flashcards.length === 0) {
    alert('No flashcards to export for the current language');
    return;
  }
  
  try {
    const dataStr = await flashcardDB.exportFlashcards(currentLanguage);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `fluentai-${currentLanguage}-flashcards-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  } catch (error) {
    console.error('Error exporting flashcards:', error);
    alert('Error exporting flashcards');
  }
}

async function importFlashcards(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    
    // Ask user if they want to merge or replace
    const merge = confirm('Do you want to merge with existing flashcards? Click OK to merge, Cancel to replace all.');
    
    const importedCount = await flashcardDB.importFlashcards(text, merge);
    
    await loadFlashcards();
    displayFlashcards();
    updateFlashcardStats();
    
    alert(`Imported ${importedCount} flashcards successfully!`);
  } catch (error) {
    alert('Error importing flashcards: ' + error.message);
  }
  
  event.target.value = '';
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
  updateFlashcardStats();
  updateStatsDisplay();
}