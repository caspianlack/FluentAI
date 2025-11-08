// Background Service Worker with Chrome AI Bridge

// Set up alarms for practice notifications
chrome.runtime.onInstalled.addListener(() => {
  console.log('FluentAI Pro installed!');
  
  // Create default alarm for practice notifications
  chrome.alarms.create('practiceReminder', {
    periodInMinutes: 30 // Default to 30 minutes
  });
  
  // Set up context menu for quick translation
  chrome.contextMenus.create({
    id: 'fluentai-translate',
    title: 'Translate with FluentAI',
    contexts: ['selection']
  });
});

// Handle alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'practiceReminder') {
    sendPracticeNotification();
  }
});

// Send practice notification
async function sendPracticeNotification() {
  const settings = await chrome.storage.sync.get([
    'notificationEnabled',
    'flashcards',
    'targetLanguage',
    'nativeLanguage'
  ]);
  
  if (!settings.notificationEnabled || !settings.flashcards || settings.flashcards.length === 0) {
    return;
  }
  
  // Select a random flashcard
  const flashcard = settings.flashcards[Math.floor(Math.random() * settings.flashcards.length)];
  
  // Create notification
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '🎓 FluentAI Practice Time!',
    message: `How do you say "${flashcard.translation}" in ${getLanguageName(settings.targetLanguage)}?`,
    buttons: [
      { title: 'Show Answer' },
      { title: 'Open FluentAI' }
    ],
    requireInteraction: true
  }, (notificationId) => {
    // Store the answer for this notification
    chrome.storage.local.set({
      [`notification_${notificationId}`]: flashcard.word
    });
  });
}

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    // Show answer button clicked
    const result = await chrome.storage.local.get([`notification_${notificationId}`]);
    const answer = result[`notification_${notificationId}`];
    
    if (answer) {
      // Update the notification with the answer
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '✅ Answer',
        message: `The answer is: ${answer}`,
        requireInteraction: false
      });
      
      // Clean up stored answer
      chrome.storage.local.remove([`notification_${notificationId}`]);
    }
  } else if (buttonIndex === 1) {
    // Open FluentAI button clicked
    chrome.tabs.create({
      url: 'https://www.youtube.com'
    });
  }
  
  // Clear the original notification
  chrome.notifications.clear(notificationId);
});

// Chrome AI API Bridge - Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'showNotification') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: request.data.title,
      message: request.data.message,
      contextMessage: request.data.contextMessage
    });
    sendResponse({ success: true });
  } 
  else if (request.action === 'updateAlarm') {
    // Update practice reminder frequency
    chrome.alarms.clear('practiceReminder');
    if (request.data.enabled && request.data.frequency > 0) {
      chrome.alarms.create('practiceReminder', {
        periodInMinutes: request.data.frequency
      });
    }
    sendResponse({ success: true });
  }
  // Chrome AI API Bridge Methods
  else if (request.action === 'checkChromeAI') {
    checkChromeAIInTab(sender.tab.id).then(sendResponse);
    return true; // Indicates async response
  }
  else if (request.action === 'translate') {
    performTranslation(sender.tab.id, request.data).then(sendResponse);
    return true; // Indicates async response
  }
  else if (request.action === 'detectLanguage') {
    detectLanguage(sender.tab.id, request.data).then(sendResponse);
    return true; // Indicates async response
  }
  else if (request.action === 'generateContent') {
    generateContent(sender.tab.id, request.data).then(sendResponse);
    return true; // Indicates async response
  }
});

// Check Chrome AI APIs availability by injecting code into the page
async function checkChromeAIInTab(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: () => {
        return {
          translator: typeof self.translation !== 'undefined' && typeof self.translation.canTranslate === 'function',
          languageDetector: typeof self.translation !== 'undefined' && typeof self.translation.canDetect === 'function',
          writer: typeof self.ai !== 'undefined' && typeof self.ai.writer !== 'undefined',
          // New Chrome 138+ API names
          translatorNew: typeof self.Translator !== 'undefined',
          languageDetectorNew: typeof self.LanguageDetector !== 'undefined',
          writerNew: typeof self.Writer !== 'undefined'
        };
      }
    });
    return { success: true, apis: result.result };
  } catch (error) {
    console.error('Error checking Chrome AI APIs:', error);
    return { success: false, error: error.message };
  }
}

// Perform translation by injecting code into the page
async function performTranslation(tabId, data) {
  const { text, sourceLanguage, targetLanguage } = data;
  
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      args: [text, sourceLanguage, targetLanguage],
      func: async (textToTranslate, sourceLang, targetLang) => {
        try {
          // Check for new Chrome 138+ API
          if (typeof self.Translator !== 'undefined') {
            const canTranslate = await self.Translator.canTranslate({
              sourceLanguage: sourceLang,
              targetLanguage: targetLang
            });
            
            if (canTranslate === 'readily' || canTranslate === 'after-download') {
              const translator = await self.Translator.create({
                sourceLanguage: sourceLang,
                targetLanguage: targetLang
              });
              const translation = await translator.translate(textToTranslate);
              return { success: true, translation, api: 'Translator' };
            }
          }
          
          // Fallback to older API if available
          if (typeof self.translation !== 'undefined' && typeof self.translation.createTranslator === 'function') {
            const translator = await self.translation.createTranslator({
              sourceLanguage: sourceLang,
              targetLanguage: targetLang
            });
            const translation = await translator.translate(textToTranslate);
            return { success: true, translation, api: 'translation' };
          }
          
          return { 
            success: false, 
            error: 'Chrome Translator API not available. Please enable it in chrome://flags' 
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });
    
    return result.result;
  } catch (error) {
    console.error('Translation error:', error);
    return { success: false, error: error.message };
  }
}

// Detect language by injecting code into the page
async function detectLanguage(tabId, data) {
  const { text } = data;
  
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      args: [text],
      func: async (textToDetect) => {
        try {
          // Check for new Chrome 138+ API
          if (typeof self.LanguageDetector !== 'undefined') {
            const canDetect = await self.LanguageDetector.canDetect();
            
            if (canDetect === 'readily' || canDetect === 'after-download') {
              const detector = await self.LanguageDetector.create();
              const results = await detector.detect(textToDetect);
              return { success: true, results, api: 'LanguageDetector' };
            }
          }
          
          // Fallback to older API if available
          if (typeof self.translation !== 'undefined' && typeof self.translation.createDetector === 'function') {
            const detector = await self.translation.createDetector();
            const results = await detector.detect(textToDetect);
            return { success: true, results, api: 'translation' };
          }
          
          return { 
            success: false, 
            error: 'Chrome Language Detector API not available' 
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });
    
    return result.result;
  } catch (error) {
    console.error('Language detection error:', error);
    return { success: false, error: error.message };
  }
}

// Generate content using Writer API
async function generateContent(tabId, data) {
  const { prompt, context = '' } = data;
  
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      args: [prompt, context],
      func: async (writePrompt, writeContext) => {
        try {
          // Check for new Chrome 138+ API
          if (typeof self.Writer !== 'undefined') {
            const canWrite = await self.Writer.canWrite();
            
            if (canWrite === 'readily' || canWrite === 'after-download') {
              const writer = await self.Writer.create({
                sharedContext: writeContext
              });
              const content = await writer.write(writePrompt);
              return { success: true, content, api: 'Writer' };
            }
          }
          
          // Fallback to older API if available
          if (typeof self.ai !== 'undefined' && typeof self.ai.writer !== 'undefined') {
            const session = await self.ai.writer.create({
              context: writeContext
            });
            const content = await session.write(writePrompt);
            return { success: true, content, api: 'ai.writer' };
          }
          
          return { 
            success: false, 
            error: 'Chrome Writer API not available' 
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });
    
    return result.result;
  } catch (error) {
    console.error('Content generation error:', error);
    return { success: false, error: error.message };
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'fluentai-translate' && info.selectionText) {
    // Send selected text to content script for translation
    chrome.tabs.sendMessage(tab.id, {
      action: 'translateSelection',
      text: info.selectionText
    });
  }
});

// Helper function to get language name
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

// Check Chrome AI APIs availability on startup
async function checkChromeAIAPIs() {
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      const result = await checkChromeAIInTab(tab.id);
      if (result.success) {
        chrome.storage.local.set({ chromeAIAPIs: result.apis });
        console.log('Chrome AI APIs status:', result.apis);
      }
    }
  } catch (error) {
    console.error('Error checking Chrome AI APIs on startup:', error);
  }
}

// Initialize on startup
checkChromeAIAPIs();
