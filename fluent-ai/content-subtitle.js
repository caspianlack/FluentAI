// Transcript extraction, subtitle observation, and language detection.

function injectPageScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function() { this.remove(); };
  (document.head || document.documentElement).appendChild(script);
}

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

      const timeInSeconds = parseTimestamp(timestampElement.textContent.trim());

      const textElement = segment.querySelector('.segment-text, yt-formatted-string.segment-text');
      if (!textElement) return;

      let text = (textElement.textContent || textElement.innerText || '')
        .replace(/\s+/g, ' ').replace(/&nbsp;/g, ' ').trim();

      if (text && timeInSeconds !== null) {
        let endTime;
        if (index < segments.length - 1) {
          const nextTimestamp = segments[index + 1].querySelector('.segment-timestamp');
          if (nextTimestamp) {
            const nextTime = parseTimestamp(nextTimestamp.textContent.trim());
            if (nextTime !== null) endTime = nextTime;
          }
        }
        if (!endTime) {
          endTime = timeInSeconds + Math.max(2, text.split(' ').length * 0.5);
        }
        transcript.push({ text, start: timeInSeconds, end: endTime, duration: endTime - timeInSeconds });
      }
    } catch (error) {
      console.warn('FluentAI: Error processing segment:', error);
    }
  });

  if (transcript.length === 0) throw new Error('No valid transcript entries extracted');

  console.log('FluentAI: Successfully extracted', transcript.length, 'transcript segments');
  return transcript;
}

async function openTranscriptPanel() {
  console.log('FluentAI: Opening transcript panel...');

  return new Promise((resolve, reject) => {
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

      let attempts = 0;
      const maxAttempts = 20;
      const checkInterval = setInterval(() => {
        attempts++;
        const segs = document.querySelectorAll('ytd-transcript-segment-renderer');
        if (segs.length > 0) {
          console.log('FluentAI: Transcript panel loaded with', segs.length, 'segments');
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

function observeSubtitles() {
  const video = document.querySelector('video');
  if (!video) {
    console.error('FluentAI: Video element not found');
    return;
  }

  console.log('FluentAI: Starting subtitle observation with delay:', settings.pauseDelay, 'seconds');

  if (videoTimeUpdateInterval) clearInterval(videoTimeUpdateInterval);

  videoTimeUpdateInterval = setInterval(() => {
    if (!settings.autoTranslate || quizMode || video.paused) return;
    if (isAdPlaying()) return;

    const currentTime = video.currentTime;

    const triggerSegment = transcriptSegments.find(segment => {
      const triggerTime = segment.end + settings.pauseDelay;
      const isAtTriggerTime = currentTime >= triggerTime && currentTime <= triggerTime + 0.2;
      const notProcessed = !segmentsProcessed.has(segment.start);
      return isAtTriggerTime && notProcessed;
    });

    if (triggerSegment) {
      segmentsProcessed.add(triggerSegment.start);
      lastProcessedSegment = triggerSegment;
      console.log('FluentAI: Triggering segment at', currentTime.toFixed(1),
        'for segment ending at', triggerSegment.end.toFixed(1));
      video.pause();
      handleNewSubtitle(triggerSegment.text, triggerSegment);
    }

    if (lastProcessedSegment && currentTime < lastProcessedSegment.start) {
      segmentsProcessed.clear();
      lastProcessedSegment = null;
    }
  }, 100);
}

async function initializeTranscript() {
  try {
    showNotification('Opening transcript panel...', 'info');

    if (isInitializingTranscript) return false;
    isInitializingTranscript = true;

    await openTranscriptPanel();
    transcriptSegments = await extractTranscriptFromDOM();

    const detectedLanguage = await detectTranscriptLanguage();

    if (detectedLanguage && detectedLanguage !== settings.targetLanguage) {
      const shouldContinue = await handleLanguageMismatch(detectedLanguage);
      if (!shouldContinue) return false;
    }

    showNotification(
      `Loaded ${transcriptSegments.length} subtitle segments! Auto-pause is ${settings.autoTranslate ? 'ON' : 'OFF'}`,
      'success'
    );

    observeSubtitles();
    return true;
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
    return false;
  } finally {
    isInitializingTranscript = false;
  }
}

async function detectTranscriptLanguage() {
  if (!chromeAIAvailable.languageDetector) return null;

  try {
    const sampleText = transcriptSegments
      .slice(0, 5).map(s => s.text).join(' ').substring(0, 1000);

    if (!sampleText || sampleText.trim().length < 10) return null;

    const result = await chromeAIBridge('detectLanguage', { text: sampleText });

    if (result.success && result.results && result.results.length > 0) {
      const top = result.results[0];
      if (top.confidence >= 0.9) return top.detectedLanguage;
    }
    return null;
  } catch (error) {
    console.error('Language detection error:', error);
    return null;
  }
}

async function handleLanguageMismatch(detectedLanguage) {
  if (!detectedLanguage) return true;

  const detectedLangName = getLanguageName(detectedLanguage);
  const targetLangName = getLanguageName(settings.targetLanguage);

  const video = document.querySelector('video');
  if (video) video.pause();

  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'fluentai-language-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3 class="modal-title">🌐 Language Mismatch Detected</h3>
        <br>
        <p>We detected the transcript is in <strong>${detectedLangName}</strong>,
        but your learning language is set to <strong>${targetLangName}</strong>.</p>
        <p><em>It is recommended to fix transcript language by changing subtitle language to ${targetLangName}.</em></p>
        <div class="language-options">
          ${detectedLanguage !== settings.nativeLanguage ? `
            <div class="option">
              <input type="radio" id="use-detected" name="language-choice" value="detected" checked>
              <label for="use-detected">
                <div class="option-title">Switch to ${detectedLangName}</div>
                <div class="option-description">Update your learning language to match the video</div>
              </label>
            </div>
          ` : ''}
          <div class="option">
            <input type="radio" id="keep-current" name="language-choice" value="current" ${detectedLanguage === settings.nativeLanguage ? 'checked' : ''}>
            <label for="keep-current">
              <div class="option-title">Keep learning ${targetLangName}</div>
              <div class="option-description">Ignore and continue with current settings</div>
            </label>
          </div>
          <div class="option">
            <input type="radio" id="cancel-load" name="language-choice" value="cancel">
            <label for="cancel-load">
              <div class="option-title">Cancel transcript loading</div>
              <div class="option-description">Find a video in your target language</div>
            </label>
          </div>
        </div>
        <div class="modal-actions">
          <button id="confirm-language" class="primary-btn">Confirm Choice</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const optionDivs = modal.querySelectorAll('.option');
    optionDivs.forEach(optionDiv => {
      optionDiv.addEventListener('click', (e) => {
        const radio = optionDiv.querySelector('input[type="radio"]');
        if (radio && e.target !== radio) {
          radio.checked = true;
          optionDivs.forEach(opt => opt.classList.remove('selected'));
          optionDiv.classList.add('selected');
        }
      });
    });

    if (optionDivs[0]) optionDivs[0].classList.add('selected');

    const confirmBtn = modal.querySelector('#confirm-language');
    if (!confirmBtn) { modal.remove(); resolve(true); return; }

    confirmBtn.focus();

    confirmBtn.addEventListener('click', async () => {
      const selectedRadio = modal.querySelector('input[name="language-choice"]:checked');
      if (!selectedRadio) return;

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Processing...';

      switch (selectedRadio.value) {
        case 'detected':
          settings.targetLanguage = detectedLanguage;
          await chrome.storage.sync.set({ targetLanguage: detectedLanguage });
          showNotification(`Learning language updated to ${detectedLangName}`, 'success');
          flashcards = await flashcardDB.getFlashcardsByLanguage(settings.targetLanguage);
          if (video) video.play();
          break;
        case 'current':
          showNotification(`Continuing with ${targetLangName}`, 'warning');
          if (video) video.play();
          break;
        case 'cancel':
          modal.remove();
          if (video) video.play();
          resolve(false);
          return;
      }

      modal.remove();
      resolve(true);
    }, { once: true });

    modal.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') confirmBtn.click();
    });
  });
}

function isAdPlaying() {
  const player = document.querySelector('.html5-video-player');
  return player ? player.classList.contains('ad-showing') : false;
}
