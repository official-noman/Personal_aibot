/* ============================================================
   Persona — Semantic RAG Pipeline (Infinite Memory)
   Zero-cost, 100% Private, Local Vector Database

   This uses Transformers.js (WebAssembly) to generate embeddings
   inside the browser and saves them in IndexedDB.
   When the user asks something, we semantic-search the DB and
   inject the context into the Gemini Prompt.
   ============================================================ */
'use strict';

const VECTOR_DIM = 384; // all-MiniLM-L6-v2 output dimension
const SIMILARITY_THRESHOLD = 0.5;

let RAG = {
  db: null,
  extractor: null,
  ready: false,
  loading: false,

  /* ---------- IndexedDB Setup ---------- */
  initDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('PersonaMemoryDB', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('memories')) {
          // Store: { id, text, vector (Array), timestamp }
          db.createObjectStore('memories', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        RAG.db = e.target.result;
        resolve();
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  /* ---------- Transformers.js Pipeline ---------- */
  async loadModel() {
    if (RAG.ready || RAG.loading) return;
    RAG.loading = true;
    try {
      if (typeof window.pipeline === 'undefined') {
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm');
        // allow local caching
        env.allowLocalModels = false;
        window.pipeline = pipeline;
      }
      
      console.log('[RAG] Loading transformer model (all-MiniLM-L6-v2)...');
      RAG.extractor = await window.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      RAG.ready = true;
      console.log('[RAG] Brain engine is ready!');
      toast('🧠 AI Memory Engine Active');
    } catch (e) {
      console.error('[RAG] Model load failed', e);
    }
    RAG.loading = false;
  },

  /* ---------- Generate Embeddings ---------- */
  async getEmbedding(text) {
    if (!RAG.ready) await RAG.loadModel();
    if (!RAG.extractor) return null;
    
    // pooling: 'mean', normalize: true -> good for cosine similarity
    const out = await RAG.extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  },

  /* ---------- Cosine Similarity ---------- */
  cosineSimilarity(vecA, vecB) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  },

  /* ---------- DB Operations ---------- */
  async saveMemory(fact) {
    if (!RAG.db) await RAG.initDB();
    const vec = await RAG.getEmbedding(fact);
    if (!vec) return false;

    const memory = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      text: fact,
      vector: vec,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx = RAG.db.transaction('memories', 'readwrite');
      const store = tx.objectStore('memories');
      const req = store.add(memory);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(false);
    });
  },

  async getAllMemories() {
    if (!RAG.db) await RAG.initDB();
    return new Promise((resolve, reject) => {
      const tx = RAG.db.transaction('memories', 'readonly');
      const store = tx.objectStore('memories');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject([]);
    });
  },

  /* ---------- Semantic Search ---------- */
  async search(query, limit = 3) {
    const queryVec = await RAG.getEmbedding(query);
    if (!queryVec) return [];

    const memories = await RAG.getAllMemories();
    if (!memories.length) return [];

    // Calculate similarity for each
    const scored = memories.map(m => {
      return {
        ...m,
        score: RAG.cosineSimilarity(queryVec, m.vector)
      };
    });

    // Sort by descending score and filter
    scored.sort((a, b) => b.score - a.score);
    return scored.filter(m => m.score > SIMILARITY_THRESHOLD).slice(0, limit);
  }
};

/* Start DB on load */
RAG.initDB().catch(e => console.warn('[RAG] DB init fail', e));

/* Action wrapper for Chat bot */
const MEMORY_ACTIONS = {
  async save_memory({ fact }) {
    if (!fact) return { text: "Ki kotha mone rakhbo seta to bolla na!" };
    
    if (!RAG.ready) {
      // Run background save and return immediately to not block chat
      setTimeout(async () => {
        try {
          const ok = await RAG.saveMemory(fact);
          if (ok && typeof pushMsg === 'function') pushMsg('b', `🧠 Brain update done! Mone rakhlam: "${fact}"`);
        } catch(e) {
          if (typeof pushMsg === 'function') pushMsg('b', '⚠️ Memory save korte somossa hoyeche (Net check koro).');
        }
      }, 100);
      return { text: `⏳ AI Brain first time setup hocche (25MB model download hobe)... Save hole janabo!` };
    }

    try {
      const ok = await RAG.saveMemory(fact);
      if (ok) return { text: `🧠 Mone rakhlam: "${fact}"` };
      return { text: `Sorry, memory save korte problem hoyeche.` };
    } catch(e) {
      return { text: `Model error: ${e.message}` };
    }
  }
};
Object.assign(ACTIONS, MEMORY_ACTIONS);
