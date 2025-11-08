// This script runs in the page context and has access to Chrome AI APIs
(function() {
  'use strict';
  
  // Check API availability
  const apis = {
    translator: typeof self.Translator === 'function',
    translatorNew: typeof self.translation?.createTranslator === 'function',
    languageDetector: typeof self.LanguageDetector === 'function',
    languageDetectorNew: typeof self.translation?.createDetector === 'function',
    writer: typeof self.Writer === 'function',
    writerNew: typeof self.ai?.writer === 'object'
  };
  
  // Store API instances
  let translatorInstance = null;
  let detectorInstance = null;
  let writerInstance = null;
  
  // Listen for messages from content script
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (!event.data.type || event.data.type !== 'FLUENTAI_REQUEST') return;
    
    const { action, data, requestId } = event.data;
    
    try {
      let result;
      
      switch (action) {
        case 'checkAPIs':
          result = { success: true, apis };
          break;
          
        case 'checkTranslatorReady':
          // Check if translator is ready for specific language pair
          try {
            if (apis.translator) {
              const canTranslate = await self.Translator.canTranslate({
                sourceLanguage: data.sourceLanguage,
                targetLanguage: data.targetLanguage
              });
              result = {
                success: true,
                ready: canTranslate === 'readily',
                status: canTranslate,
                message: canTranslate === 'readily' ? 'Ready' : 
                         canTranslate === 'after-download' ? 'Needs download' : 
                         'Not available'
              };
            } else if (apis.translatorNew) {
              const canTranslate = await self.translation.canTranslate({
                sourceLanguage: data.sourceLanguage,
                targetLanguage: data.targetLanguage
              });
              result = {
                success: true,
                ready: canTranslate === 'readily',
                status: canTranslate,
                message: canTranslate === 'readily' ? 'Ready' : 
                         canTranslate === 'after-download' ? 'Needs download' : 
                         'Not available'
              };
            } else {
              result = { success: false, error: 'Translator API not available' };
            }
          } catch (error) {
            result = { success: false, error: error.message };
          }
          break;
          
        case 'translate':
          if (!translatorInstance) {
            if (apis.translatorNew) {
              translatorInstance = await self.translation.createTranslator({
                sourceLanguage: data.sourceLanguage || 'en',
                targetLanguage: data.targetLanguage || 'es'
              });
            } else if (apis.translator) {
              translatorInstance = await self.Translator.create({
                sourceLanguage: data.sourceLanguage || 'en',
                targetLanguage: data.targetLanguage || 'es'
              });
            }
          }
          
          if (translatorInstance) {
            const translation = await translatorInstance.translate(data.text);
            result = { success: true, translation };
          } else {
            result = { success: false, error: 'Translator not available' };
          }
          break;
          
        case 'detectLanguage':
          if (!detectorInstance) {
            if (apis.languageDetectorNew) {
              detectorInstance = await self.translation.createDetector();
            } else if (apis.languageDetector) {
              detectorInstance = await self.LanguageDetector.create();
            }
          }
          
          if (detectorInstance) {
            const results = await detectorInstance.detect(data.text);
            result = { success: true, results };
          } else {
            result = { success: false, error: 'Language detector not available' };
          }
          break;
          
        case 'generateContent':
          if (!writerInstance) {
            if (apis.writerNew) {
              writerInstance = await self.ai.writer.create();
            } else if (apis.writer) {
              writerInstance = await self.Writer.create();
            }
          }
          
          if (writerInstance) {
            const content = await writerInstance.write(data.prompt, {
              context: data.context || ''
            });
            result = { success: true, content };
          } else {
            result = { success: false, error: 'Writer not available' };
          }
          break;
          
        default:
          result = { success: false, error: 'Unknown action' };
      }
      
      // Send response back to content script
      window.postMessage({
        type: 'FLUENTAI_RESPONSE',
        requestId,
        result
      }, '*');
      
    } catch (error) {
      window.postMessage({
        type: 'FLUENTAI_RESPONSE',
        requestId,
        result: { success: false, error: error.message }
      }, '*');
    }
  });
  
  // Signal that the bridge is ready
  window.postMessage({ type: 'FLUENTAI_BRIDGE_READY' }, '*');
})();