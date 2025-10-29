class FlashcardDB {
    constructor() {
        this.dbName = 'FluentAIFlashcards';
        this.version = 6;
        this.db = null;
        this.ready = this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onerror = () => {
                console.error('IndexedDB error:', request.error);
                reject(request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                console.log('IndexedDB initialized successfully');
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                console.log('Upgrading IndexedDB database...');
                const db = event.target.result;
                
                // Delete old object stores if they exist
                if (db.objectStoreNames.contains('flashcards')) {
                    db.deleteObjectStore('flashcards');
                }
                
                // Create flashcards store with multiple indexes
                const store = db.createObjectStore('flashcards', { 
                    keyPath: 'id',
                    autoIncrement: true 
                });
                
                // Create indexes for fast searching
                store.createIndex('word', 'word', { unique: false });
                store.createIndex('language', 'language', { unique: false });
                store.createIndex('word_language', ['word', 'language'], { unique: false });
                store.createIndex('addedDate', 'addedDate', { unique: false });
                store.createIndex('nextReview', 'nextReview', { unique: false });
                
                console.log('Flashcards store created with indexes');
            };
        });
    }

    // Wait for DB to be ready
    async waitForReady() {
        await this.ready;
        return this;
    }

    // Add or update a flashcard
    async addFlashcard(flashcard) {
        await this.waitForReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['flashcards'], 'readwrite');
            const store = transaction.objectStore('flashcards');
            
            // Ensure the flashcard has required fields
            const completeFlashcard = {
                addedDate: Date.now(),
                reviewCount: 0,
                correctCount: 0,
                lastReviewed: null,
                nextReview: Date.now(),
                difficulty: 0,
                sets: [],
                ...flashcard,
                id: flashcard.id || Date.now() + Math.random() // Ensure unique ID
            };
            
            const request = store.put(completeFlashcard);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                console.log('Flashcard saved:', completeFlashcard.word);
                resolve(completeFlashcard.id);
            };
        });
    }

    // Add multiple flashcards in batch
    async addFlashcards(flashcards) {
        await this.waitForReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['flashcards'], 'readwrite');
            const store = transaction.objectStore('flashcards');
            let completed = 0;
            const errors = [];
            
            flashcards.forEach(flashcard => {
                const completeFlashcard = {
                    addedDate: Date.now(),
                    reviewCount: 0,
                    correctCount: 0,
                    lastReviewed: null,
                    nextReview: Date.now(),
                    difficulty: 0,
                    sets: [],
                    ...flashcard,
                    id: flashcard.id || Date.now() + Math.random()
                };
                
                const request = store.put(completeFlashcard);
                
                request.onerror = () => {
                    errors.push({ word: flashcard.word, error: request.error });
                    completed++;
                    if (completed === flashcards.length) {
                        if (errors.length > 0) {
                            reject(new Error(`Some flashcards failed: ${JSON.stringify(errors)}`));
                        } else {
                            resolve(flashcards.length);
                        }
                    }
                };
                
                request.onsuccess = () => {
                    completed++;
                    if (completed === flashcards.length) {
                        if (errors.length > 0) {
                            reject(new Error(`Some flashcards failed: ${JSON.stringify(errors)}`));
                        } else {
                            resolve(flashcards.length);
                        }
                    }
                };
            });
        });
    }

    // Get flashcard by ID
    async getFlashcard(id) {
        await this.waitForReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['flashcards'], 'readonly');
            const store = transaction.objectStore('flashcards');
            const request = store.get(id);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    // Search flashcards by exact word match
    async searchFlashcardsByWord(word, language = null) {
        await this.waitForReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['flashcards'], 'readonly');
            const store = transaction.objectStore('flashcards');
            
            let request;
            if (language) {
                const index = store.index('word_language');
                request = index.getAll([word.toLowerCase(), language]);
            } else {
                const index = store.index('word');
                request = index.getAll(word.toLowerCase());
            }
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    // Search flashcards by partial word match (for autocomplete)
    async searchFlashcardsPartial(partialWord, language = null, limit = 20) {
        await this.waitForReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['flashcards'], 'readonly');
            const store = transaction.objectStore('flashcards');
            const index = store.index('word');
            const results = [];
            const lowerPartial = partialWord.toLowerCase();
            
            const request = index.openCursor();
            
            request.onerror = () => reject(request.error);
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && results.length < limit) {
                    const flashcard = cursor.value;
                    if (flashcard.word.toLowerCase().includes(lowerPartial)) {
                        if (!language || flashcard.language === language) {
                            results.push(flashcard);
                        }
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
        });
    }

    // Get all flashcards for a specific language
    async getFlashcardsByLanguage(language) {
        await this.waitForReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['flashcards'], 'readonly');
            const store = transaction.objectStore('flashcards');
            const index = store.index('language');
            const request = index.getAll(language);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    // Get all flashcards (use with caution for large datasets)
    async getAllFlashcards() {
        await this.waitForReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['flashcards'], 'readonly');
            const store = transaction.objectStore('flashcards');
            const request = store.getAll();
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    // Get due flashcards for review (spaced repetition)
    async getDueFlashcards(language = null) {
        await this.waitForReady();
        const now = Date.now();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['flashcards'], 'readonly');
            const store = transaction.objectStore('flashcards');
            const index = store.index('nextReview');
            const request = index.getAll(IDBKeyRange.upperBound(now));
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                let flashcards = request.result;
                if (language) {
                    flashcards = flashcards.filter(card => card.language === language);
                }
                resolve(flashcards);
            };
        });
    }

    // Delete flashcard by ID
    async deleteFlashcard(id) {
        await this.waitForReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['flashcards'], 'readwrite');
            const store = transaction.objectStore('flashcards');
            const request = store.delete(id);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }

    // Delete multiple flashcards
    async deleteFlashcards(ids) {
        await this.waitForReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['flashcards'], 'readwrite');
            const store = transaction.objectStore('flashcards');
            let completed = 0;
            const errors = [];
            
            ids.forEach(id => {
                const request = store.delete(id);
                
                request.onerror = () => {
                    errors.push({ id, error: request.error });
                    completed++;
                    if (completed === ids.length) {
                        if (errors.length > 0) {
                            reject(new Error(`Some deletions failed: ${JSON.stringify(errors)}`));
                        } else {
                            resolve(ids.length);
                        }
                    }
                };
                
                request.onsuccess = () => {
                    completed++;
                    if (completed === ids.length) {
                        if (errors.length > 0) {
                            reject(new Error(`Some deletions failed: ${JSON.stringify(errors)}`));
                        } else {
                            resolve(ids.length);
                        }
                    }
                };
            });
        });
    }

    // Get statistics
    async getStats(language = null) {
        await this.waitForReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['flashcards'], 'readonly');
            const store = transaction.objectStore('flashcards');
            
            let request;
            if (language) {
                const index = store.index('language');
                request = index.count(language);
            } else {
                request = store.count();
            }
            
            request.onerror = () => reject(request.error);
            request.onsuccess = async () => {
                const total = request.result;
                const due = (await this.getDueFlashcards(language)).length;
                
                resolve({
                    total,
                    due,
                    language: language || 'all'
                });
            };
        });
    }

    // Export flashcards to JSON
    async exportFlashcards(language = null) {
        const flashcards = language ? 
            await this.getFlashcardsByLanguage(language) : 
            await this.getAllFlashcards();
        
        return JSON.stringify(flashcards, null, 2);
    }

    // Import flashcards from JSON
    async importFlashcards(jsonData, merge = true) {
        const importedCards = JSON.parse(jsonData);
        
        if (!Array.isArray(importedCards)) {
            throw new Error('Invalid flashcard data format');
        }
        
        if (!merge) {
            // Clear existing flashcards first
            const allFlashcards = await this.getAllFlashcards();
            const idsToDelete = allFlashcards.map(card => card.id);
            if (idsToDelete.length > 0) {
                await this.deleteFlashcards(idsToDelete);
            }
        }
        
        // Add imported cards
        const processedCards = importedCards.map(card => ({
            ...card,
            addedDate: card.addedDate || Date.now(),
            id: card.id || Date.now() + Math.random()
        }));
        
        await this.addFlashcards(processedCards);
        return processedCards.length;
    }

    // Clear all flashcards
    async clearAllFlashcards() {
        await this.waitForReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['flashcards'], 'readwrite');
            const store = transaction.objectStore('flashcards');
            const request = store.clear();
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }

    // Check if word exists (for duplicate prevention)
    async wordExists(word, language) {
        const existing = await this.searchFlashcardsByWord(word, language);
        return existing.length > 0;
    }
}

// Create global instance
const flashcardDB = new FlashcardDB();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = flashcardDB;
}
