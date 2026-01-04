function $(id) {
  return document.getElementById(id);
}

const paragraphInput = $("paragraph");
const splitBtn = $("splitBtn");
const startBtn = $("startBtn");
const sentenceList = $("sentenceList");
const splitSmallBtn = $("splitSmallBtn");
const newParagraphBtn = $("newParagraphBtn");
const restoreParagraphBtn = $("restoreParagraphBtn");

const chunkSizeInput = $("chunkSize");
const chunkSizeLabel = $("chunkSizeLabel");
const requestMicBtn = $("requestMicBtn");

let sentences = [];
let currentIndex = 0;

// Helpful on-screen debug so we don’t have to guess
function setTopNotice(msg) {
  let n = $("notice");
  if (!n) {
    n = document.createElement("div");
    n.id = "notice";
    n.style.padding = "10px";
    n.style.margin = "10px 0";
    n.style.borderRadius = "10px";
    n.style.background = "#f3f3f3";
    n.style.fontSize = "14px";
    document.body.prepend(n);
  }
  n.textContent = msg;
}

// Global error handlers to surface runtime errors in the UI (helps debugging on mobile)
window.addEventListener('error', (ev) => {
  try { setTopNotice('Error: ' + (ev && ev.message ? ev.message : String(ev)) ); } catch (e) {}
  console.error('Window error', ev.error || ev.message || ev);
});
window.addEventListener('unhandledrejection', (ev) => {
  try { setTopNotice('Unhandled promise rejection: ' + (ev && ev.reason ? (ev.reason.message || String(ev.reason)) : String(ev)) ); } catch(e) {}
  console.error('Unhandled rejection', ev.reason || ev);
});

function getChunkSize() {
  // If the slider doesn't exist, default to 14
  const v = Number(chunkSizeInput ? chunkSizeInput.value : 14);
  return Number.isFinite(v) ? v : 14;
}

function canPlayMime(type) {
  try {
    const a = document.createElement('audio');
    const r = a.canPlayType(type);
    return r === 'probably' || r === 'maybe';
  } catch (e) {
    return false;
  }
}

function updateChunkLabel() {
  if (chunkSizeLabel) chunkSizeLabel.textContent = String(getChunkSize());
}

if (chunkSizeInput) {
  chunkSizeInput.addEventListener("input", () => { updateChunkLabel(); saveAppState(); });
  updateChunkLabel();
}

const memorizeInput = $("memorizeTime");
const memorizeLabel = $("memorizeTimeLabel");
function getMemorizeTime() {
  const v = Number(memorizeInput ? memorizeInput.value : 10);
  return Number.isFinite(v) ? v : 10;
}
function updateMemorizeLabel() {
  if (memorizeLabel) memorizeLabel.textContent = String(getMemorizeTime());
}
if (memorizeInput) {
  memorizeInput.addEventListener('input', () => { updateMemorizeLabel(); saveAppState(); });
  updateMemorizeLabel();
}

if (requestMicBtn) {
  requestMicBtn.onclick = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setTopNotice('Microphone access granted. You can now record in training.');
    } catch (err) {
      setTopNotice('Microphone access denied or not available on this device.');
      console.error('Mic request failed', err);
    }
  };
}
// --- Local state persistence (localStorage) ---
const LS_PREFIX = 'study_';
// --- Recall mode persistence ---
function getRecallMode() {
  try {
    return localStorage.getItem(LS_PREFIX + 'recall_mode') || 'normal';
  } catch (e) {
    return 'normal';
  }
}

function setRecallMode(mode) {
  const m = (mode === 'pairs') ? 'pairs' : 'normal';
  try {
    localStorage.setItem(LS_PREFIX + 'recall_mode', m);
  } catch (e) {}
}

function saveAppState() {
  try {
    const data = {
      paragraph: paragraphInput ? paragraphInput.value : '',
      chunkSize: chunkSizeInput ? chunkSizeInput.value : null,
      memorizeTime: memorizeInput ? memorizeInput.value : null,
      sentences: sentences || [],
      recallMode: getRecallMode(),
    };
    localStorage.setItem(LS_PREFIX + 'state', JSON.stringify(data));
  } catch (e) { console.warn('Failed to save state', e); }
}

function loadAppState() {
  try {
    const raw = localStorage.getItem(LS_PREFIX + 'state');
    const data = raw ? JSON.parse(raw) : null;
    // If a full session state exists, offer to restore that exact session. Otherwise, if there are saved paragraphs,
    // offer to restore the most recently saved paragraph (so the Restore button stays available across multiple saves).
    const paras = getSavedParagraphs();

    if ((data && data.paragraph) || paras.length) {
      if (!restoreParagraphBtn) return;
      restoreParagraphBtn.style.display = 'inline-block';
      restoreParagraphBtn.onclick = () => {
        try {
          if (data && data.paragraph) {
            if (paragraphInput) paragraphInput.value = data.paragraph || '';
            if (data.chunkSize && chunkSizeInput) { chunkSizeInput.value = data.chunkSize; updateChunkLabel(); }
            if (data.memorizeTime && memorizeInput) { memorizeInput.value = data.memorizeTime; updateMemorizeLabel(); }
            if (Array.isArray(data.sentences) && data.sentences.length) {
              sentences = data.sentences;
              renderSentences();
              if (startBtn) startBtn.disabled = sentences.length === 0;
            }
            setTopNotice('Previous paragraph restored.');
            // Hide the restore button after use only if there are no other saved paragraphs
            if (!paras.length) restoreParagraphBtn.style.display = 'none';
            return;
          }

          // Otherwise restore the last saved paragraph (most recent)
          const lastId = localStorage.getItem(LS_PREFIX + 'last_par');
          let p = null;
          if (lastId) p = paras.find(x => x.id === lastId);
          if (!p && paras.length) p = paras[paras.length - 1];
          if (p) {
            if (paragraphInput) paragraphInput.value = p.text || '';
            sentences = Array.isArray(p.sentences) ? p.sentences : [];
            renderSentences();
            if (startBtn) startBtn.disabled = sentences.length === 0;
            setTopNotice('Restored ' + (p.name || 'paragraph'));
            // Don't hide the button — let users restore other paragraphs if they wish
          }
        } catch (e) { console.warn('Failed to restore state', e); }
      };
    }
  } catch (e) { console.warn('Failed to load state', e); }
  // Also refresh saved paragraph bar after loading state so the UI remains visible
  try { renderSavedParagraphsBar(); } catch(e) {}
}

// Saved-paragraph helpers (global) — keeps previous paragraphs so you can restore them later
function getSavedParagraphs() {
  try {
    const raw = localStorage.getItem(LS_PREFIX + 'paragraphs');
    return raw ? JSON.parse(raw) : [];
  } catch (e) { console.warn('getSavedParagraphs failed', e); return []; }
}
function saveParagraphToStore(text, name, sentencesArr, paragraphId) {
  try {
    const arr = getSavedParagraphs();
    const ts = Date.now();
    const pid = paragraphId || (text ? simpleHash(text.trim()) : Date.now().toString(36));
    // If paragraph already exists (by paragraphId), update it
    const existing = arr.find(p => p.paragraphId === pid);
    if (existing) {
      existing.text = text || existing.text;
      existing.sentences = Array.isArray(sentencesArr) ? sentencesArr : existing.sentences;
      existing.ts = ts;
      if (name && name.trim()) existing.name = name.trim();
      localStorage.setItem(LS_PREFIX + 'paragraphs', JSON.stringify(arr));
      try { localStorage.setItem(LS_PREFIX + 'last_par', existing.id); } catch(e){}
      try { renderSavedParagraphsBar(); } catch(e){}
      return existing;
    }

    const id = Date.now().toString(36);
    const item = { id, paragraphId: pid, name: name || `Paragraph ${arr.length + 1}`, text: text || '', sentences: Array.isArray(sentencesArr) ? sentencesArr : [], ts };
    arr.push(item);
    localStorage.setItem(LS_PREFIX + 'paragraphs', JSON.stringify(arr));
    // Keep a quick pointer to the most recently saved paragraph so the Restore button can use it
    try { localStorage.setItem(LS_PREFIX + 'last_par', id); } catch(e){}
    // Refresh UI elements
    try { renderSavedParagraphsBar(); } catch(e){}
    return item;
  } catch (e) { console.warn('saveParagraphToStore failed', e); }
}
function deleteSavedParagraph(id) {
  try {
    const arr = getSavedParagraphs().filter(p => p.id !== id);
    localStorage.setItem(LS_PREFIX + 'paragraphs', JSON.stringify(arr));
    try { renderSavedParagraphsBar(); } catch(e){}
  } catch (e) { console.warn('deleteSavedParagraph failed', e); }
}
function renameSavedParagraph(id, newName) {
  try {
    const arr = getSavedParagraphs();
    const it = arr.find(p => p.id === id);
    if (it) { it.name = newName; localStorage.setItem(LS_PREFIX + 'paragraphs', JSON.stringify(arr)); }
    try { renderSavedParagraphsBar(); } catch(e){}
  } catch (e) { console.warn('renameSavedParagraph failed', e); }
}

// Render the saved paragraphs bar on the home page
function renderSavedParagraphsBar() {
  try {
    const el = $("savedParagraphsBar"); if (!el) return;
    const paras = getSavedParagraphs();
    if (!paras.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'flex';
    el.innerHTML = '';

    paras.forEach(p => {
      const card = document.createElement('div');
      card.className = 'saved-paragraph';
      card.innerHTML = `
        <div class="name">${p.name || 'Paragraph'}</div>
        <div class="meta">${formatTS(p.ts)}</div>
        <div style="font-size:13px; color:#444; margin-bottom:8px;">${(p.text||'').slice(0,120)}${(p.text && p.text.length>120)?'…':''}</div>
        <div class="actions">
          <button data-id="${p.id}" class="restore-par-small">⤺ Restore</button>
          <button data-id="${p.id}" class="rename-par-small">✎ Rename</button>
          <button data-id="${p.id}" class="delete-par-small">🗑 Delete</button>
        </div>
      `;
      el.appendChild(card);

      const rb = card.querySelector('.restore-par-small');
      rb.onclick = () => {
        try {
          if (paragraphInput) paragraphInput.value = p.text || '';
          sentences = Array.isArray(p.sentences) ? p.sentences : [];
          renderSentences();
          if (startBtn) startBtn.disabled = sentences.length === 0;
          // Persist this choice so returning to home keeps it
          try { saveAppState(); } catch(e) {}
          setTopNotice('Restored ' + (p.name || 'paragraph'));
        } catch(e) { console.warn('restore failed', e); }
      };

      const renameBtn = card.querySelector('.rename-par-small');
      renameBtn.onclick = () => {
        try {
          const nn = prompt('Rename paragraph', p.name || 'Paragraph');
          if (nn && nn.trim()) { renameSavedParagraph(p.id, nn.trim()); renderSavedParagraphsBar(); if (savedPanel && savedPanel.classList.contains('open')) refreshSavedPanel(); }
        } catch(e){}
      };

      const delBtn = card.querySelector('.delete-par-small');
      delBtn.onclick = () => {
        try {
          if (!confirm('Delete saved paragraph?')) return;
          deleteSavedParagraph(p.id);
          renderSavedParagraphsBar();
          if (savedPanel && savedPanel.classList.contains('open')) refreshSavedPanel();
          setTopNotice('Deleted paragraph.');
        } catch(e){}
      };
    });
  } catch (e) { console.warn('renderSavedParagraphsBar failed', e); }
}

// Load persisted state immediately (but do not auto-restore paragraph text)
loadAppState();
// Ensure the saved-paragraphs bar is rendered on initial load
try { renderSavedParagraphsBar(); } catch(e) {}

// New paragraph handler: clear textarea and reset session state so recordings won't overlap
if (newParagraphBtn) {
  newParagraphBtn.onclick = () => {
    try {
      let willClear = true;
      if ((paragraphInput && paragraphInput.value && paragraphInput.value.trim()) || (Array.isArray(sentences) && sentences.length)) {
        if (!confirm('Clear current paragraph and start a new one? Existing unsaved session will be lost.')) return;
        // Save the current paragraph into the saved paragraphs store before clearing
        try {
          const priorText = paragraphInput && paragraphInput.value ? paragraphInput.value.trim() : '';
          if (priorText) {
            const saved = saveParagraphToStore(priorText, null, Array.isArray(sentences) ? sentences : [], simpleHash(priorText));
            setTopNotice('Saved current paragraph as ' + (saved && saved.name ? saved.name : 'Paragraph') + '.');
          }
        } catch (e) { console.warn('Failed to auto-save previous paragraph', e); }
      }

      paragraphInput.value = '';
      sentences = [];
      renderSentences();
      if (startBtn) startBtn.disabled = true;
      // Remove persisted state so the paragraph won't be auto-offered for restore
      try { localStorage.removeItem(LS_PREFIX + 'state'); } catch(e){}
      if (restoreParagraphBtn) restoreParagraphBtn.style.display = 'none';
      setTopNotice('New paragraph started — ready for input.');
    } catch (e) { console.error('Failed to start new paragraph', e); }
  };
}

// Treat Training as a separate navigable page using the History API
window.addEventListener('popstate', () => {
  // If the hash is not '#training' we should return to the home UI — reload to restore original DOM
  if (location.hash !== '#training') {
    location.href = location.pathname + location.search;
  }
});

// Support direct linking to the training view via #training
if (location.hash === '#training') {
  if (sentences && sentences.length) {
    currentIndex = 0;
    try { showTrainingUI(); } catch (e) { setTopNotice('Failed to load training: ' + (e && e.message)); }
  } else {
    setTopNotice('No chunks found for training — split a paragraph first.');
    history.replaceState(null, '', location.pathname + location.search);
  }
}

// --- IndexedDB helpers for persisting attempts ---
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16);
}

const DB_NAME = 'study_pwa';
const DB_VERSION = 1;
function openDB() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('attempts')) {
        const store = db.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true });
        store.createIndex('paragraphId', 'paragraphId', { unique: false });
        store.createIndex('paragraph_chunk', ['paragraphId', 'chunkIndex'], { unique: false });
      }
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error || rq);
  });
}

async function saveAttemptToDB({ paragraphId, chunkIndex, blob, mimeType, duration, isReference=false }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attempts', 'readwrite');
    const store = tx.objectStore('attempts');
    const item = { paragraphId, chunkIndex, blob, mimeType, duration, ts: Date.now(), isReference };
    const req = store.add(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAttemptsForParagraph(paragraphId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attempts', 'readonly');
    const store = tx.objectStore('attempts');
    const idx = store.index('paragraphId');
    const req = idx.getAll(paragraphId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getAttemptsForChunk(paragraphId, chunkIndex) {
  const all = await getAttemptsForParagraph(paragraphId);
  return all.filter(a => Number(a.chunkIndex) === Number(chunkIndex));
}

// Return the reference attempt for the paragraph/chunk (isReference === true), or null
async function getReferenceAttempt(paragraphId, chunkIndex) {
  const list = await getAttemptsForChunk(paragraphId, chunkIndex);
  for (const a of list) if (a.isReference) return a;
  return null;
}

// Get attempt by id
async function getAttemptById(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attempts', 'readonly');
    const store = tx.objectStore('attempts');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Persist a manual check result for a chunk in localStorage
function saveCheckResult(paragraphId, chunkIndex, pass, attemptId, refId) {
  try {
    const key = LS_PREFIX + 'results_' + paragraphId;
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : {};
    data[chunkIndex] = { ts: Date.now(), pass: !!pass, attemptId: attemptId || null, refId: refId || null };
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) { console.warn('Failed to save check result', e); }
}
// --- Progress helpers (reads the manual check results) ---
function getCheckResults(paragraphId) {
  try {
    const key = LS_PREFIX + 'results_' + paragraphId;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('Failed to read check results', e);
    return {};
  }
}

function getChunkMark(paragraphId, chunkIndex) {
  const data = getCheckResults(paragraphId);
  const r = data && data[chunkIndex];
  if (!r) return null;          // not attempted
  return r.pass ? 'pass' : 'fail';
}

function countProgress(paragraphId, totalChunks) {
  const data = getCheckResults(paragraphId);
  let attempted = 0, correct = 0;
  for (let i = 0; i < totalChunks; i++) {
    const r = data[i];
    if (r) {
      attempted++;
      if (r.pass) correct++;
    }
  }
  return { attempted, correct, total: totalChunks };
}

// Set the given attempt id as the reference for the paragraph/chunk, clearing any previous reference
async function setReferenceAttempt(paragraphId, chunkIndex, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attempts', 'readwrite');
    const store = tx.objectStore('attempts');

    // Get all attempts for this paragraph, then update the ones for this chunk
    const idx = store.index('paragraphId');
    const req = idx.getAll(paragraphId);
    req.onsuccess = () => {
      const all = req.result || [];
      const toUpdate = all.filter(a => Number(a.chunkIndex) === Number(chunkIndex));
      let updates = 0;
      if (!toUpdate.length) return resolve();
      toUpdate.forEach(item => {
        const original = Object.assign({}, item);
        item.isReference = (item.id === id);
        const r = store.put(item);
        r.onsuccess = () => {
          updates++;
          if (updates === toUpdate.length) resolve();
        };
        r.onerror = () => { /* best-effort */ updates++; if (updates === toUpdate.length) resolve(); };
      });
    };
    req.onerror = () => reject(req.error);
  });
}

async function deleteAttemptById(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attempts', 'readwrite');
    const store = tx.objectStore('attempts');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function formatTS(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function splitIntoSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (matches || []).map(s => s.trim()).filter(Boolean);
}

function splitSmaller(chunks, maxWords = 14) {
  // Allow chunks up to maxWords + 2 (no more). Split long segments more evenly and avoid tiny trailing fragments.
  const allowed = maxWords + 2;
  const out = [];
  for (const c of chunks) {
    const parts = c.split(/[,;:—–-]\s+/).map(p => p.trim()).filter(Boolean);
    for (const p of parts) {
      const words = p.split(/\s+/).filter(Boolean);
      if (words.length <= allowed) {
        out.push(p);
      } else {
        // Split into base chunks of size maxWords
        const temp = [];
        for (let i = 0; i < words.length; i += maxWords) {
          temp.push(words.slice(i, i + maxWords));
        }
        // If the last fragment would be very small (<=2 words), merge it into the previous chunk
        if (temp.length >= 2 && temp[temp.length - 1].length <= 2) {
          const last = temp.pop();
          temp[temp.length - 1] = temp[temp.length - 1].concat(last);
        }
        // Finally, push joined chunks ensuring none exceed the allowed size
        for (const t of temp) {
          out.push(t.join(' '));
        }
      }
    }
  }
  return out;
}

function renderSentences() {
  if (!sentenceList) return;
  sentenceList.innerHTML = "";

  const paragraphText = (paragraphInput && paragraphInput.value && paragraphInput.value.trim()) || '';
  const paragraphId = paragraphText ? simpleHash(paragraphText) : null;

  sentences.forEach((s, i) => {
    const li = document.createElement("li");

    // progress dot
    const dot = document.createElement('span');
    dot.className = 'progress-dot';
    if (paragraphId) {
      const mark = getChunkMark(paragraphId, i);
      if (mark === 'pass') dot.classList.add('pass');
      if (mark === 'fail') dot.classList.add('fail');
    }

    const text = document.createElement('span');
    text.textContent = `${i + 1}. ${s}`;

    li.appendChild(dot);
    li.appendChild(text);
    sentenceList.appendChild(li);
  });
}


function showTrainingUI() {
  // Paragraph identifier used to group saved attempts
  const paragraphText = (paragraphInput && paragraphInput.value && paragraphInput.value.trim()) || null;
  const paragraphId = paragraphText ? simpleHash(paragraphText) : null;

  document.body.innerHTML = `
    <h1>Memory Trainer</h1>
    <div id="status"></div>
    <div id="prompt" class="prompt"></div>
    <div id="countdown" class="countdown"></div>

    <div class="row">
      <button id="recBtn">🎤 Record</button>
      <button id="stopBtn" disabled>⏹ Stop</button>
      <button id="playBtn" disabled>▶ Play</button>
      <button id="recordAgainMain" disabled style="display:none">Record again</button>
      <button id="pauseBtn" disabled>⏸ Pause</button>
    </div>

    <div id="recordStatus" style="margin-top:8px; display:flex; align-items:center; gap:8px;">
      <span id="recDot" class="rec-dot" aria-hidden="true"></span>
      <span id="recDuration">0.0s</span>
    </div>

    <div class="row">
      <button id="saveBtn" disabled>Save attempt</button>
      <button id="nextBtn" disabled>Next</button>
      <button id="learnAgainBtn" disabled>↺ Learn again</button>
      <button id="goHomeBtn">🏠 Home</button>
    </div>

    <div id="hint" style="margin-top:8px; font-size:14px; opacity:0.8;"></div>
    <div id="trainingDebug" style="font-size:12px;color:#444;margin-top:8px;"></div>

    <button id="savedToggle" class="saved-toggle" aria-expanded="false">▸ Saved</button>
    <aside id="savedPanel" class="saved-panel" aria-hidden="true">
      <div class="saved-header">
        <strong>Saved Attempts</strong>
        <button id="closeSaved" class="close-btn">✕</button>
      </div>
      <div id="savedList" class="saved-list"></div>
    </aside>
  `;

  try {
    const status = $("status");
    const prompt = $("prompt");
    const countdownEl = $("countdown");
    const hint = $("hint");
    const trainingDebug = $("trainingDebug");
    // Progress summary pill (updates as you mark correct/incorrect)
let progressPill = document.getElementById('progressPill');
if (!progressPill) {
  progressPill = document.createElement('div');
  progressPill.id = 'progressPill';
  progressPill.className = 'progress-pill';
  status.after(progressPill);
}

function updateProgressPill() {
  if (!paragraphId || !Array.isArray(sentences)) { progressPill.textContent = ''; return; }
  const p = countProgress(paragraphId, sentences.length);
  progressPill.innerHTML = `Progress: <b>${p.correct}</b> correct / <b>${p.attempted}</b> attempted / <b>${p.total}</b> total`;
}


    function debug(msg) {
      try {
        console.log('[training]', msg);
        if (trainingDebug) {
          const p = document.createElement('div');
          p.textContent = msg;
          trainingDebug.appendChild(p);
        }
        // keep top notice updated for the first few important states
        try { setTopNotice('Training: ' + msg); } catch(e) {}
      } catch (e) { console.error('debug failed', e); }
    }

    debug('showTrainingUI mounted');

    // Guard: ensure we have chunks to run (fail fast and provide a Back button)
    if (!Array.isArray(sentences) || !sentences.length) {
      debug('no chunks found — returning to home');
      setTopNotice('No chunks found for this paragraph — split into sentences first.');
      const backDiv = document.createElement('div');
      backDiv.style.margin = '12px';
      backDiv.innerHTML = `<button id="backHome">↩ Back to Home</button>`;
      document.body.appendChild(backDiv);
      const bh = document.getElementById('backHome');
      if (bh) bh.onclick = () => { try { history.back(); } catch (e) { location.reload(); } };
      return;
    } else {
      debug('chunks found: ' + sentences.length);
    }

    // Sanitize currentIndex
    if (typeof currentIndex !== 'number' || currentIndex < 0 || currentIndex >= sentences.length) currentIndex = 0;
    debug('currentIndex = ' + currentIndex);

    // Small runtime probe to surface when training UI has been mounted
    try { setTopNotice('Training UI ready — ' + sentences.length + ' chunks.'); } catch(e) {}

    const recBtn = $("recBtn");
    const stopBtn = $("stopBtn");
    const playBtn = $("playBtn");
    const pauseBtn = $("pauseBtn");
    const saveBtn = $("saveBtn");
    const nextBtn = $("nextBtn");
    const learnAgainBtn = $("learnAgainBtn");
    const goHomeBtn = $("goHomeBtn");

    // Accessibility: add ARIA labels, titles, and keyboard handlers for interactives
    try {
      if (recBtn) { recBtn.setAttribute('aria-label','Start recording'); recBtn.title='Start recording (Space/Enter)'; recBtn.tabIndex = 0; }
      if (stopBtn) { stopBtn.setAttribute('aria-label','Stop recording'); stopBtn.title='Stop recording'; stopBtn.tabIndex = 0; }
      if (playBtn) { playBtn.setAttribute('aria-label','Play last recording'); playBtn.title='Play last recording'; playBtn.tabIndex = 0; }
      if (pauseBtn) { pauseBtn.setAttribute('aria-label','Pause countdown'); pauseBtn.title='Pause countdown'; pauseBtn.tabIndex = 0; }
      if (saveBtn) { saveBtn.setAttribute('aria-label','Save attempt'); saveBtn.title='Save attempt'; saveBtn.tabIndex = 0; }
      if (nextBtn) { nextBtn.setAttribute('aria-label','Next chunk'); nextBtn.title='Next chunk'; nextBtn.tabIndex = 0; }
      if (learnAgainBtn) { learnAgainBtn.setAttribute('aria-label','Learn again'); learnAgainBtn.title='Replay chunk'; learnAgainBtn.tabIndex = 0; }
      if (goHomeBtn) { goHomeBtn.setAttribute('aria-label','Go home'); goHomeBtn.title='Go home'; goHomeBtn.tabIndex = 0; }

      const ram = $('recordAgainMain'); if (ram) { ram.setAttribute('aria-label','Record again (test)'); ram.title='Record again'; }
      const rrb = $('recordRefAgain'); if (rrb) { rrb.setAttribute('aria-label','Record again (reference)'); rrb.title='Record again reference'; rrb.tabIndex=0; rrb.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); rrb.click(); } }); }
    } catch (e) { console.warn('ARIA setup failed', e); }

    const savedToggle = $("savedToggle");
    const savedPanel = $("savedPanel");
    const savedList = $("savedList");
    const closeSaved = $("closeSaved");

    // In-memory store for attempts for this session
    const attempts = [];
    let refUrl = null; // URL for the reference blob
    let compareRefUrl = null; // URL used in compare UI
    let orphanedRefs = {}; // in-memory store for previous references when replaced (keyed by paragraphId|chunkIndex)
    let currentUserAttempt = null; // in-memory attempt object when testing
    let mainAttAudio = null; // Audio instance for main play button
    let mainAttPlaying = false;
    let compareAttUrl = null; // URL used in compare UI

    // Paragraph storage helpers are defined in global scope (see top-level helpers)

    async function refreshSavedPanel() {
      try {
        // Show saved paragraphs first (global across sessions)
        const paras = getSavedParagraphs();
        savedList.innerHTML = '';
        if (paras.length) {
          const psec = document.createElement('div');
          psec.className = 'saved-chunk';
          psec.innerHTML = `<div class="saved-chunk-title">Paragraphs <small style="color:#666; margin-left:8px">(${paras.length})</small></div>`;
          paras.forEach(p => {
            const row = document.createElement('div');
            row.className = 'saved-item';
            row.innerHTML = `
              <div class="saved-meta"><strong>${(p.name||'Paragraph')}</strong> <span style="margin-left:8px;color:#666">${formatTS(p.ts)}</span></div>
              <div class="saved-actions">
                <button data-id="${p.id}" class="restore-par">⤺ Restore</button>
                <button data-id="${p.id}" class="rename-par">✎ Rename</button>
                <button data-id="${p.id}" class="delete-par">🗑 Delete</button>
              </div>
            `;
            psec.appendChild(row);

            // handlers
            row.querySelector('.restore-par').onclick = () => {
              try {
                if (paragraphInput) paragraphInput.value = p.text || '';
                sentences = Array.isArray(p.sentences) ? p.sentences : [];
                renderSentences();
                if (startBtn) startBtn.disabled = sentences.length === 0;
                try { saveAppState(); } catch(e) {}
                setTopNotice('Restored ' + (p.name||'paragraph'));
                closeSavedPanel();
              } catch (e) { console.error('restore paragraph failed', e); }
            };
            row.querySelector('.rename-par').onclick = () => {
              try {
                const nn = prompt('Rename paragraph', p.name || 'Paragraph');
                if (nn && nn.trim()) { renameSavedParagraph(p.id, nn.trim()); refreshSavedPanel(); }
              } catch(e){ console.warn(e); }
            };
            row.querySelector('.delete-par').onclick = () => {
              try {
                if (!confirm('Delete saved paragraph?')) return;
                deleteSavedParagraph(p.id);
                refreshSavedPanel();
                setTopNotice('Deleted saved paragraph.');
              } catch(e){ console.warn(e); }
            };
          });
          savedList.appendChild(psec);
        }

        // Now show saved attempts for this paragraph (if any)
        const all = await getAttemptsForParagraph(paragraphId);
        // Group by chunkIndex
        const byChunk = {};
        all.forEach(a => { (byChunk[a.chunkIndex] = byChunk[a.chunkIndex] || []).push(a); });

        if (!all.length) {
          if (!paras.length) {
            savedList.innerHTML = '<div style="padding:10px; color:#666">No saved attempts for this paragraph.</div>';
          }
          return;
        }

        Object.keys(byChunk).sort((a,b)=>a-b).forEach(ci => {
          const group = byChunk[ci];
          const h = document.createElement('div');
          h.className = 'saved-chunk';
          h.innerHTML = `<div class="saved-chunk-title">Chunk ${Number(ci)+1} <small style="color:#666; margin-left:8px">(${group.length} attempts)</small></div>`;
          group.forEach(item => {
            const row = document.createElement('div');
            row.className = 'saved-item';
            const playId = `play-${item.id}`;
            row.innerHTML = `
              <div class="saved-meta">${formatTS(item.ts)} <span style="margin-left:8px; color:#333">(${(item.duration||0).toFixed(1)}s)</span> ${item.isReference ? '<strong style="color:green; margin-left:8px">(reference)</strong>' : ''}</div>
              <div class="saved-actions">
                <button data-id="${item.id}" class="play-saved">▶ Play</button>
                <button data-id="${item.id}" class="delete-saved">🗑 Delete</button>
                ${!item.isReference ? `<button data-id="${item.id}" class="make-ref">★ Make reference</button>` : ''}
              </div>
            `;
            h.appendChild(row);

            // Attach handlers
            row.querySelector('.play-saved').onclick = () => {
  const b0 = item.blob;
  const blob =
    (b0 instanceof Blob)
      ? (b0.type ? b0 : new Blob([b0], { type: item.mimeType || 'audio/webm' }))
      : new Blob([b0], { type: item.mimeType || 'audio/webm' });

  const url = URL.createObjectURL(blob);
  const a = new Audio(url);
  a.play().catch(err => console.error('Play failed', err));
  a.onended = () => setTimeout(() => URL.revokeObjectURL(url), 2000);
};
            row.querySelector('.delete-saved').onclick = async () => {
              if (!confirm('Delete this saved attempt?')) return;
              await deleteAttemptById(item.id);
              refreshSavedPanel();
              hint.textContent = 'Deleted saved attempt.';
            };
            const makeBtn = row.querySelector('.make-ref');
            if (makeBtn) {
              makeBtn.onclick = async () => {
                await setReferenceAttempt(paragraphId, item.chunkIndex, item.id);
                hint.textContent = 'Reference updated.';
                refreshSavedPanel();
              };
            }
          });
          savedList.appendChild(h);
        });
      } catch (err) {
        console.error('Error loading saved attempts', err);
      }
    }

    function openSavedPanel() {
      savedPanel.classList.add('open');
      savedToggle.classList.add('open');
      savedToggle.setAttribute('aria-expanded', 'true');
      savedPanel.setAttribute('aria-hidden', 'false');
      refreshSavedPanel();
    }

    function closeSavedPanel() {
      savedPanel.classList.remove('open');
      savedToggle.classList.remove('open');
      savedToggle.setAttribute('aria-expanded', 'false');
      savedPanel.setAttribute('aria-hidden', 'true');
    }

    savedToggle.onclick = () => {
      if (savedPanel.classList.contains('open')) closeSavedPanel();
      else openSavedPanel();
    };
    closeSaved.onclick = closeSavedPanel;

    // Recording and control logic (recreated) -----------------------------
    let mediaRecorder = null;
    let chunks = [];
    let attemptBlob = null;
    let attemptUrl = null;

    let timer = null;
    let remaining = 0;
    let paused = false;

    let recordingStartTime = 0;
    let recordingTimer = null;
    let lastAttemptDuration = 0;

    function cleanupAttemptUrl() {
      // Revoke any created object URLs and clear compare UI
      try {
        if (attemptUrl) { URL.revokeObjectURL(attemptUrl); attemptUrl = null; }
        if (refUrl) { URL.revokeObjectURL(refUrl); refUrl = null; }
        if (compareRefUrl) { URL.revokeObjectURL(compareRefUrl); compareRefUrl = null; }
        if (compareAttUrl) { URL.revokeObjectURL(compareAttUrl); compareAttUrl = null; }
        const old = document.getElementById('compareArea'); if (old) old.remove();
        const durEl = $("recDuration"); if (durEl) durEl.textContent = '0.0s';
      } catch (e) { console.warn('cleanupAttemptUrl failed', e); }
    }

    // --- WAV fallback recorder (for Safari / browsers that can't play webm/opus) ---
let useWavRecorder = false;
let wavStream = null;
let wavCtx = null;
let wavSource = null;
let wavProcessor = null;
let wavBuffers = [];
let wavSampleRate = 44100;

function startWavRecorder(stream) {
  wavStream = stream;
  wavBuffers = [];

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  wavCtx = new AudioCtx();
  wavSampleRate = wavCtx.sampleRate;

  wavSource = wavCtx.createMediaStreamSource(stream);

  // ScriptProcessor works in Safari; it's old but reliable for this use.
  wavProcessor = wavCtx.createScriptProcessor(4096, 1, 1);
  wavProcessor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    wavBuffers.push(new Float32Array(input)); // copy
  };

  wavSource.connect(wavProcessor);
  wavProcessor.connect(wavCtx.destination);
}

function stopWavRecorder() {
  try { if (wavProcessor) wavProcessor.disconnect(); } catch(e){}
  try { if (wavSource) wavSource.disconnect(); } catch(e){}
  try { if (wavCtx) wavCtx.close(); } catch(e){}
  try { if (wavStream) wavStream.getTracks().forEach(t => t.stop()); } catch(e){}

  wavProcessor = null;
  wavSource = null;
  wavCtx = null;
  wavStream = null;

  const wavBlob = encodeWavFromFloat32(wavBuffers, wavSampleRate);
  wavBuffers = [];
  return wavBlob;
}

// PCM Float32 -> 16-bit WAV
function encodeWavFromFloat32(buffers, sampleRate) {
  let totalLength = 0;
  for (const b of buffers) totalLength += b.length;

  const pcm16 = new Int16Array(totalLength);
  let offset = 0;
  for (const b of buffers) {
    for (let i = 0; i < b.length; i++) {
      let s = Math.max(-1, Math.min(1, b[i]));
      pcm16[offset++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
  }

  const wavHeaderSize = 44;
  const dataSize = pcm16.byteLength;
  const buffer = new ArrayBuffer(wavHeaderSize + dataSize);
  const view = new DataView(buffer);

  function writeStr(o, s) { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); }

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);        // PCM chunk size
  view.setUint16(20, 1, true);         // PCM format
  view.setUint16(22, 1, true);         // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate = sampleRate * channels * bytesPerSample
  view.setUint16(32, 2, true);         // block align
  view.setUint16(34, 16, true);        // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM data
  let p = 44;
  for (let i = 0; i < pcm16.length; i++, p += 2) view.setInt16(p, pcm16[i], true);

  return new Blob([buffer], { type: 'audio/wav' });
}

function isSafariLike() {
  const ua = navigator.userAgent || '';
  const vendor = navigator.vendor || '';

  // iOS/iPadOS Safari detection
  const isAppleDevice = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isWebKit = /WebKit/.test(ua);
  const isNotChromium = !/CriOS|Chrome|EdgiOS|FxiOS|OPiOS/.test(ua);

  // On iOS all browsers use WebKit, but we specifically want Safari-ish behavior.
  // vendor usually "Apple Computer, Inc." on Safari
  const isAppleVendor = /Apple/i.test(vendor);

  return isAppleDevice && isWebKit && isNotChromium && isAppleVendor;
}


    async function startRecording() {
      // If a countdown timer is running, stop it — recording should take precedence
      try {
        if (timer) { clearInterval(timer); timer = null; countdownEl.textContent = 'Recording...'; pauseBtn.disabled = true; }
        // Pause reference player if present
        const rp = document.getElementById('refPlayerInline'); if (rp && !rp.paused) try { rp.pause(); } catch(e) {}
        // Hide and disable any reference 'Record again' button while recording is active
        try { const rrb = $('recordRefAgain'); if (rrb) { rrb.style.display = 'none'; rrb.disabled = true; } const rrb2 = document.getElementById('recordRefAgain'); if (rrb2) { rrb2.style.display = 'none'; rrb2.disabled = true; } } catch(e) {}
      } catch(e) { console.warn('startRecording pre-clean failed', e); }

      cleanupAttemptUrl();
      attemptBlob = null;
      chunks = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Decide recorder based on playback support.
// Decide recorder: Safari/iPad gets WAV because WebM/Opus playback is unreliable there.
const safari = isSafariLike();
useWavRecorder = safari;
// DEBUG: show decision + user agent (so we can see what's happening on iPad)
try { setTopNotice('UA=' + navigator.userAgent); } catch(e) {}
try { setTopNotice('Decision: useWavRecorder=' + useWavRecorder); } catch(e) {}


      // Pick a recording format the current browser can PLAY back
const preferredTypes = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/ogg'
];

if (useWavRecorder) {
  startWavRecorder(stream);
  recordingStartTime = Date.now();
  const dot = $("recDot"); if (dot) dot.classList.add('on');
  recordingTimer = setInterval(() => {
    const durEl = $("recDuration");
    if (durEl) durEl.textContent = ((Date.now() - recordingStartTime) / 1000).toFixed(1) + 's';
  }, 100);

  try { try { setTopNotice('Record as: audio/wav'); } catch(e) {}
; } catch(e) {}
  hint.textContent = 'Recording (WAV)… press Stop when done.';
  return;
}

let options = {};
for (const t of preferredTypes) {
  if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
    options.mimeType = t;
    break;
  }
}

mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.onstop = () => {
        try { stream.getTracks().forEach(t => t.stop()); } catch(e){}
        const finalType = (mediaRecorder && mediaRecorder.mimeType) ? mediaRecorder.mimeType : (options.mimeType || 'audio/webm');
attemptBlob = new Blob(chunks, { type: finalType });
try { setTopNotice('Recorded as: ' + finalType); } catch(e) {}


        attemptUrl = URL.createObjectURL(attemptBlob);
        lastAttemptDuration = ((Date.now() - recordingStartTime) / 1000) || 0;
        const durEl = $("recDuration"); if (durEl) durEl.textContent = lastAttemptDuration.toFixed(1) + 's';
        const dot = $("recDot"); if (dot) dot.classList.remove('on');
        if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }

        // Reset main audio so play toggles will use the fresh URL
        try {
          if (mainAttAudio) { try { mainAttAudio.pause(); } catch(e){} mainAttAudio = null; mainAttPlaying = false; const pb = $('playBtn'); if (pb) pb.textContent = '▶ Play'; }
        } catch(e){}

        playBtn.disabled = false;
        saveBtn.disabled = false;
        hint.textContent = 'Recorded. You can play it back or save it.';

        // After a recording finishes, reveal the reference 'Record again' control in the Reference creation flow
        try {
          const rrb = $('recordRefAgain');
          if (rrb) {
            // Only show it if there is no existing reference yet for this chunk
            getReferenceAttempt(paragraphId, currentIndex).then(existingRef => {
              if (!existingRef) { try { rrb.style.display = 'inline-block'; rrb.disabled = false; } catch(e){} }
            }).catch(() => { try { rrb.style.display = 'inline-block'; rrb.disabled = false; } catch(e){} });
          }
        } catch(e) { console.warn('Failed to enable reference record-again control', e); }
      };
      mediaRecorder.start();
      recordingStartTime = Date.now();
      const dot = $("recDot"); if (dot) dot.classList.add('on');
      recordingTimer = setInterval(() => {
        const durEl = $("recDuration"); if (durEl) durEl.textContent = ((Date.now() - recordingStartTime) / 1000).toFixed(1) + 's';
      }, 100);
      hint.textContent = 'Recording… speak clearly, then press Stop.';
    }

    function stopRecording() {
  try {
    if (useWavRecorder) {
      // Finish WAV recording immediately and simulate the same "onstop" behavior
      attemptBlob = stopWavRecorder();
      attemptUrl = URL.createObjectURL(attemptBlob);
      try { setTopNotice('Recording as: audio/wav'); } catch(e) {}

      lastAttemptDuration = ((Date.now() - recordingStartTime) / 1000) || 0;
      const durEl = $("recDuration"); if (durEl) durEl.textContent = lastAttemptDuration.toFixed(1) + 's';
      const dot = $("recDot"); if (dot) dot.classList.remove('on');
      if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }

      playBtn.disabled = false;
      saveBtn.disabled = false;
      hint.textContent = 'Recorded (WAV). You can play it back or save it.';
      return;
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  } catch(e) {
    console.warn('stopRecording failed', e);
  }
}
    function playAttempt() {
      // Toggle Play/Stop for the most recent recorded attempt in the main controls
      if (!attemptUrl) return;
      try {
        if (!mainAttAudio) {
          mainAttAudio = new Audio(attemptUrl);
          mainAttAudio.onended = () => { mainAttPlaying = false; try { const pb = $('playBtn'); if (pb) pb.textContent = '▶ Play'; } catch(e){} };
        }
        const pb = $('playBtn');
        if (!mainAttPlaying) {
          mainAttAudio.play();
          mainAttPlaying = true;
          if (pb) pb.textContent = '■ Stop';
        } else {
          try { mainAttAudio.pause(); mainAttAudio.currentTime = 0; } catch(e){}
          mainAttPlaying = false;
          if (pb) pb.textContent = '▶ Play';
        }
      } catch (e) { console.error('playAttempt failed', e); }
    }

    async function saveAttempt() {
      if (!attemptBlob) return;
      const mimeType = attemptBlob.type || 'audio/webm';
      const duration = lastAttemptDuration || 0;
      try {
        const existingRef = await getReferenceAttempt(paragraphId, currentIndex);
        const isRef = !existingRef; // if no reference exists yet, mark this one as reference

        if (isRef) {
          // Persist the reference permanently
          const id = await saveAttemptToDB({ paragraphId, chunkIndex: currentIndex, blob: attemptBlob, mimeType, duration, isReference: true });
          hint.textContent = `Saved reference for chunk ${currentIndex + 1}. (${duration.toFixed(1)}s)`;
          saveBtn.disabled = true;
          nextBtn.disabled = false;
          // Hide any reference-phase "Record again" control (we've just saved)
          try { const rrb2 = $('recordRefAgain'); if (rrb2) { rrb2.style.display = 'none'; rrb2.disabled = true; } } catch(e){}
          if (savedPanel.classList.contains('open')) refreshSavedPanel();
          // Ensure the paragraph is saved to the paragraph store so it shows in the bar
          try { saveParagraphToStore((paragraphInput && paragraphInput.value) || '', null, sentences, paragraphId); } catch(e){}
          saveAppState();

          // Check if we've now saved references for all chunks; if so, move to test mode (chunk 0)
          try {
            const allAttempts = await getAttemptsForParagraph(paragraphId);
            const refs = new Set(allAttempts.filter(a => a.isReference).map(a => Number(a.chunkIndex)));
            if (refs.size >= sentences.length) {
              setTopNotice('All references saved — switching to Test mode.');
              setTimeout(() => { currentIndex = 0; runChunk(); }, 700);
            }
          } catch(e) { /* ignore */ }

          return id;
        } else {
          // Test attempt: do NOT persist permanently. Use the blob in-memory for comparison only.
          const refAttempt = existingRef;
          const userAttempt = { id: null, paragraphId, chunkIndex: currentIndex, blob: attemptBlob, mimeType, duration, ts: Date.now(), isReference: false };
          // Keep this in memory so main controls can operate on it
          currentUserAttempt = userAttempt;

          hint.textContent = `Recorded attempt for chunk ${currentIndex + 1}. (not saved)`;
          saveBtn.disabled = true;
          nextBtn.disabled = false;

          try { const pb = $('playBtn'); if (pb) pb.textContent = '▶ Play'; } catch(e){}

          // Show comparison UI immediately without saving the user attempt
          try {
            showCompareUI(refAttempt, userAttempt);
            console.log("REF blob instanceof Blob:", refAttempt.blob instanceof Blob);
console.log("REF mimeType:", refAttempt.mimeType);
console.log("REF blob type:", refAttempt.blob && refAttempt.blob.type);
          } catch (e) { console.error('Failed to show comparison UI', e); }
        }
      } catch (err) {
        console.error('Failed to save attempt', err);
        hint.textContent = 'Failed to save attempt.';
      }
    }

    function runChunk() {
      try {
        // Remove compare UI from previous chunk and revoke any compare URLs
        try {
          const old = document.getElementById('compareArea'); if (old) old.remove();
          if (compareRefUrl) { URL.revokeObjectURL(compareRefUrl); compareRefUrl = null; }
          if (compareAttUrl) { URL.revokeObjectURL(compareAttUrl); compareAttUrl = null; }
        } catch (e) { console.warn('Failed to cleanup compare UI', e); }

        // Reset UI state for new chunk
        nextBtn.disabled = true;
        playBtn.disabled = true;
        saveBtn.disabled = true;
        stopBtn.disabled = true;
        pauseBtn.disabled = false;
        learnAgainBtn.disabled = true;
        hint.textContent = '';

        // Hide and disable main record-again control and clear any in-memory test attempt
        const ram = $('recordAgainMain'); if (ram) { ram.style.display = 'none'; ram.disabled = true; }
        const rrb = $('recordRefAgain'); if (rrb) { try { rrb.style.display = 'none'; rrb.disabled = true; } catch(e) { /* ignore */ } }
        currentUserAttempt = null;
        try { if (mainAttAudio) { try { mainAttAudio.pause(); } catch(e){} mainAttAudio = null; mainAttPlaying = false; } } catch(e){}

        cleanupAttemptUrl();
        attemptBlob = null;

        const s = sentences[currentIndex];
        if (typeof s !== 'string') throw new Error('Invalid chunk text');

        // Decide if this chunk has a reference
        getReferenceAttempt(paragraphId, currentIndex).then(ref => {
          const isTestMode = !!ref;

          status.textContent = `Chunk ${currentIndex + 1} of ${sentences.length}` + (isTestMode ? ' (test)' : '');
          updateProgressPill();


          if (isTestMode) {
            // Provide a 'Show sentence' button that reveals the chunk while held (mouse, touch, or keyboard)
            try {
              prompt.innerHTML = `<div style="margin-bottom:6px;"><button id="showSentenceBtn" class="show-sentence-btn">Show sentence (hold)</button></div><div id="tempSentence" class="prompt-sentence" style="display:none; font-size:22px; margin-top:8px; line-height:1.35;"></div>`;
              const showBtn = document.getElementById('showSentenceBtn');
              const temp = document.getElementById('tempSentence');
              const reveal = () => { try { temp.textContent = s; temp.style.display = 'block'; } catch(e){} };
              const hide = () => { try { temp.style.display = 'none'; temp.textContent = ''; } catch(e){} };

              if (showBtn) {
                // Mouse
                showBtn.addEventListener('mousedown', reveal);
                showBtn.addEventListener('mouseup', hide);
                showBtn.addEventListener('mouseleave', hide);
                // Touch
                showBtn.addEventListener('touchstart', (e)=>{ e.preventDefault(); reveal(); }, {passive:false});
                showBtn.addEventListener('touchend', hide);
                showBtn.addEventListener('touchcancel', hide);
                // Keyboard (space or enter should act as hold)
                showBtn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); reveal(); } });
                showBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hide(); } });
                // Accessibility
                showBtn.setAttribute('aria-pressed', 'false');
              }
            } catch (e) { console.error('Failed to render show-sentence button', e); }

            // Allow recording immediately; user may choose to peek at the sentence or record before the countdown ends
            recBtn.disabled = false;
            countdownEl.textContent = `Memorise: ${getMemorizeTime()}s`;
            remaining = getMemorizeTime();
            paused = false;
            pauseBtn.textContent = '⏸ Pause';
            hint.textContent = 'Hold "Show sentence" to peek; you can record at any time.';

            if (timer) clearInterval(timer);
            timer = setInterval(() => {
              try {
                if (!paused) {
                  remaining -= 1;
                  countdownEl.textContent = `Memorise: ${remaining}s`;
                  if (remaining <= 0) {
                    clearInterval(timer);
                    timer = null;
                    countdownEl.textContent = 'Now recite it, then save your attempt.';
                    learnAgainBtn.disabled = false;
                    pauseBtn.disabled = true;
                  }
                }
              } catch (err) { console.error('Timer callback error', err); }
            }, 1000);
          } else {
            // Study mode (no reference) — show prompt and allow immediate recording
            // (No countdown here — memorize timer belongs to the Test flow)
            status.textContent = `Chunk ${currentIndex + 1} of ${sentences.length}`;
            prompt.textContent = s;

            // Ensure no countdown is running and hide countdown UI
            try { if (timer) { clearInterval(timer); timer = null; } } catch(e){}
            countdownEl.textContent = '';
            pauseBtn.disabled = true;
            paused = false;
            pauseBtn.textContent = '⏸ Pause';

            // Guidance for the user
            hint.textContent = 'Read the sentence and record when ready; you can re-record before saving.';

            // Enable recording immediately
            recBtn.disabled = false;

            // Add a visible "Record again" control for reference creation so users can quickly re-record
            try {
              let rrb = $('recordRefAgain');
              if (!rrb) {
                rrb = document.createElement('button');
                rrb.id = 'recordRefAgain';
                rrb.textContent = 'Record again';
                rrb.style.marginLeft = '8px';
                // place after the main record button if possible
                try { recBtn.after(rrb); } catch(e) { hint.after(rrb); }
                // Accessibility
                try { rrb.setAttribute('aria-label','Record again (reference)'); rrb.title = 'Record again (press Enter/Space)'; rrb.tabIndex = 0; rrb.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); rrb.click(); } }); } catch(e) {}
              }
              // Initially hide and disable until a recording finishes
              rrb.style.display = 'none';
              rrb.disabled = true;
              rrb.onclick = async () => {
                try {
                  rrb.disabled = true;
                  hint.textContent = 'Recording new reference…';
                  await startRecording();
                  stopBtn.disabled = false;
                } catch (e) { console.error('recordRefAgain (study) failed', e); hint.textContent = 'Failed to record.'; rrb.disabled = false; }
              };
            } catch(e) { console.error('Failed to setup recordRefAgain in study flow', e); }
          }

          // Optionally show saved attempts for this chunk (if panel open)
          if (savedPanel.classList.contains('open')) refreshSavedPanel();
        }).catch(err => {
          console.error('Error checking reference for chunk', err);
        });
      } catch (err) {
        console.error('runChunk failed', err);
        setTopNotice('Failed to show the chunk: ' + (err && err.message));
      }
    }

    pauseBtn.onclick = () => {
      if (pauseBtn.disabled) return;
      paused = !paused;
      pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
      countdownEl.textContent = paused ? 'Paused' : `Memorise: ${remaining}s`;
    };

    learnAgainBtn.onclick = () => {
      learnAgainBtn.disabled = true;
      runChunk();
    };

    goHomeBtn.onclick = () => {
      try { if (mediaRecorder && mediaRecorder.state !== 'inactive') stopRecording(); } catch (e) {}
      try { saveAppState(); } catch(e){}
      try { history.back(); } catch(e) { location.reload(); }
    };

    recBtn.onclick = async () => {
      try {
        recBtn.disabled = true;
        stopBtn.disabled = false;
        await startRecording();
      } catch (err) {
        recBtn.disabled = false;
        stopBtn.disabled = true;
        hint.textContent = 'Mic permission blocked. Allow microphone access and try again.';
        console.error(err);
      }
    };

    // Main 'record again' button in the toolbar (for test attempts)
    const recordAgainMainBtn = $('recordAgainMain');
    if (recordAgainMainBtn) {
      recordAgainMainBtn.onclick = async () => {
        try {
          // Stop any playing audio
          if (mainAttAudio && mainAttPlaying) { try { mainAttAudio.pause(); mainAttAudio.currentTime = 0; } catch(e){} mainAttPlaying=false; if ($('playBtn')) $('playBtn').textContent='▶ Play'; }

          // Start a new recording
          hint.textContent = 'Recording new attempt…';
          recordAgainMainBtn.disabled = true;
          await startRecording();
          stopBtn.disabled = false;

          // Wait for the recording to end (attemptBlob will be set by onstop)
          const prev = currentUserAttempt ? currentUserAttempt.blob : null;
          const startWait = Date.now();
          await new Promise(resolve => {
            const iv = setInterval(() => {
              if (attemptBlob && attemptBlob !== prev) { clearInterval(iv); resolve(); }
              if (Date.now() - startWait > 30000) { clearInterval(iv); resolve(); }
            }, 200);
          });

          // Update in-memory attempt and UI
          if (attemptBlob) {
            if (!currentUserAttempt) currentUserAttempt = { id: null, paragraphId, chunkIndex: currentIndex };
            currentUserAttempt.blob = attemptBlob;
            currentUserAttempt.duration = lastAttemptDuration || currentUserAttempt.duration;
            currentUserAttempt.ts = Date.now();

            // Update compare UI if present
            try {
              if (compareAttUrl) { URL.revokeObjectURL(compareAttUrl); compareAttUrl = null; }
              compareAttUrl = URL.createObjectURL(currentUserAttempt.blob);
              const ap = document.getElementById('attPlayer'); if (ap) { ap.src = compareAttUrl; }
              const durEl = document.getElementById('attDur'); if (durEl) durEl.textContent = `${(currentUserAttempt.duration||0).toFixed(1)}s`;
            } catch (e) { /* ignore */ }

            hint.textContent = 'Recorded new attempt (not saved).';
            // Reset main audio so it will play the new blob
            if (mainAttAudio) { try { mainAttAudio.pause(); } catch(e){} mainAttAudio=null; mainAttPlaying=false; if ($('playBtn')) $('playBtn').textContent='▶ Play'; }
          } else {
            hint.textContent = 'Recording timed out or failed.';
          }
        } catch (e) {
          console.error('recordAgainMain failed', e);
          hint.textContent = 'Failed to record again.';
        } finally {
          try { recordAgainMainBtn.disabled = false; } catch(e){}
        }
      };
    }
    stopBtn.onclick = () => {
      stopBtn.disabled = true;
      stopRecording();
    };

    playBtn.onclick = playAttempt;
    saveBtn.onclick = saveAttempt;

    nextBtn.onclick = () => {
      currentIndex += 1;
      if (currentIndex >= sentences.length) {
        status.textContent = 'Done! You can review saved attempts from the Saved panel.';
        prompt.textContent = '';
        countdownEl.textContent = '';
        hint.textContent = '';
        recBtn.disabled = true;
        stopBtn.disabled = true;
        playBtn.disabled = true;
        saveBtn.disabled = true;
        nextBtn.disabled = true;
        return;
      }
      runChunk();
    };

    // Open panel if there are saved attempts right away
    getAttemptsForParagraph(paragraphId).then(all => {
      if (all && all.length) openSavedPanel();
    }).catch(()=>{});

    // Comparison UI: show reference vs attempt and provide mark buttons
    function showCompareUI(refAttempt, userAttempt) {
      try {
        // remove old compare area if present and revoke old compare URLs
        const old = document.getElementById('compareArea'); if (old) old.remove();
        if (compareRefUrl) { URL.revokeObjectURL(compareRefUrl); compareRefUrl = null; }
        if (compareAttUrl) { URL.revokeObjectURL(compareAttUrl); compareAttUrl = null; }

        const div = document.createElement('div');
        div.id = 'compareArea';
        div.style.marginTop = '12px';
        div.innerHTML = `
          <div style="font-weight:bold; margin-bottom:6px">Compare your attempt with the reference</div>
          <div style="display:flex; gap:12px; align-items:flex-start;">
            <div style="flex:1">
              <div style="font-size:12px;color:#666">Reference</div>
              <div style="margin-top:6px;">
                <div style="font-size:14px; color:#111; margin-bottom:6px;">Reference recording <span id="refDur" style="font-size:12px; color:#666; margin-left:8px">${(refAttempt.duration||0).toFixed(1)}s</span></div>
                <audio id="refPlayer" controls style="width:100%"></audio>
              </div>
            </div>
            <div style="flex:1">
              <div style="font-size:12px;color:#666">Your attempt</div>
              <div style="margin-top:6px;">
                <div style="font-size:14px; color:#111; margin-bottom:6px;">Your recording <span id="attDur" style="font-size:12px; color:#666; margin-left:8px">${(userAttempt.duration||0).toFixed(1)}s</span></div>
                <audio id="attPlayer" controls style="width:100%"></audio>
              </div>
            </div>
          </div>
          <div style="margin-top:8px; display:flex; gap:8px;">
            <button id="markCorrect">Mark Correct</button>
            <button id="markIncorrect">Mark Incorrect</button>
            <button id="replaceRef">Make this the reference</button>
          </div>
        `;
        hint.after(div);

const refPlayer = document.getElementById('refPlayer');
const attPlayer = document.getElementById('attPlayer');

if (refPlayer) {
  if (compareRefUrl) { URL.revokeObjectURL(compareRefUrl); compareRefUrl = null; }

  const refBlob =
    (refAttempt.blob && refAttempt.blob.type)
      ? refAttempt.blob
      : new Blob([refAttempt.blob], { type: refAttempt.mimeType || 'audio/webm' });

  compareRefUrl = URL.createObjectURL(refBlob);
  refPlayer.src = compareRefUrl;

  try {
    refPlayer.pause();
    refPlayer.currentTime = 0;
    refPlayer.setAttribute('aria-label', 'Reference audio control');
  } catch (e) {}
}

if (attPlayer) {
  if (compareAttUrl) { URL.revokeObjectURL(compareAttUrl); compareAttUrl = null; }

  const attBlob =
    (userAttempt.blob && userAttempt.blob.type)
      ? userAttempt.blob
      : new Blob([userAttempt.blob], { type: userAttempt.mimeType || 'audio/webm' });

  compareAttUrl = URL.createObjectURL(attBlob);
  attPlayer.src = compareAttUrl;

  try {
    attPlayer.pause();
    attPlayer.currentTime = 0;
    attPlayer.setAttribute('aria-label', 'Your attempt audio control');
  } catch (e) {}
}
        // Audio elements show their own native controls (no custom play buttons)
        // Compare UI does not include a re-record control; re-recording references is handled in the Reference (Study) flow only.

        const markCorrect = document.getElementById('markCorrect');
        const markIncorrect = document.getElementById('markIncorrect');
        const replaceRef = document.getElementById('replaceRef');

        markCorrect.onclick = async () => {
          saveCheckResult(paragraphId, currentIndex, true, userAttempt.id, refAttempt.id);
          updateProgressPill();
          hint.textContent = 'Marked correct — moving to next chunk.';
          setTimeout(() => { currentIndex += 1; runChunk(); }, 700);
        };
        markIncorrect.onclick = async () => {
          saveCheckResult(paragraphId, currentIndex, false, userAttempt.id, refAttempt.id);
          updateProgressPill();
          hint.textContent = 'Marked incorrect — try this chunk again.';
          setTimeout(() => { runChunk(); }, 700);
        };
        replaceRef.onclick = async () => {
          try {
            let refId = userAttempt.id;
            // If this user attempt is not persisted, save it as the new reference first
            if (!refId) {
              refId = await saveAttemptToDB({ paragraphId, chunkIndex: currentIndex, blob: userAttempt.blob, mimeType: userAttempt.mimeType, duration: userAttempt.duration, isReference: true });
            }

            // Ensure the paragraph is saved in the paragraphs store
            try { saveParagraphToStore((paragraphInput && paragraphInput.value) || '', null, sentences, paragraphId); } catch(e){}

            // Before we set the new reference, if an existing reference exists in DB, remove it and keep its blob in memory
            try {
              const existingRef = await getReferenceAttempt(paragraphId, currentIndex);
              if (existingRef && existingRef.id && existingRef.id !== refId) {
                // Store blob in memory and delete the DB record
                const key = paragraphId + '|' + currentIndex;
                orphanedRefs[key] = { blob: existingRef.blob, mimeType: existingRef.mimeType, duration: existingRef.duration, ts: existingRef.ts };
                try { await deleteAttemptById(existingRef.id); } catch(e) { /* best-effort */ }
              }
            } catch (e) { /* ignore */ }

            // Ensure this id is marked as the only reference for the chunk
            await setReferenceAttempt(paragraphId, currentIndex, refId);

            // Update the compare UI reference player to point to the new reference blob
            try {
              if (compareRefUrl) { URL.revokeObjectURL(compareRefUrl); compareRefUrl = null; }
              compareRefUrl = URL.createObjectURL(userAttempt.blob);
              const refPlayer2 = document.getElementById('refPlayer'); if (refPlayer2) refPlayer2.src = compareRefUrl;
            } catch (e) { /* ignore UI update errors */ }

            hint.textContent = 'This attempt is now the reference.';
            // If we have a current in-memory attempt, update it and clear the quick-record controls
            try { if (currentUserAttempt) { currentUserAttempt.id = refId; } const ram2 = $('recordAgainMain'); if (ram2) { ram2.style.display='none'; ram2.disabled = true; } const rrb2 = $('recordRefAgain'); if (rrb2) { rrb2.style.display='none'; rrb2.disabled = true; } } catch(e){}
            refreshSavedPanel();

            // After replacing, check if all chunks have references and switch to Test mode if so
            try {
              const allAttempts = await getAttemptsForParagraph(paragraphId);
              const refs = new Set(allAttempts.filter(a => a.isReference).map(a => Number(a.chunkIndex)));
              if (refs.size >= sentences.length) {
                setTopNotice('All references saved — switching to Test mode.');
                setTimeout(() => { currentIndex = 0; runChunk(); }, 700);
              }
            } catch(e) {}

          } catch (e) {
            console.error('Failed to make this attempt the reference', e);
            hint.textContent = 'Failed to make this the reference.';
          }
        };
      } catch (e) { console.error('showCompareUI failed', e); }
    }

    // Start the first chunk
    debug('about to run first chunk');
    try { runChunk(); debug('first chunk started'); } catch (err) { console.error('Initial runChunk failed', err); setTopNotice('Failed to start chunk: ' + (err && err.message)); debug('runChunk failed: ' + (err && err.message ? err.message : String(err))); }


  } catch (err) {
    // Surface the error in the notice area and provide a home button fallback
    console.error('Error initializing training UI', err);
    setTopNotice('Failed to start training: ' + (err && err.message ? err.message : String(err)));
    const fallback = document.createElement('div');
    fallback.style.margin = '12px';
    fallback.innerHTML = `<button id="forceHome">Return home</button>`;
    document.body.appendChild(fallback);
    const fh = document.getElementById('forceHome');
    if (fh) fh.onclick = () => location.reload();
  }
}

// If key elements are missing, tell us immediately
const missing = []; 
if (!paragraphInput) missing.push("paragraph textarea");
if (!splitBtn) missing.push("splitBtn");
if (!startBtn) missing.push("startBtn");
if (!sentenceList) missing.push("sentenceList");
if (!splitSmallBtn) missing.push("splitSmallBtn");

if (missing.length) {
  setTopNotice("Missing elements in index.html: " + missing.join(", "));
} else {
  setTopNotice("Ready. Chunk size = " + getChunkSize() + " (slider optional).");
}

// --- Recall mode UI wiring (home screen) ---
try {
  ;(function initRecallModeUI() {
    const radios = document.querySelectorAll('input[name="recallMode"]');
    if (!radios || !radios.length) return;

    // If helpers aren't defined for some reason, do nothing (don’t break buttons)
    if (typeof getRecallMode !== 'function' || typeof setRecallMode !== 'function') {
      console.warn('Recall mode helpers missing');
      return;
    }

    const saved = getRecallMode();
    radios.forEach(r => {
      r.checked = (r.value === saved);
      r.addEventListener('change', () => {
        setRecallMode(r.value);
        try { saveAppState(); } catch(e) {}
        setTopNotice('Recall mode: ' + getRecallMode());
      });
    });
  })();
} catch (e) {
  console.error('Recall mode init failed', e);
  try { setTopNotice('Recall mode init failed (buttons should still work).'); } catch(_) {}
}



// Wire buttons safely
if (splitBtn) {
  splitBtn.onclick = () => {
    const text = paragraphInput.value.trim();
    if (!text) return;

    // Split into sentences first, then ensure no chunk exceeds the chosen size.
    const base = splitIntoSentences(text);
    const maxWords = getChunkSize();
    const out = [];
    base.forEach(s => {
      const words = s.split(/\s+/).filter(Boolean);
      if (words.length <= maxWords) out.push(s);
      else {
        // Use splitSmaller to respect commas and local punctuation, then further split by words
        const parts = splitSmaller([s], maxWords);
        out.push(...parts);
      }
    });

    sentences = out;
    renderSentences();
    startBtn.disabled = sentences.length === 0;

    setTopNotice("Split into sentences (long sentences split to max " + maxWords + " words)");
    saveAppState();
  };
}

if (splitSmallBtn) {
  splitSmallBtn.onclick = () => {
    const text = paragraphInput.value.trim();
    if (!text) return;

    const base = splitIntoSentences(text);
    sentences = splitSmaller(base, getChunkSize());

    renderSentences();
    startBtn.disabled = sentences.length === 0;

    setTopNotice("Split smaller used. Chunk size = " + getChunkSize());
    saveAppState();
  };
}

if (startBtn) {
  startBtn.onclick = () => {
    if (!sentences.length) {
      setTopNotice("No chunks found — press 'Split' or 'Split smaller' first.");
      return;
    }
    // persist chosen state before starting
    saveAppState();
    // Also persist this paragraph to the paragraphs store so it appears in the bar, but only if the paragraph has text
    try {
      const t = (paragraphInput && paragraphInput.value && paragraphInput.value.trim()) || '';
      if (t) { saveParagraphToStore(t, null, sentences, simpleHash(t)); }
    } catch(e) {}
    currentIndex = 0;
    try { setTopNotice('Starting training…'); } catch(e){}
    // Push a history entry so Back returns to the home UI rather than the browser home
    try { history.pushState({ page: 'training' }, 'Training', '#training'); } catch (e) { console.warn('pushState failed', e); }
    showTrainingUI();
  };
}

// EOF
