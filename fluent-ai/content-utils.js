// Pure utility functions — no DOM access, no globals, no side effects.

var STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
  'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'now', 'here',
  'there', 'then', 'them', 'their', 'my', 'your', 'his', 'her', 'its',
  'our', 'get', 'go', 'got', 'going', 'went', 'gone',
  // Spanish
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'pero',
  'de', 'del', 'al', 'en', 'con', 'por', 'para', 'como', 'más', 'que',
  'es', 'son', 'era', 'están', 'esto', 'eso', 'mi', 'tu', 'su',
  // French
  'le', 'la', 'les', 'un', 'une', 'des', 'et', 'ou', 'mais', 'de', 'du',
  'dans', 'sur', 'avec', 'par', 'pour', 'comme', 'plus', 'que', 'est',
  'sont', 'ce', 'cette', 'ces', 'mon', 'ton', 'son',
  // German
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem',
  'und', 'oder', 'aber', 'von', 'zu', 'in', 'mit', 'auf', 'für', 'ist',
  'sind', 'war', 'waren', 'dieser', 'diese', 'dieses', 'mein', 'dein', 'sein'
]);

function getLanguageName(code) {
  if (!code) return 'Unknown';
  const languages = {
    'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
    'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese', 'pt': 'Portuguese',
    'it': 'Italian', 'ru': 'Russian', 'ar': 'Arabic', 'hi': 'Hindi'
  };
  return languages[code] || code.toUpperCase();
}

function parseTimestamp(timestampStr) {
  try {
    const parts = timestampStr.split(':');
    if (parts.length === 2) {
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    } else if (parts.length === 3) {
      return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
    }
    return null;
  } catch (e) {
    console.warn('FluentAI: Error parsing timestamp:', timestampStr, e);
    return null;
  }
}

function cleanWord(word) {
  if (!word) return '';
  return word
    .toLowerCase()
    .trim()
    .replace(/[^\w\s'-]/g, '')
    .replace(/^['"-]+|['"-]+$/g, '');
}

function isValidWord(word, difficulty) {
  if (!word || word.length < 2) return false;
  if (/^\d+$/.test(word)) return false;
  if (STOP_WORDS.has(word.toLowerCase())) return false;
  const minLength = ({ beginner: 3, intermediate: 3, advanced: 2 })[difficulty] || 3;
  if (word.length < minLength) return false;
  if (!/[a-zA-Z]/.test(word)) return false;
  return true;
}

function levenshteinDistance(str1, str2) {
  const matrix = [];
  for (let i = 0; i <= str2.length; i++) matrix[i] = [i];
  for (let j = 0; j <= str1.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[str2.length][str1.length];
}

function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  if (longer.length === 0) return 1.0;
  return (longer.length - levenshteinDistance(longer, shorter)) / parseFloat(longer.length);
}

function calculateWordSimilarity(word1, word2) {
  if (word1 === word2) return 1.0;
  const distance = levenshteinDistance(word1, word2);
  const maxLength = Math.max(word1.length, word2.length);
  const baseSimilarity = (maxLength - distance) / maxLength;
  if (baseSimilarity >= 0.7) {
    const variations = [
      { pattern: /(.{3,})[aeiou]?$/, weight: 0.1 },
      { pattern: /(.{2,})(.)\2?$/, weight: 0.1 },
      { pattern: /^'?(.+?)'?$/, weight: 0.15 },
      { pattern: /^i\s(.+)/, weight: 0.2 }
    ];
    let boost = 0;
    for (const v of variations) {
      const m1 = word1.replace(/^i\s(.+)/, 'i$1');
      const m2 = word2.replace(/^i\s(.+)/, 'i$1');
      if (m1 === m2) boost += v.weight;
    }
    return Math.min(1.0, baseSimilarity + boost);
  }
  return baseSimilarity;
}

function calculateEnhancedSimilarity(str1, str2) {
  const normalize = (s) => s.toLowerCase().replace(/[.,!?;:'"()]/g, '').replace(/\s+/g, ' ').trim();
  const n1 = normalize(str1);
  const n2 = normalize(str2);
  if (n1 === n2) return { score: 1.0, breakdown: 'exact match' };
  const score = calculateSimilarity(n1, n2);
  return { score, breakdown: { similarity: Math.round(score * 100) } };
}

function parseAIResponse(content) {
  try {
    let jsonText = content.trim();
    if (jsonText.includes('```json')) {
      jsonText = jsonText.split('```json')[1].split('```')[0].trim();
    } else if (jsonText.includes('```')) {
      jsonText = jsonText.split('```')[1].split('```')[0].trim();
    }
    return JSON.parse(jsonText);
  } catch (e) {
    console.error('Failed to parse AI response:', e);
    return { correct: false, confidence: 50, feedback: 'Unable to evaluate translation', note: 'Please try again' };
  }
}

function fallbackSimilarityCheck(userAnswer, correctTranslation) {
  const similarity = calculateEnhancedSimilarity(userAnswer, correctTranslation);
  return {
    correct: similarity.score >= 0.75,
    confidence: Math.round(similarity.score * 100),
    feedback: similarity.score >= 0.75 ? 'Good job! ✅' : 'Not quite right ❌',
    note: similarity.score >= 0.75 ? 'Close enough!' : 'Try again'
  };
}
