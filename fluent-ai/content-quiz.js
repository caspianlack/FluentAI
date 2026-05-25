// Quiz logic, flashcard practice, and SM-2 spaced repetition.

// ─── SM-2 Spaced Repetition ──────────────────────────────────────────────────

var DAY_MS = 86400000;

// Update a card's SRS fields after a practice answer using the SM-2 algorithm.
// difficulty field stores the "easiness factor" (EF), starting at 2.5, min 1.3.
// lastInterval stores the previous interval in days so the next one can be scaled.
async function updateCardSRS(cardId, wasCorrect) {
  const card = await flashcardDB.getFlashcard(cardId);
  if (!card) return;

  const now = Date.now();
  const ef = card.difficulty || 2.5;
  const prevInterval = card.lastInterval || 1;
  const reviewCount = (card.reviewCount || 0) + 1;
  const correctCount = (card.correctCount || 0) + (wasCorrect ? 1 : 0);

  let newInterval, newEF;

  if (!wasCorrect) {
    // Reset on failure: 1-day interval, penalise EF
    newInterval = 1;
    newEF = Math.max(1.3, ef - 0.2);
  } else {
    // SM-2 quality q=4 ("correct with some hesitation")
    const q = 4;
    newEF = Math.max(1.3, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

    if (reviewCount === 1)      newInterval = 1;
    else if (reviewCount === 2) newInterval = 6;
    else                        newInterval = Math.round(prevInterval * newEF);
  }

  await flashcardDB.addFlashcard({
    ...card,
    reviewCount,
    correctCount,
    lastReviewed: now,
    nextReview: now + newInterval * DAY_MS,
    difficulty: newEF,
    lastInterval: newInterval
  });
}

// ─── Practice session ─────────────────────────────────────────────────────────

// Select cards due for review first (most overdue → highest priority), then new cards.
async function startPracticeFromOverlay() {
  try {
    const allFlashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);

    if (allFlashcards.length === 0) {
      showNotification('No flashcards available. Add some words first!', 'error');
      return;
    }

    const now = Date.now();
    // Sort most-overdue cards first; cards with no nextReview (never studied) go last
    const sorted = [...allFlashcards].sort((a, b) => {
      const aOverdue = now - (a.nextReview || now);
      const bOverdue = now - (b.nextReview || now);
      return bOverdue - aOverdue;
    });

    const practiceCards = sorted.slice(0, Math.min(10, sorted.length));
    const dueCount = practiceCards.filter(c => (c.nextReview || 0) <= now).length;

    showNotification(
      `Starting practice: ${dueCount} due card${dueCount !== 1 ? 's' : ''}, ${practiceCards.length - dueCount} new`,
      'info'
    );

    startFlashcardPractice(practiceCards);
  } catch (error) {
    console.error('Error starting practice:', error);
    showNotification('Error loading flashcards for practice', 'error');
  }
}

function startFlashcardPractice(flashcardsData) {
  if (!flashcardsData || flashcardsData.length === 0) {
    showNotification('No flashcards available for practice', 'error');
    return;
  }

  const languageFlashcards = flashcardsData.filter(fc => fc.language === settings.targetLanguage);
  if (languageFlashcards.length === 0) {
    showNotification(`No flashcards for ${getLanguageName(settings.targetLanguage)}`, 'error');
    return;
  }

  quizMode = true;
  const quizOverlay = document.getElementById('quiz-overlay');
  if (quizOverlay) quizOverlay.style.display = 'flex';

  const video = document.querySelector('video');
  if (video) video.pause();

  generateFlashcardQuiz(languageFlashcards);
}

function generateFlashcardQuiz(flashcardsData) {
  const shuffledCards = [...flashcardsData].sort(() => Math.random() - 0.5);
  const quizQuestions = [];

  for (let i = 0; i < Math.min(5, shuffledCards.length); i++) {
    const card = shuffledCards[i];
    const wrongAnswers = shuffledCards
      .filter(fc => fc.id !== card.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map(fc => fc.translations[0]);

    quizQuestions.push({
      type: 'multiple-choice',
      question: `What does "${card.word}" mean?`,
      options: [...wrongAnswers, card.translations[0]].sort(() => Math.random() - 0.5),
      correct: card.translations[0],
      cardId: card.id  // needed for SRS update
    });
  }

  currentQuiz = { questions: quizQuestions, currentIndex: 0, score: 0, answers: [] };
  displayQuestion(0);
}

// ─── AI-generated quiz ────────────────────────────────────────────────────────

async function startQuiz() {
  quizMode = true;
  const quizOverlay = document.getElementById('quiz-overlay');
  if (!quizOverlay) { console.error('Quiz overlay not found'); return; }
  quizOverlay.style.display = 'flex';
  const video = document.querySelector('video');
  if (video) video.pause();
  await generateQuiz();
}

async function generateQuiz() {
  const quizContent = document.getElementById('quiz-content');
  const languageFlashcards = flashcards.filter(fc => fc.language === settings.targetLanguage);

  if (!currentSubtitle && languageFlashcards.length === 0) {
    quizContent.innerHTML = '<p class="quiz-message">No content available for quiz. Watch more videos or add flashcards!</p>';
    return;
  }

  let quizQuestions = [];

  if (chromeAIAvailable.writer) {
    try {
      const context = currentSubtitle || languageFlashcards.map(fc => `${fc.word}: ${fc.translations[0]}`).join(', ');
      const prompt = `Generate 3 language learning quiz questions based on: ${context}. Format as multiple choice with 4 options each.`;
      const response = await chromeAIBridge('generateContent', { prompt, context: 'Language quiz generation' });
      if (response.success) quizQuestions = parseWriterResponse(response.content);
    } catch (e) {
      quizQuestions = generateFallbackQuiz();
    }
  } else if (settings.geminiApiKey) {
    quizQuestions = await generateGeminiQuiz();
  } else {
    quizQuestions = generateFallbackQuiz();
  }

  displayQuiz(quizQuestions);
}

function generateFallbackQuiz() {
  const questions = [];
  const languageFlashcards = flashcards.filter(fc => fc.language === settings.targetLanguage);

  if (languageFlashcards.length >= 4) {
    const selectedCard = languageFlashcards[Math.floor(Math.random() * languageFlashcards.length)];
    const wrongAnswers = languageFlashcards
      .filter(fc => fc.id !== selectedCard.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map(fc => fc.translations[0]);

    questions.push({
      type: 'multiple-choice',
      question: `What does "${selectedCard.word}" mean?`,
      options: [...wrongAnswers, selectedCard.translations[0]].sort(() => Math.random() - 0.5),
      correct: selectedCard.translations[0],
      cardId: selectedCard.id
    });
  }

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

  return questions;
}

async function generateGeminiQuiz() {
  if (!settings.geminiApiKey) return generateFallbackQuiz();

  try {
    const languageFlashcards = flashcards.filter(fc => fc.language === settings.targetLanguage);
    const context = currentSubtitle || languageFlashcards.map(fc => `${fc.word}: ${fc.translations[0]}`).join(', ');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${settings.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Create 3 language learning quiz questions for ${getLanguageName(settings.targetLanguage)} learners. Context: "${context}".
Return JSON:
[{"type":"multiple-choice","question":"question text","options":["a","b","c","d"],"correct":"correct answer"}]`
            }]
          }]
        })
      }
    );

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('Gemini quiz generation error:', error);
  }

  return generateFallbackQuiz();
}

function parseWriterResponse(response) {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('Error parsing Writer response:', e);
  }
  return generateFallbackQuiz();
}

// ─── Quiz display ─────────────────────────────────────────────────────────────

function displayQuiz(questions) {
  const quizContent = document.getElementById('quiz-content');
  if (questions.length === 0) {
    quizContent.innerHTML = '<p class="quiz-message">No quiz questions available. Try again later!</p>';
    return;
  }
  currentQuiz = { questions, currentIndex: 0, score: 0, answers: [] };
  displayQuestion(0);
}

function displayQuestion(index) {
  const question = currentQuiz.questions[index];
  const quizContent = document.getElementById('quiz-content');

  let html = `
    <div class="quiz-progress">Question ${index + 1} of ${currentQuiz.questions.length}</div>
    <div class="quiz-question"><h3>${question.question}</h3>
  `;

  switch (question.type) {
    case 'multiple-choice':
      html += '<div class="quiz-options">';
      question.options.forEach((option, i) => {
        html += `<button class="quiz-option" data-answer="${option}">${String.fromCharCode(65 + i)}. ${option}</button>`;
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

  if (question.type === 'multiple-choice') {
    document.querySelectorAll('.quiz-option').forEach(btn => {
      btn.addEventListener('click', (e) => checkQuizAnswer(e.target.dataset.answer));
    });
  } else if (question.type === 'fill-blank') {
    document.getElementById('submit-blank-btn')?.addEventListener('click', () => {
      checkQuizAnswer(document.getElementById('blank-answer').value.trim());
    });
    document.getElementById('blank-answer')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') checkQuizAnswer(document.getElementById('blank-answer').value.trim());
    });
  } else if (question.type === 'translation') {
    document.getElementById('submit-translation-btn')?.addEventListener('click', checkTranslationAnswer);
    document.getElementById('translation-answer')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') checkTranslationAnswer();
    });
  }
}

function checkQuizAnswer(answer) {
  const question = currentQuiz.questions[currentQuiz.currentIndex];
  const isCorrect = answer === question.correct;

  if (isCorrect) {
    currentQuiz.score++;
    showNotification('Correct! 🎉', 'success');
  } else {
    showNotification(`Incorrect. The answer was: ${question.correct}`, 'error');
  }

  // Update SRS for flashcard-based questions
  if (question.cardId) {
    updateCardSRS(question.cardId, isCorrect);
  }

  currentQuiz.answers.push({ question: question.question, answer, isCorrect });
  proceedToNextQuestion();
}

async function checkTranslationAnswer() {
  const answer = document.getElementById('translation-answer')?.value.trim();
  const question = currentQuiz.questions[currentQuiz.currentIndex];

  if (!answer) { showNotification('Please enter an answer', 'error'); return; }

  if (chromeAIAvailable.translator) {
    try {
      const correctTranslation = await translateText(question.word, settings.targetLanguage, settings.nativeLanguage);
      const isCorrect = answer.toLowerCase() === correctTranslation.toLowerCase();

      if (isCorrect) { currentQuiz.score++; showNotification('Correct! 🎉', 'success'); }
      else { showNotification(`The translation was: ${correctTranslation}`, 'error'); }

      if (question.cardId) updateCardSRS(question.cardId, isCorrect);

      currentQuiz.answers.push({ question: question.question, userAnswer: answer, correctAnswer: correctTranslation, isCorrect });
    } catch (e) {
      currentQuiz.score++;
      currentQuiz.answers.push({ question: question.question, userAnswer: answer, correctAnswer: 'Could not verify', isCorrect: true });
    }
  } else {
    currentQuiz.score++;
    currentQuiz.answers.push({ question: question.question, userAnswer: answer, correctAnswer: 'Not verified', isCorrect: true });
  }

  proceedToNextQuestion();
}

function proceedToNextQuestion() {
  if (currentQuiz.currentIndex < currentQuiz.questions.length - 1) {
    currentQuiz.currentIndex++;
    setTimeout(() => displayQuestion(currentQuiz.currentIndex), 1500);
  } else {
    setTimeout(showQuizResults, 1500);
  }
}

function showQuizResults() {
  const quizContent = document.getElementById('quiz-content');
  const percentage = Math.round((currentQuiz.score / currentQuiz.questions.length) * 100);

  let html = `
    <div class="quiz-results">
      <h2>Quiz Complete! 🎊</h2>
      <div class="quiz-score">
        <div class="score-circle"><span class="score-percentage">${percentage}%</span></div>
        <p>You got ${currentQuiz.score} out of ${currentQuiz.questions.length} correct!</p>
      </div>
      <div class="quiz-review"><h3>Review:</h3>
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
      <button class="quiz-action-btn" id="try-another-quiz-btn">Try Another Quiz</button>
      <button class="quiz-action-btn secondary" id="close-quiz-btn-results">Close</button>
    </div>
  `;

  quizContent.innerHTML = html;
  document.getElementById('try-another-quiz-btn')?.addEventListener('click', startQuiz);
  document.getElementById('close-quiz-btn-results')?.addEventListener('click', closeQuiz);
  updateQuizStats(currentQuiz.score, currentQuiz.questions.length);
}

function closeQuiz() {
  const quizOverlay = document.getElementById('quiz-overlay');
  if (quizOverlay) quizOverlay.style.display = 'none';
  quizMode = false;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function updateQuizStats(correct, total) {
  const incorrect = total - correct;
  chrome.storage.sync.get(['stats'], (result) => {
    const stats = result.stats || { correct: 0, incorrect: 0, streak: 0, total: 0 };
    stats.correct += correct;
    stats.incorrect += incorrect;
    stats.total += total;
    stats.streak = (correct === total) ? stats.streak + 1 : 0;
    chrome.storage.sync.set({ stats });
    updateStats();
  });
}

function updateStats() {
  chrome.storage.sync.get(['stats'], (result) => {
    const stats = result.stats || { correct: 0, incorrect: 0, streak: 0, total: 0 };
    const el = (id) => document.getElementById(id);
    if (el('correct-count')) el('correct-count').textContent = stats.correct;
    if (el('incorrect-count')) el('incorrect-count').textContent = stats.incorrect;
    if (el('streak-count')) el('streak-count').textContent = stats.streak;
    if (el('accuracy')) {
      const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
      el('accuracy').textContent = `${accuracy}%`;
    }
  });
}
