// Flashcard CRUD UI — add, edit, delete, search, import/export, list rendering.

async function updateIndexedDBStatus() {
  try {
    const stats = await flashcardDB.getStats(settings.targetLanguage);
    const element = document.getElementById('indexeddb-status');
    if (element) {
      element.innerHTML = `💾 IndexedDB: <strong>✅ Ready (${stats.total} ${settings.targetLanguage} cards)</strong>`;
    }
    const flashcardCountElement = document.getElementById('flashcard-count');
    if (flashcardCountElement) flashcardCountElement.textContent = stats.total;
  } catch (error) {
    const element = document.getElementById('indexeddb-status');
    if (element) element.innerHTML = `💾 IndexedDB: <strong>❌ Error</strong>`;
  }
}

function showAddCardModal() {
  const vocabTab = document.getElementById('vocabulary-tab');
  if (!vocabTab) return;

  vocabTab.innerHTML = `
    <div class="add-card-modal">
      <div class="modal-header">
        <h3>➕ Add New Flashcard</h3>
        <button class="close-btn" id="close-add-card">✕</button>
      </div>
      <div class="add-card-form">
        <div class="form-group">
          <label for="new-word">${getLanguageName(settings.targetLanguage)} Word:</label>
          <input type="text" id="new-word" placeholder="Enter word..." autofocus />
        </div>
        <div class="form-group">
          <label for="new-translation">${getLanguageName(settings.nativeLanguage)} Translation:</label>
          <input type="text" id="new-translation" placeholder="Enter translations (comma-separated: cold, flu, illness)" />
          <button class="action-btn" id="auto-translate-btn">🌐 Auto-Translate</button>
        </div>
        <div class="form-group">
          <label for="new-description">Description (optional):</label>
          <textarea id="new-description" placeholder="Add usage notes, example sentences, etc." rows="3"></textarea>
        </div>
        <div class="form-actions">
          <button class="action-btn" id="cancel-add-card">Cancel</button>
          <button class="primary-btn" id="save-new-card">Save Card</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('close-add-card')?.addEventListener('click', loadFlashcardList);
  document.getElementById('cancel-add-card')?.addEventListener('click', loadFlashcardList);
  document.getElementById('save-new-card')?.addEventListener('click', saveNewCard);
  document.getElementById('auto-translate-btn')?.addEventListener('click', autoTranslateNewCard);
  document.getElementById('new-translation')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') saveNewCard();
  });
}

async function autoTranslateNewCard() {
  const wordInput = document.getElementById('new-word');
  const translationInput = document.getElementById('new-translation');
  const translateBtn = document.getElementById('auto-translate-btn');
  const word = wordInput?.value.trim();

  if (!word) { showNotification('Please enter a word first', 'error'); return; }

  translateBtn.textContent = '⏳ Translating...';
  translateBtn.disabled = true;

  try {
    const result = await translateWordSmart(word, settings.targetLanguage, settings.nativeLanguage);
    if (result && !result.error) {
      translationInput.value = result.translation;
      showNotification('Translation added!', 'success');
    } else {
      showNotification('Translation failed', 'error');
    }
  } catch (error) {
    console.error('Auto-translate error:', error);
    showNotification('Translation error', 'error');
  }

  translateBtn.textContent = '🌐 Auto-Translate';
  translateBtn.disabled = false;
}

async function saveNewCard() {
  const word = document.getElementById('new-word')?.value.trim();
  const translationInput = document.getElementById('new-translation')?.value.trim();
  const description = document.getElementById('new-description')?.value.trim();

  if (!word || !translationInput) {
    showNotification('Please fill in both word and translation', 'error');
    return;
  }

  const translations = translationInput.split(',').map(t => t.trim()).filter(t => t.length > 0);
  if (translations.length === 0) {
    showNotification('Please enter at least one translation', 'error');
    return;
  }

  try {
    await flashcardDB.addFlashcard({
      word,
      language: settings.targetLanguage,
      originLanguage: settings.targetLanguage,
      targetLanguage: settings.nativeLanguage,
      translations,
      senses: [],
      description,
      meta: { source: ['manual'], confidence: 100 }
    });

    flashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
    showNotification(`Flashcard added with ${translations.length} translation(s)!`, 'success');
    loadFlashcardList();
    updateIndexedDBStatus();
  } catch (error) {
    console.error('Error adding flashcard:', error);
    showNotification('Error adding flashcard', 'error');
  }
}

function showDeleteConfirmation(card) {
  const vocabTab = document.getElementById('vocabulary-tab');
  if (!vocabTab) return;

  vocabTab.innerHTML = `
    <div class="delete-confirmation-modal">
      <div class="modal-content">
        <h3>🗑️ Delete Flashcard?</h3>
        <div class="card-preview">
          <div class="preview-word"><strong>${card.word}</strong></div>
          <div class="preview-translation">${card.translations ? card.translations[0] : 'No translation'}</div>
        </div>
        <p>Are you sure you want to delete this flashcard? This action cannot be undone.</p>
        <div class="button-box">
          <button class="cancel-btn" id="cancel-delete">Cancel</button>
          <button class="fluentai-skip-btn" id="confirm-delete">Delete</button>
        </div>
      </div>
    </div>
  `;

  switchTab('vocabulary');
  document.getElementById('cancel-delete')?.addEventListener('click', loadFlashcardList);
  document.getElementById('confirm-delete')?.addEventListener('click', async () => {
    try {
      await flashcardDB.deleteFlashcard(card.id);
      flashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
      showNotification('Flashcard deleted', 'success');
      loadFlashcardList();
      updateIndexedDBStatus();
    } catch (error) {
      console.error('Error deleting flashcard:', error);
      showNotification('Error deleting flashcard', 'error');
      loadFlashcardList();
    }
  });
}

function showEditCardModal(card) {
  const vocabTab = document.getElementById('vocabulary-tab');
  if (!vocabTab) return;

  const translationsText = card.translations ? card.translations.join(', ') : '';

  vocabTab.innerHTML = `
    <div class="add-card-modal">
      <div class="modal-header">
        <h3>✏️ Edit Flashcard</h3>
        <button class="close-btn" id="close-edit-card">✕</button>
      </div>
      <div class="add-card-form">
        <div class="form-group">
          <label for="edit-word">${getLanguageName(settings.targetLanguage)} Word:</label>
          <input type="text" id="edit-word" value="${card.word}" autofocus />
        </div>
        <div class="form-group">
          <label for="edit-translation">${getLanguageName(settings.nativeLanguage)} Translations:</label>
          <input type="text" id="edit-translation" value="${translationsText}" placeholder="Comma-separated: cold, flu, illness" />
        </div>
        <div class="form-group">
          <label for="edit-description">Description (optional):</label>
          <textarea id="edit-description" rows="3">${card.description || ''}</textarea>
        </div>
        <div class="button-box">
          <button class="cancel-btn" id="cancel-edit-card">Cancel</button>
          <button class="fluentai-skip-btn" id="save-edit-card">Save Changes</button>
        </div>
      </div>
    </div>
  `;

  switchTab('vocabulary');
  document.getElementById('close-edit-card')?.addEventListener('click', loadFlashcardList);
  document.getElementById('cancel-edit-card')?.addEventListener('click', loadFlashcardList);
  document.getElementById('save-edit-card')?.addEventListener('click', async () => {
    await saveEditedCard(card.id);
  });
}

async function saveEditedCard(cardId) {
  const word = document.getElementById('edit-word')?.value.trim();
  const translationInput = document.getElementById('edit-translation')?.value.trim();
  const description = document.getElementById('edit-description')?.value.trim();

  if (!word || !translationInput) {
    showNotification('Please fill in both word and translations', 'error');
    return;
  }

  const translations = translationInput.split(',').map(t => t.trim()).filter(t => t.length > 0);
  if (translations.length === 0) {
    showNotification('Please enter at least one translation', 'error');
    return;
  }

  try {
    const existingCard = await flashcardDB.getFlashcard(cardId);
    if (!existingCard) { showNotification('Card not found', 'error'); return; }

    await flashcardDB.addFlashcard({ ...existingCard, word, translations, description });
    flashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
    showNotification('Flashcard updated!', 'success');
    loadFlashcardList();
    updateIndexedDBStatus();
  } catch (error) {
    console.error('Error updating flashcard:', error);
    showNotification('Error updating flashcard', 'error');
  }
}

async function loadFlashcardList() {
  const vocabTab = document.getElementById('vocabulary-tab');
  if (!vocabTab) return;

  const cards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);

  vocabTab.innerHTML = `
    <div class="vocabulary-header">
      <h3>📚 My Flashcards</h3>
      <div class="vocabulary-stats">
        <p>🎯 Total Cards: <span id="flashcard-count">${cards.length}</span></p>
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
      ${cards.length === 0
        ? `<p class="empty-state">No flashcards for ${getLanguageName(settings.targetLanguage)} yet.<br>Add your first one or extract vocabulary from YouTube videos!</p>`
        : cards.map(card => `
          <div class="flashcard-item" data-id="${card.id}">
            <div class="flashcard-content">
              <div class="flashcard-word">
                <strong>${card.word}</strong>
                ${card.meta?.confidence ? `<span class="confidence-badge">${card.meta.confidence}%</span>` : ''}
              </div>
              <div class="flashcard-translation">
                ${card.translations[0]}
                ${card.translations.length > 1 ? `<span class="alternates"> (+${card.translations.length - 1} more)</span>` : ''}
              </div>
              ${card.description ? `<div class="flashcard-description">${card.description}</div>` : ''}
            </div>
            <div class="flashcard-actions-mini">
              <button class="edit-card-btn" data-id="${card.id}">✏️</button>
              <button class="delete-card-btn" data-id="${card.id}">🗑️</button>
            </div>
          </div>
        `).join('')
      }
    </div>
  `;

  document.getElementById('add-new-card-btn')?.addEventListener('click', showAddCardModal);
  document.getElementById('practice-now-btn')?.addEventListener('click', startPracticeFromOverlay);
  document.getElementById('export-flashcards-btn')?.addEventListener('click', exportFlashcards);
  document.getElementById('import-flashcards-btn')?.addEventListener('click', importFlashcards);
  document.getElementById('flashcard-search')?.addEventListener('input', searchFlashcards);
  document.getElementById('extract-vocab-btn')?.addEventListener('click', extractAndShowVocabulary);

  document.querySelectorAll('.delete-card-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cardId = parseFloat(btn.dataset.id);
      const allCards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
      const card = allCards.find(c => c.id === cardId);
      if (card) showDeleteConfirmation(card);
    });
  });

  document.querySelectorAll('.edit-card-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cardId = parseFloat(btn.dataset.id);
      const allCards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
      const card = allCards.find(c => c.id === cardId);
      if (card) showEditCardModal(card);
    });
  });
}

function searchFlashcards(e) {
  const query = e.target.value.toLowerCase();
  document.querySelectorAll('.flashcard-item').forEach(item => {
    const word = item.querySelector('.flashcard-word').textContent.toLowerCase();
    const translation = item.querySelector('.flashcard-translation').textContent.toLowerCase();
    item.style.display = (word.includes(query) || translation.includes(query)) ? 'flex' : 'none';
  });
}

async function exportFlashcards() {
  try {
    const allFlashcards = await flashcardDB.getAllFlashcards();
    const dataStr = JSON.stringify(allFlashcards, null, 2);
    const url = URL.createObjectURL(new Blob([dataStr], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fluentai-flashcards-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('Flashcards exported!', 'success');
  } catch (error) {
    console.error('Export error:', error);
    showNotification('Export failed', 'error');
  }
}

function importFlashcards() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const importedCards = JSON.parse(await file.text());
      await flashcardDB.addFlashcards(importedCards);
      flashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
      showNotification(`Imported ${importedCards.length} flashcards!`, 'success');
      loadFlashcardList();
      updateIndexedDBStatus();
    } catch (error) {
      console.error('Import error:', error);
      showNotification('Import failed - invalid file', 'error');
    }
  };

  input.click();
}

async function addToFlashcards(word, translation) {
  await flashcardDB.addFlashcard({
    word,
    language: settings.targetLanguage,
    originLanguage: settings.targetLanguage,
    targetLanguage: settings.nativeLanguage,
    translations: Array.isArray(translation) ? translation : [translation],
    senses: [],
    description: '',
    meta: { source: ['manual'], confidence: 100 },
    addedDate: Date.now(),
    reviewCount: 0,
    correctCount: 0,
    lastReviewed: null,
    nextReview: Date.now(),
    difficulty: 0,
    sets: []
  });

  flashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
  updateIndexedDBStatus();
  showNotification(`Added "${word}" to flashcards!`, 'success');
}

async function createFlashcardsFromVocab() {
  // Legacy: batch-add all words from the old vocabularySet.
  // The current flow uses validateAndEnrichVocabulary + showVocabularySelector instead.
  showNotification('Use "Extract Vocabulary from Video" to add words.', 'info');
}
