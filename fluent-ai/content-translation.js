// Translation checking, AI evaluation, Gemini validation, and subtitle display.
// All Gemini calls use gemini-2.5-flash consistently.

async function checkTranslation() {
  const userInput = document.getElementById('fluentai-input')?.value.trim();
  if (!userInput || !currentSubtitle) return;

  const feedbackDiv = document.getElementById('fluentai-feedback');
  feedbackDiv.innerHTML = '<div class="fluentai-loading">Checking translation...</div>';

  try {
    const correctTranslation = await translateText(currentSubtitle, settings.targetLanguage, settings.nativeLanguage);
    const evaluation = await evaluateTranslationWithAI(
      userInput, correctTranslation, currentSubtitle,
      settings.targetLanguage, settings.nativeLanguage
    );
    displayEvaluationResult(evaluation, userInput, correctTranslation, currentSubtitle);
  } catch (error) {
    feedbackDiv.innerHTML = '<div class="error">Error checking translation</div>';
  }
}

async function evaluateTranslationWithAI(userAnswer, chromeTranslation, sourceText, sourceLang, targetLang) {
  const prompt = `You are a friendly language tutor. A student just translated this ${sourceLang} phrase to ${targetLang}.

  SOURCE (${sourceLang}): "${sourceText}"
  STUDENT'S TRANSLATION: "${userAnswer}"
  EXPECTED TRANSLATION: "${chromeTranslation}"

  Evaluate the student's translation and respond directly to them in first person.

  Consider:
  - Is the meaning correct? (most important)
  - Are there minor spelling/grammar issues that don't affect understanding?
  - Is the phrasing natural in ${targetLang}?
  - Are there different but valid ways to say the same thing?

  Respond with JSON only:
  {
    "correct": true/false,
    "confidence": 0-100,
    "feedback": "Direct feedback to the student in first person (2-3 sentences max)",
    "note": "Brief explanation of what was correct/incorrect"
  }`;

  try {
    const result = await chromeAIBridge('generateContent', {
      prompt,
      context: 'Translation evaluation for language learning'
    });
    if (result.success) return parseAIResponse(result.content);
  } catch (e) {
    console.log('Chrome AI Writer failed, using similarity check');
  }

  return fallbackSimilarityCheck(userAnswer, chromeTranslation);
}

function displayEvaluationResult(evaluation, userInput, correctTranslation, sourceText) {
  const feedbackDiv = document.getElementById('fluentai-feedback');

  if (evaluation.correct) {
    feedbackDiv.innerHTML = `
      <div class="success">${evaluation.feedback}</div>
      <div class="correct-answer">"${sourceText}" → "${correctTranslation}"</div>
      ${evaluation.note ? `<div class="note">${evaluation.note}</div>` : ''}
    `;
    updateQuizStats(1, 1);

    if (settings.autoPlayAfterCorrect !== false) {
      let countdown = 3;
      const countdownElement = document.createElement('div');
      countdownElement.className = 'auto-play-countdown';
      countdownElement.innerHTML = `Auto-playing in ${countdown} seconds...`;
      feedbackDiv.appendChild(countdownElement);

      const countdownInterval = setInterval(() => {
        countdown--;
        countdownElement.textContent = `Auto-playing in ${countdown} seconds...`;
        if (countdown <= 0) {
          clearInterval(countdownInterval);
          skipSubtitle();
          if (settings.autoTranslate) document.querySelector('video')?.play();
        }
      }, 1000);
    } else {
      document.getElementById('fluentai-input').value = '';
    }
  } else {
    feedbackDiv.innerHTML = `
      <div class="incorrect">${evaluation.feedback}</div>
      <div class="correct-answer">Suggested: "${correctTranslation}"</div>
      ${evaluation.note ? `<div class="note">${evaluation.note}</div>` : ''}
      ${settings.geminiApiKey ? `
        <button id="verify-with-gemini" class="gemini-verify-btn">
          🤖 Think this is wrong? Verify with Gemini
        </button>
      ` : ''}
    `;
    document.getElementById('verify-with-gemini')?.addEventListener('click',
      () => verifyWithGemini(userInput, correctTranslation, sourceText));
    updateQuizStats(0, 1);
  }
}

async function verifyWithGemini(userInput, chromeTranslation, sourceText) {
  const button = document.getElementById('verify-with-gemini');
  button.textContent = '⏳ Asking Gemini...';
  button.disabled = true;

  const result = await validateWithGemini(
    userInput, chromeTranslation, sourceText,
    settings.targetLanguage, settings.nativeLanguage
  );

  const feedbackDiv = document.getElementById('fluentai-feedback');
  feedbackDiv.innerHTML = `
    <div class="${result.correct ? 'success' : 'incorrect'}">
      ${result.correct ? '✅' : '❌'} Gemini: ${result.feedback}
    </div>
    <div class="correct-answer">"${result.correctAnswer}"</div>
  `;

  if (result.correct) {
    updateQuizStats(1, 0);

    if (settings.autoPlayAfterCorrect !== false) {
      let countdown = 4;
      const countdownElement = document.createElement('div');
      countdownElement.className = 'auto-play-countdown';
      countdownElement.innerHTML = `Auto-playing in ${countdown} seconds...`;
      feedbackDiv.appendChild(countdownElement);

      const countdownInterval = setInterval(() => {
        countdown--;
        countdownElement.textContent = `Auto-playing in ${countdown} seconds...`;
        if (countdown <= 0) {
          clearInterval(countdownInterval);
          skipSubtitle();
          if (settings.autoTranslate) document.querySelector('video')?.play();
        }
      }, 1000);
    }
  }
}

async function translateWithGemini(text) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${settings.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Translate this ${getLanguageName(settings.targetLanguage)} text to ${getLanguageName(settings.nativeLanguage)}. Only provide the translation, nothing else: "${text}"`
            }]
          }]
        })
      }
    );
    const data = await response.json();
    return data.candidates[0].content.parts[0].text.trim();
  } catch (error) {
    console.error('Gemini translation error:', error);
    return null;
  }
}

async function validateWithGemini(userAnswer, chromeTranslation, sourceText, sourceLang, targetLang) {
  try {
    const prompt = `You are a language learning tutor. Evaluate this translation exercise.

    SOURCE TEXT (${getLanguageName(sourceLang)}): "${sourceText}"
    CHROME AI TRANSLATION (${getLanguageName(targetLang)}): "${chromeTranslation}"
    STUDENT ANSWER (${getLanguageName(targetLang)}): "${userAnswer}"

    Tasks:
    1. Is the student's answer correct? (Consider natural phrasing, not just literal translation)
    2. Is Chrome AI's translation accurate?
    3. Provide constructive feedback for the student

    Respond with JSON only, no other text:
    {
      "studentCorrect": true or false,
      "chromeCorrect": true or false,
      "bestTranslation": "the most natural translation",
      "feedback": "encouraging feedback for student (2-3 sentences max)",
      "confidence": 0-100
    }`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${settings.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    const data = await response.json();
    let resultText = data.candidates[0].content.parts[0].text.trim();
    if (resultText.includes('```json')) {
      resultText = resultText.split('```json')[1].split('```')[0].trim();
    } else if (resultText.includes('```')) {
      resultText = resultText.split('```')[1].split('```')[0].trim();
    }

    const result = JSON.parse(resultText);
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
      error: true
    };
  }
}

async function handleNewSubtitle(text, segment) {
  currentSubtitle = text;

  const subtitleDisplay = document.getElementById('subtitle-display');
  if (subtitleDisplay) {
    subtitleDisplay.innerHTML = `
      <div class="subtitle-header">🎯 Translate what you just heard:</div>
      <div class="subtitle-content">
        <div class="subtitle-text">${text}</div>
        <button class="speak-btn" id="speak-btn">🔊</button>
      </div>
    `;
    document.getElementById('speak-btn')?.addEventListener('click', () => speakSubtitle(text));
  }

  if (settings.autoTranslate) {
    const video = document.querySelector('video');
    if (video && !isAdPlaying()) {
      setTimeout(() => {
        if (!isAdPlaying()) video.pause();
      }, (settings.pauseDelay || 1) * 1000);
    }
  }

  const inputField = document.getElementById('fluentai-input');
  if (inputField) {
    inputField.value = '';
    inputField.focus();
    inputField.placeholder = 'Type your translation...';
  }

  const feedbackDiv = document.getElementById('fluentai-feedback');
  if (feedbackDiv) feedbackDiv.innerHTML = '';

  updatePauseStatus('Review & Translate');
}

function speakSubtitle(text) {
  if (!text) return;
  if (!('speechSynthesis' in window)) {
    showNotification('Text-to-speech not supported in this browser', 'error');
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = settings.targetLanguage;
  utterance.rate = 0.8;
  utterance.pitch = 1;
  utterance.onstart = () => showNotification('🔊 Playing audio...', 'info');
  utterance.onerror = () => showNotification('Error playing audio', 'error');
  window.speechSynthesis.speak(utterance);
}
