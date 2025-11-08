# 🎓 FluentAI Pro - Advanced Language Learning Chrome Extension

**Learn languages naturally while watching YouTube videos with AI-powered real-time translation, interactive exercises, and intelligent flashcards.**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat&logo=google-chrome&logoColor=white)](https://chrome.google.com)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)](https://developer.chrome.com/docs/extensions/mv3/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## ✨ Features

### 🎯 **Real-Time Learning**
- **Auto-pause on subtitles**: Video pauses when target language appears
- **Instant translation exercises**: Translate what you just heard
- **Smart feedback**: AI-powered validation with similarity scoring
- **Context-aware learning**: Learn words in real sentences from videos

### 🃏 **Smart Flashcard System**
- Auto-generate flashcards from video subtitles, so you're learning vocabulary relevant to you
- Spaced repetition learning
- Import/export flashcard decks
- Practice notifications
- Track mastery levels

### 📊 **Progress Tracking**
- Learning statistics dashboard
- Accuracy rate monitoring
- Streak tracking
- Words learned counter
- Weekly progress charts

### 🤖 **Dual AI Integration**
- **Chrome Built-in AI**: On-device translation (fast, private, free)
- **Google Gemini API**: Advanced content generation and validation
- Automatic fallback between APIs
- Zero latency for Chrome AI features

### 🌍 **Multi-Language Support**
12+ languages including:
- Spanish, French, German, Italian, Portuguese
- Japanese, Korean, Chinese
- Russian, Arabic, Hindi, English

---

## 🚀 Quick Start

### Prerequisites
- Google Chrome (Dev/Canary Channel recommended for Chrome AI)
- A free [Google Gemini API key](https://aistudio.google.com/app/apikey) (optional but recommended)

### Installation

#### Option 1: Load Unpacked (Development)
1. Download or clone this repository
   ```bash
   git clone https://github.com/caspianlack/fluentai.git
   cd fluent-ai
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable **Developer mode** (toggle in top-right corner)

4. Click **"Load unpacked"**

5. Select the `fluentai-pro` folder

6. The extension icon should appear in your Chrome toolbar!

#### Option 2: Chrome Web Store (Coming Soon)
Extension will be available on the Chrome Web Store after review.

---

## ⚙️ Setup & Configuration

### 1. Initial Setup
1. Click the FluentAI Pro icon in your toolbar
2. Go to **Settings** tab
3. Select your **native language** (what you speak)
4. Select your **target language** (what you want to learn)
5. Click **Save Settings**

### 2. Enable Chrome AI APIs (Optional but Recommended)

For the best experience with on-device AI:

1. **Install Chrome Dev/Canary**
   - [Chrome Dev Channel](https://www.google.com/chrome/dev/)
   - [Chrome Canary](https://www.google.com/chrome/canary/)

2. **Enable AI Flags** at `chrome://flags`
   - Search for "Translation API" → Enable
   - Search for "Writer API" → Enable
   - Search for "Language Detector" → Enable

3. **Restart Chrome**

4. **Verify** in FluentAI popup → APIs tab (should show green checkmarks ✅)

### 3. Add Gemini API Key (Optional)

1. Get a **free** API key: https://aistudio.google.com/app/apikey
   - ✅ 15 requests/minute
   - ✅ 1,500 requests/day  
   - ✅ No credit card required

2. In extension popup → **APIs** tab
3. Paste your API key
4. Click **Test API Connection**

---

## 📖 How to Use

### Basic Workflow

1. **Open YouTube**
   - Navigate to any video with subtitles
   - Make sure subtitles are enabled

2. **Start Learning**
   - FluentAI panel appears on the right side
   - Video auto-pauses when target language is detected
   - Translate the subtitle shown
   - Get instant feedback

3. **Build Your Vocabulary**
   - Click the **Vocabulary** tab to see new words
   - Add words to flashcards with one click
   - Review in the **Flashcards** tab

### Practice Sessions

**Flashcard Practice:**
1. Go to extension popup → **Flashcards** tab
2. Click **Practice Now**
3. Complete the quiz overlay
4. Track your progress in **Stats** tab

**Quiz Notifications:**
- Enable in Settings → "Practice notifications"
- Set frequency (default: 30 minutes)
- Get random flashcard tests throughout the day

### Customization

**Pause Delay:**
- Settings → "Pause delay after subtitle"
- Choose 0s (immediate) to 1.5s
- Adjust based on your preference (recommended 0 - 0.5)

**Difficulty Level:**
- Beginner: More hints, simpler vocabulary
- Intermediate: Standard exercises
- Advanced: Challenging content, less assistance

---

## 🏗️ Architecture

### Tech Stack
- **Manifest V3** - Modern Chrome extension architecture
- **Chrome inbuilt AI APIs** - On-device translation, language detection
- **Google Gemini API** - Advanced AI for content generation
- **Chrome Storage API** - Synced settings and local flashcards
- **Service Workers** - Background processing and alarms

### File Structure
```
fluent-ai/
├── manifest.json           # Extension configuration
├── background.js           # Service worker (AI bridge, notifications)
├── content.js              # YouTube page integration
├── injected.js             # Page context for Chrome AI access
├── popup.html              # Extension popup interface
├── popup.js                # Popup functionality
├── popup.css               # Popup styling
├── styles.css              # Content script styling
├── icons/                  # Extension icons
└── README.md               # You are here!
```

### Chrome AI Bridge Implementation

The extension uses a **bridge architecture** to access Chrome's built-in AI APIs:

```
Content Script → Background Script → Page Context → Chrome AI API
                        ↓                               ↓
                   Response ← Message Chain ← Result
```

**Why?** Chrome AI APIs are only available in the page's main world context, not in isolated content scripts. The bridge safely injects code into the page to access these APIs.

---

## 🔧 Chrome AI APIs

### Available APIs (Chrome 138+)

| API | Feature | Status |
|-----|---------|--------|
| **Translator** | Translate text between 12+ languages | On-device, instant |
| **Language Detector** | Detect language of text | On-device, instant |
| **Writer** | Generate language learning content | On-device |

### API Detection
The extension automatically detects which APIs are available:
- ✅ Green checkmark = Available
- ❌ Red X = Not available (enable flags)
- ⏳ Loading = Checking...

### Fallback Strategy
If Chrome AI unavailable → Gemini API is used automatically

---

## 📊 Features in Detail

### Translation Exercise Flow
1. Video plays normally
2. Target language subtitle appears
3. Video auto-pauses (after configured delay)
4. Translation exercise shows in side panel
5. User types translation
6. AI validates answer (similarity scoring + Gemini)
7. Feedback provided with correct answer
8. Word added to vocabulary list
9. User clicks "Next" to continue

### Flashcard System
- **SRS Algorithm**: Spaced repetition for optimal retention
- **Easy Management**: Add, edit, delete cards
- **Bulk Operations**: Import/export JSON format
- **Smart Notifications**: Random cards at set intervals

### Statistics Tracking
- Total correct/incorrect answers
- Current learning streak (consecutive days)
- Words learned count
- Overall accuracy percentage
- Weekly progress visualization

---

## 🎮 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Submit answer |
| `Esc` | Skip exercise |
| `Space` | Play/pause video |
| `Ctrl+Shift+F` | Toggle FluentAI panel |

---

## 🐛 Troubleshooting

### Videos Don't Auto-Pause
- ✅ Check that subtitles are enabled on YouTube
- ✅ Ensure "Auto-pause" is enabled in Settings
- ✅ Refresh the YouTube page
- ✅ Check browser console for errors (F12)

### Chrome AI Not Available
- ✅ Use Chrome Dev or Canary (v138+)
- ✅ Enable all AI flags at `chrome://flags`
- ✅ Restart Chrome completely
- ✅ Check APIs tab in extension popup

### Gemini API Errors
- ✅ Verify API key is correct
- ✅ Check you haven't exceeded rate limits (15/min, 1500/day)
- ✅ Ensure internet connection is active
- ✅ Test connection in APIs tab

### Extension Not Loading
- ✅ Check Chrome version (minimum: Chrome 115)
- ✅ Verify all files are present in extension folder
- ✅ Look for errors in `chrome://extensions/`
- ✅ Try removing and re-adding the extension

---

## 🔒 Privacy & Security

- **Local-First**: Chrome AI runs entirely on your device
- **No Data Collection**: We don't collect or store your learning data
- **Synced Settings**: Only settings sync via Chrome (encrypted)
- **API Security**: Gemini API key stored locally, never transmitted to our servers
- **Open Source**: Full code transparency

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

1. **Report Bugs**: Open an issue with reproduction steps
2. **Suggest Features**: Share your ideas in discussions
3. **Submit PRs**: Fork, create a branch, make changes, submit PR
4. **Improve Docs**: Help us make documentation better
5. **Share Feedback**: Tell us what works and what doesn't

### Development Setup
```bash
# Clone repository
git clone https://github.com/caspianlack/fluent-ai.git
cd fluent-ai

# Load in Chrome Dev/Canary
# 1. Go to chrome://extensions/
# 2. Enable Developer mode
# 3. Click "Load unpacked"
# 4. Select this folder

# Make changes and test
# Extension reloads automatically for content scripts
# Click reload button in chrome://extensions/ for background/popup changes
```

---

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🙏 Acknowledgments

- **Google Gemini**: For providing free AI API access
- **Chrome Team**: For built-in AI APIs
- **YouTube**: For the platform that makes this possible
- **Open Source Community**: For inspiration and tools

- **Disclosure**: This project was developed with assistance from AI tools to improve productivity and code quality.

---

## 📧 Support

- **Issues**: [GitHub Issues](https://github.com/caspianlack/fluentai/issues)
- **Discussions**: [GitHub Discussions](https://github.com/caspianlack/fluentai/discussions)

---

## ⭐ Show Your Support

If FluentAI Pro helps you learn languages, please:
- ⭐ Star this repository
- 🔄 Share with language learners
- 📝 Write a review (when available on Chrome Web Store)
- 🐛 Report bugs and suggest features

---

**Happy Learning! 🎉**

*Master any language, one YouTube video at a time.*