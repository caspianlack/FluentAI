// Shared global state for all FluentAI content scripts.
// Must be loaded first. Uses var so declarations land on the global object
// and are accessible across every other content script file.

var overlay = null;
var isEnabled = true;
var settings = {};
var currentSubtitle = '';
var chromeAIAvailable = {
  translator: false,
  languageDetector: false,
  summarizer: false,
  writer: false
};
var quizMode = false;
var currentQuiz = null;
var flashcards = [];

var transcriptSegments = [];
var videoTimeUpdateInterval = null;
var isInitializingTranscript = false;
var segmentsProcessed = new Set();
var lastProcessedSegment = null;
