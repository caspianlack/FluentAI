// Vocabulary extraction, translation enrichment, and vocabulary selector UI.
// All Gemini calls use gemini-2.5-flash consistently.

var GEMINI_MODEL = 'gemini-2.5-flash';

function isWordInFlashcards(word) {
  const normalizedWord = word.toLowerCase().trim();
  return flashcards.some(card => {
    if (card.word.toLowerCase().trim() === normalizedWord) return true;
    return card.translations && card.translations.some(t => t.toLowerCase().trim() === normalizedWord);
  });
}

async function extractVocabularyFromTranscript() {
  if (!transcriptSegments || transcriptSegments.length === 0) {
    console.log('No transcript segments available');
    return [];
  }

  const fullTranscript = transcriptSegments.map(seg => seg.text).join(' ');
  const transcript = fullTranscript.length > 6000
    ? fullTranscript.substring(0, 6000) + '...'
    : fullTranscript;

  const langCode = settings.targetLanguage;
  const langName = getLanguageName(langCode);

  const stopwords = {
    'es': 'el, la, los, las, un, una, de, en, a, por, para, con, que, y, o, es, ser, estar',
    'fr': 'le, la, les, un, une, de, à, dans, pour, avec, que, et, ou, être, avoir',
    'it': 'il, lo, la, i, gli, le, un, una, di, a, in, per, con, che, e, o, essere, avere',
    'pt': 'o, a, os, as, um, uma, de, em, para, com, que, e, ou, ser, estar, ter',
    'de': 'der, die, das, ein, eine, in, auf, zu, mit, und, oder, sein, haben, werden'
  };
  const stops = stopwords[langCode] || stopwords['es'];

  if (!settings.geminiApiKey) {
    const vocabTab = document.getElementById('vocabulary-tab');
    if (vocabTab) {
      vocabTab.innerHTML = `
        <div class="error-message" style="text-align: center; padding: 30px;">
          <h3>🔑 Gemini API Key Required</h3>
          <p style="margin: 20px 0;">Vocabulary extraction requires a free Gemini API key.</p>
          <div style="background: #f0f9ff; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px 0; color: #1e40af;">✨ Get Your Free API Key:</h4>
            <ol style="text-align: left; margin: 10px 0; padding-left: 20px;">
              <li>Visit <a href="https://aistudio.google.com/apikey" target="_blank" style="color: #2563eb; text-decoration: underline;">Google AI Studio</a></li>
              <li>Click "Create API Key"</li>
              <li>Paste key in FluentAI Settings</li>
            </ol>
          </div>
          <a href="https://aistudio.google.com/apikey" target="_blank" class="primary-btn" style="display: inline-block; text-decoration: none; margin-top: 20px;">
            🔑 Get Free API Key
          </a>
          <button id="back-to-vocab" class="action-btn" style="margin-top: 10px;">← Back to Flashcards</button>
        </div>
      `;
      switchTab('vocabulary');
      document.getElementById('back-to-vocab')?.addEventListener('click', loadFlashcardList);
    }
    return [];
  }

  try {
    const prompt = `Extract useful vocabulary from this ${langName} transcript for language learners.

RULES:
1. Extract ONLY dictionary/root forms (infinitive verbs, singular nouns, base adjectives)
2. Skip stopwords: ${stops}
3. Remove duplicates and conjugations
4. Verify words are actually ${langName}

TRANSCRIPT:
${transcript}

Respond with JSON:
{
  "vocabulary": [
    {
      "word": "dictionary form",
      "partOfSpeech": "verb|noun|adjective|adverb",
      "difficulty": "beginner|intermediate|advanced",
      "frequency": "high|medium|low"
    }
  ]
}

Extract 20-30 useful words.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${settings.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2000 }
        })
      }
    );

    if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

    const data = await response.json();
    let resultText = data.candidates[0].content.parts[0].text.trim();

    if (resultText.includes('```json')) {
      resultText = resultText.split('```json')[1].split('```')[0].trim();
    } else if (resultText.includes('```')) {
      resultText = resultText.split('```')[1].split('```')[0].trim();
    }

    const result = JSON.parse(resultText);
    if (!result.vocabulary || !Array.isArray(result.vocabulary)) return [];

    return result.vocabulary.filter(item =>
      item.word && item.word.length > 1 && item.word.length < 50 &&
      !/[0-9]/.test(item.word) && item.partOfSpeech
    );
  } catch (error) {
    console.error('Vocabulary extraction error:', error);
    showNotification(`Extraction failed: ${error.message}`, 'error');
    return [];
  }
}

async function validateAndEnrichVocabulary(vocabularyList) {
  if (!vocabularyList || vocabularyList.length === 0) return [];

  const newWords = vocabularyList.filter(item => !isWordInFlashcards(item.word));
  if (newWords.length === 0) {
    showNotification('All extracted words are already in your flashcards!', 'success');
    return [];
  }

  const langCode = settings.targetLanguage;
  const targetLangName = getLanguageName(langCode);
  const nativeLangName = getLanguageName(settings.nativeLanguage);
  const enrichedWords = [];

  for (let i = 0; i < newWords.length; i++) {
    const item = newWords[i];
    const wordData = {
      word: item.word,
      partOfSpeech: item.partOfSpeech || 'unknown',
      difficulty: item.difficulty || 'intermediate',
      translations: [],
      description: '',
      example: '',
      confidence: 0,
      source: []
    };

    if (chromeAIAvailable.translator) {
      try {
        const translateResult = await chromeAIBridge('translate', {
          text: item.word,
          sourceLanguage: langCode,
          targetLanguage: settings.nativeLanguage
        });
        if (translateResult.success && translateResult.translation) {
          const translation = translateResult.translation.trim();
          if (translation.toLowerCase() !== item.word.toLowerCase()) {
            wordData.translations.push(translation);
            wordData.source.push('chrome-ai-translator');
            wordData.confidence = 75;
          }
        }
      } catch (e) {
        console.log('Chrome AI Translator error:', e.message);
      }
    }

    if (chromeAIAvailable.writer) {
      try {
        const prompt = `List 3-5 common ${nativeLangName} translations for the ${targetLangName} word "${item.word}".
Respond with ONLY the ${nativeLangName} translations, separated by commas. No explanations.`;
        const writerResult = await chromeAIBridge('generateContent', {
          prompt,
          context: `Translating ${targetLangName} to ${nativeLangName}`
        });
        if (writerResult.success && writerResult.content) {
          const alternates = writerResult.content
            .split(',').map(t => t.trim())
            .filter(t => t.length > 0 && t.toLowerCase() !== item.word.toLowerCase());
          alternates.forEach(alt => {
            if (!wordData.translations.includes(alt)) wordData.translations.push(alt);
          });
          if (alternates.length > 0) {
            wordData.source.push('chrome-ai-writer');
            wordData.confidence = Math.max(wordData.confidence, 80);
          }
        }
      } catch (e) {
        console.log('Chrome AI Writer error:', e.message);
      }
    }

    const needsGemini = wordData.translations.length === 0 || wordData.confidence < 70;
    if (needsGemini && settings.geminiApiKey) {
      try {
        const prompt = `Validate and enrich this ${targetLangName} word for language learners:

WORD: ${item.word}
PART OF SPEECH: ${item.partOfSpeech}
${wordData.translations.length > 0 ? `EXISTING TRANSLATIONS: ${wordData.translations.join(', ')}` : ''}

Provide:
1. Is this a valid ${targetLangName} word in dictionary form? (yes/no)
2. If yes, provide 3-5 accurate ${nativeLangName} translations (primary meaning first)
3. Brief usage note (one sentence)
4. Example sentence in ${targetLangName}
5. Confidence score (0-100)

Respond with JSON ONLY:
{
  "isValid": true,
  "translations": ["primary", "alternate1", "alternate2"],
  "description": "usage note",
  "example": "example sentence",
  "confidence": 85
}`;

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${settings.geminiApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 500 }
            })
          }
        );

        if (response.ok) {
          const data = await response.json();
          let resultText = data.candidates[0].content.parts[0].text.trim();
          if (resultText.includes('```json')) {
            resultText = resultText.split('```json')[1].split('```')[0].trim();
          } else if (resultText.includes('```')) {
            resultText = resultText.split('```')[1].split('```')[0].trim();
          }
          const geminiResult = JSON.parse(resultText);
          if (geminiResult.isValid && geminiResult.translations) {
            wordData.translations = geminiResult.translations;
            wordData.description = geminiResult.description || '';
            wordData.example = geminiResult.example || '';
            wordData.confidence = geminiResult.confidence || 85;
            wordData.source.push('gemini-validated');
          } else if (!geminiResult.isValid) {
            continue;
          }
        }
      } catch (e) {
        console.log('Gemini validation error:', e.message);
      }
    }

    if (wordData.translations.length > 0 && wordData.confidence >= 70) {
      enrichedWords.push(wordData);
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return enrichedWords;
}

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
      <div class="button-box">
        <button id="select-all-vocab" class="btn-vocab btn-select">Select All</button>
        <button id="deselect-all-vocab" class="btn-vocab btn-deselect">Deselect All</button>
        <button id="add-selected-vocab" class="btn-vocab btn-add">Add Selected (0)</button>
      </div>
      <div id="vocab-list" class="vocab-list"></div>
    </div>
  `;

  const vocabList = document.getElementById('vocab-list');
  const addSelectedBtn = document.getElementById('add-selected-vocab');

  validatedWords.forEach((item, index) => {
    const primaryTranslation = item.translations[0];
    const alternateTranslations = item.translations.slice(1).join(', ');
    const vocabItem = document.createElement('div');
    vocabItem.className = 'vocab-item';
    vocabItem.innerHTML = `
      <input type="checkbox" id="vocab-${index}" class="vocab-checkbox" data-index="${index}" checked>
      <div class="vocab-content">
        <div class="vocab-word">
          <strong>${item.word}</strong>
          ${item.confidence ? `<span class="confidence-badge">${item.confidence}%</span>` : ''}
          ${item.partOfSpeech ? `<span class="pos-badge">${item.partOfSpeech}</span>` : ''}
        </div>
        <div class="vocab-translation">
          ${primaryTranslation}
          ${alternateTranslations ? `<span class="alternates"> (also: ${alternateTranslations})</span>` : ''}
        </div>
        ${item.description ? `<div class="vocab-description">${item.description}</div>` : ''}
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
    const selectedWords = Array.from(selectedCheckboxes).map(cb => validatedWords[parseInt(cb.dataset.index)]);
    if (selectedWords.length === 0) return;

    addSelectedBtn.disabled = true;
    addSelectedBtn.textContent = 'Adding...';

    try {
      for (const item of selectedWords) {
        await flashcardDB.addFlashcard({
          word: item.word,
          language: settings.targetLanguage,
          originLanguage: settings.targetLanguage,
          targetLanguage: settings.nativeLanguage,
          translations: item.translations,
          senses: [],
          description: item.description || '',
          meta: { source: item.source || ['gemini'], confidence: item.confidence || 80 },
          addedDate: Date.now(),
          reviewCount: 0,
          correctCount: 0,
          lastReviewed: null,
          nextReview: Date.now(),
          difficulty: 2.5,
          lastInterval: 0,
          sets: []
        });
      }

      flashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
      showNotification(`Added ${selectedWords.length} words to flashcards!`, 'success');
      await updateIndexedDBStatus();
      loadFlashcardList();
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
  if (chromeAIAvailable.writer) {
    try {
      const prompt = `Explain the ${settings.targetLanguage} word "${wordPair.original}" (meaning: ${wordPair.translation}) in one simple sentence. Include when/how it's used.`;
      const result = await chromeAIBridge('generateContent', {
        prompt,
        context: 'Language learning vocabulary explanation'
      });
      if (result.success && result.content) return result.content.trim().substring(0, 200);
    } catch (e) { /* fall through */ }
  }

  if (settings.geminiApiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${settings.geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Explain "${wordPair.original}" (${wordPair.translation}) in ${settings.targetLanguage} in one simple, clear sentence.` }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 100 }
          })
        }
      );
      if (response.ok) {
        const data = await response.json();
        return data.candidates[0].content.parts[0].text.trim().substring(0, 200);
      }
    } catch (e) { /* fall through */ }
  }

  return `"${wordPair.original}" means "${wordPair.translation}" in ${settings.targetLanguage}.`;
}

async function extractAndShowVocabulary() {
  if (!transcriptSegments || transcriptSegments.length === 0) {
    showNotification('Please load subtitles first', 'error');
    return;
  }

  if (!overlay || !document.getElementById('vocabulary-tab')) {
    createOverlay();
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const vocabTab = document.getElementById('vocabulary-tab');
  if (!vocabTab) {
    showNotification('Error: UI not ready. Please refresh the page.', 'error');
    return;
  }

  vocabTab.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <h3>🔍 Step 1/2: Extracting Vocabulary...</h3>
      <p>Analyzing transcript for useful words</p>
    </div>
  `;
  switchTab('vocabulary');

  const vocabulary = await extractVocabularyFromTranscript();
  if (!vocabulary || vocabulary.length === 0) {
    if (!settings.geminiApiKey) return;
    vocabTab.innerHTML = `
      <div class="error-message">
        <h3>❌ No Vocabulary Found</h3>
        <p>Unable to extract vocabulary from this video. Try another video.</p>
        <button id="retry-extraction" class="primary-btn">Try Again</button>
      </div>
    `;
    document.getElementById('retry-extraction')?.addEventListener('click', extractAndShowVocabulary);
    return;
  }

  vocabTab.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <h3>✨ Step 2/2: Validating & Translating...</h3>
      <p>Found ${vocabulary.length} words, getting translations</p>
    </div>
  `;

  const validatedWords = await validateAndEnrichVocabulary(vocabulary);

  if (!validatedWords || validatedWords.length === 0) {
    vocabTab.innerHTML = `
      <div class="error-message">
        <h3>ℹ️ All Words Already Known</h3>
        <p>All extracted words are already in your flashcards!</p>
        <button id="retry-extraction" class="primary-btn">Try Another Video</button>
      </div>
    `;
    document.getElementById('retry-extraction')?.addEventListener('click', extractAndShowVocabulary);
    return;
  }

  await showVocabularySelector(validatedWords);
}

async function checkTranslatorReadiness(sourceLang, targetLang) {
  try {
    return await chromeAIBridge('checkTranslatorReady', { sourceLanguage: sourceLang, targetLanguage: targetLang });
  } catch (e) {
    return { ready: false, status: 'error' };
  }
}

async function waitForTranslatorDownload(sourceLang, targetLang, onProgress) {
  const maxWait = 60000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const status = await checkTranslatorReadiness(sourceLang, targetLang);
    if (status.ready) return true;
    if (status.status === 'downloading' && onProgress) onProgress(status.progress || 0);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

async function translateWordSmart(word, sourceLang, targetLang) {
  try {
    const result = await chromeAIBridge('translate', {
      text: word, sourceLanguage: sourceLang, targetLanguage: targetLang
    });
    if (result.success && result.translation) {
      const translation = result.translation.trim();
      if (translation.toLowerCase() !== word.toLowerCase()) {
        return { translation, confidence: 80, source: 'chrome-ai-translator' };
      }
    }
  } catch (e) { /* fall through */ }

  if (chromeAIAvailable.writer) {
    try {
      const result = await chromeAIBridge('generateContent', {
        prompt: `Translate the ${sourceLang} word "${word}" to ${targetLang}. Provide ONLY the ${targetLang} translation.`,
        context: `Word translation: ${sourceLang} to ${targetLang}`
      });
      if (result.success && result.content) {
        const translation = result.content.trim().replace(/['"`.]/g, '').split('\n')[0].trim();
        if (translation && translation.toLowerCase() !== word.toLowerCase()) {
          return { translation, confidence: 75, source: 'chrome-ai-writer' };
        }
      }
    } catch (e) { /* fall through */ }
  }

  if (settings.geminiApiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${settings.geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Translate this ${sourceLang} word to ${targetLang}: "${word}"\nRespond with ONLY the translation. One word or short phrase only.` }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 50 }
          })
        }
      );
      if (response.ok) {
        const data = await response.json();
        const translation = data.candidates[0].content.parts[0].text.trim()
          .replace(/['"`.]/g, '').split('\n')[0].trim();
        if (translation && translation.toLowerCase() !== word.toLowerCase()) {
          return { translation, confidence: 90, source: 'gemini-direct' };
        }
      }
    } catch (e) { /* fall through */ }
  }

  return { translation: word, confidence: 20, source: 'failed', error: true };
}
