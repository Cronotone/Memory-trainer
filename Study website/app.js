/* Memory Trainer - app.js (clean rewrite)
   - No duplicate functions
   - No nested brace disasters
   - Stable home <-> training navigation without reload required
*/

(function () {
  "use strict";

  // ---------- Tiny helper ----------
  function $(id) { return document.getElementById(id); }

  // ---------- Storage keys ----------
  const LS_PREFIX = "study_";
  const LS_STATE = LS_PREFIX + "state";
  const LS_RECALL = LS_PREFIX + "recall_mode";
  const LS_PARAS = LS_PREFIX + "paragraphs";
  const LS_LAST_PAR = LS_PREFIX + "last_par";
  const LS_RESULTS_PREFIX = LS_PREFIX + "results_";

  // ---------- DB ----------
  const DB_NAME = "study_pwa";
  const DB_VERSION = 1;

  function openDB() {
    return new Promise((resolve, reject) => {
      const rq = indexedDB.open(DB_NAME, DB_VERSION);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains("attempts")) {
          const store = db.createObjectStore("attempts", { keyPath: "id", autoIncrement: true });
          store.createIndex("paragraphId", "paragraphId", { unique: false });
          store.createIndex("paragraph_chunk", ["paragraphId", "chunkIndex"], { unique: false });
        }
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error || rq);
    });
  }

  async function saveAttemptToDB({ paragraphId, chunkIndex, blob, mimeType, duration, isReference = false }) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("attempts", "readwrite");
      const store = tx.objectStore("attempts");
      const item = { paragraphId, chunkIndex, blob, mimeType, duration, ts: Date.now(), isReference };
      const req = store.add(item);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAttemptsForParagraph(paragraphId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("attempts", "readonly");
      const store = tx.objectStore("attempts");
      const idx = store.index("paragraphId");
      const req = idx.getAll(paragraphId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAttemptsForChunk(paragraphId, chunkIndex) {
    const all = await getAttemptsForParagraph(paragraphId);
    return all.filter(a => Number(a.chunkIndex) === Number(chunkIndex));
  }

  async function getReferenceAttempt(paragraphId, chunkIndex) {
    const list = await getAttemptsForChunk(paragraphId, chunkIndex);
    for (const a of list) if (a.isReference) return a;
    return null;
  }

  async function deleteAttemptById(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("attempts", "readwrite");
      const store = tx.objectStore("attempts");
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function setReferenceAttempt(paragraphId, chunkIndex, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("attempts", "readwrite");
      const store = tx.objectStore("attempts");
      const idx = store.index("paragraphId");
      const req = idx.getAll(paragraphId);

      req.onsuccess = () => {
        const all = req.result || [];
        const toUpdate = all.filter(a => Number(a.chunkIndex) === Number(chunkIndex));
        if (!toUpdate.length) return resolve();

        let done = 0;
        toUpdate.forEach(item => {
          item.isReference = (item.id === id);
          const r = store.put(item);
          r.onsuccess = () => { done++; if (done === toUpdate.length) resolve(); };
          r.onerror = () => { done++; if (done === toUpdate.length) resolve(); };
        });
      };

      req.onerror = () => reject(req.error);
    });
  }

  // ---------- Paragraph store (localStorage) ----------
  function getSavedParagraphs() {
    try {
      const raw = localStorage.getItem(LS_PARAS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function simpleHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return (h >>> 0).toString(16);
  }

  function saveParagraphToStore(text, name, sentencesArr, paragraphId) {
    try {
      const arr = getSavedParagraphs();
      const ts = Date.now();
      const pid = paragraphId || (text ? simpleHash(text.trim()) : Date.now().toString(36));

      // Update existing by paragraphId
      const existing = arr.find(p => p.paragraphId === pid);
      if (existing) {
        existing.text = text || existing.text;
        existing.sentences = Array.isArray(sentencesArr) ? sentencesArr : existing.sentences;
        existing.ts = ts;
        if (name && name.trim()) existing.name = name.trim();
        localStorage.setItem(LS_PARAS, JSON.stringify(arr));
        localStorage.setItem(LS_LAST_PAR, existing.id);
        return existing;
      }

      const id = Date.now().toString(36);
      const item = {
        id,
        paragraphId: pid,
        name: name || `Paragraph ${arr.length + 1}`,
        text: text || "",
        sentences: Array.isArray(sentencesArr) ? sentencesArr : [],
        ts
      };
      arr.push(item);
      localStorage.setItem(LS_PARAS, JSON.stringify(arr));
      localStorage.setItem(LS_LAST_PAR, id);
      return item;
    } catch (e) {
      console.warn("saveParagraphToStore failed", e);
      return null;
    }
  }

  function deleteSavedParagraph(id) {
    const arr = getSavedParagraphs().filter(p => p.id !== id);
    try { localStorage.setItem(LS_PARAS, JSON.stringify(arr)); } catch {}
  }

  function renameSavedParagraph(id, newName) {
    const arr = getSavedParagraphs();
    const it = arr.find(p => p.id === id);
    if (it) it.name = newName;
    try { localStorage.setItem(LS_PARAS, JSON.stringify(arr)); } catch {}
  }

  function formatTS(ts) {
    const d = new Date(ts);
    return d.toLocaleString();
  }

  // ---------- Marking results ----------
  function saveCheckResult(paragraphId, stepKey, pass) {
    // stepKey can be "c:3" or "p:0+1" etc.
    try {
      const key = LS_RESULTS_PREFIX + paragraphId;
      const raw = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : {};
      data[stepKey] = { ts: Date.now(), pass: !!pass };
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn("saveCheckResult failed", e);
    }
  }

  function getCheckResults(paragraphId) {
    try {
      const key = LS_RESULTS_PREFIX + paragraphId;
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  // ---------- Recall mode ----------
  function getRecallMode() {
    try { return localStorage.getItem(LS_RECALL) || "normal"; }
    catch { return "normal"; }
  }
  function setRecallMode(mode) {
    const m = (mode === "pairs") ? "pairs" : "normal";
    try { localStorage.setItem(LS_RECALL, m); } catch {}
  }

  // ---------- App state ----------
  function saveAppState({ paragraph, chunkSize, memorizeTime, sentences }) {
    try {
      const data = {
        paragraph: paragraph || "",
        chunkSize: chunkSize ?? null,
        memorizeTime: memorizeTime ?? null,
        sentences: Array.isArray(sentences) ? sentences : [],
        recallMode: getRecallMode()
      };
      localStorage.setItem(LS_STATE, JSON.stringify(data));
    } catch (e) {
      console.warn("saveAppState failed", e);
    }
  }

  function loadAppState() {
    try {
      const raw = localStorage.getItem(LS_STATE);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // ---------- UI Notice ----------
  function setTopNotice(msg) {
    let n = $("notice");
    if (!n) {
      n = document.createElement("div");
      n.id = "notice";
      n.style.cssText = "padding:10px;margin:10px 0;border-radius:10px;background:#f3f3f3;font:14px system-ui;";
      document.body.prepend(n);
    }
    n.textContent = msg;
  }

  window.addEventListener("error", (ev) => {
    try { setTopNotice("Error: " + (ev?.message || String(ev))); } catch {}
    console.error(ev);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    try { setTopNotice("Unhandled promise rejection: " + (ev?.reason?.message || String(ev?.reason || ev))); } catch {}
    console.error(ev);
  });

  // ---------- Splitting ----------
  function splitIntoSentences(text) {
    const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
    return (matches || []).map(s => s.trim()).filter(Boolean);
  }

  function splitSmaller(chunks, maxWords = 14) {
    const allowed = maxWords + 2;
    const out = [];
    for (const c of chunks) {
      const parts = c.split(/[,;:—–-]\s+/).map(p => p.trim()).filter(Boolean);
      for (const p of parts) {
        const words = p.split(/\s+/).filter(Boolean);
        if (words.length <= allowed) {
          out.push(p);
        } else {
          const temp = [];
          for (let i = 0; i < words.length; i += maxWords) temp.push(words.slice(i, i + maxWords));
          if (temp.length >= 2 && temp[temp.length - 1].length <= 2) {
            const last = temp.pop();
            temp[temp.length - 1] = temp[temp.length - 1].concat(last);
          }
          for (const t of temp) out.push(t.join(" "));
        }
      }
    }
    return out;
  }

  // ---------- Steps (normal vs pairs) ----------
  // We track steps separately from chunk index.
  // normal: step i -> [i]
  // pairs: for each pair (a,b): step sequence -> [a], [b], [a,b]
  function buildSteps(sentences, mode) {
    const steps = [];
    if (!Array.isArray(sentences)) return steps;

    if (mode !== "pairs") {
      for (let i = 0; i < sentences.length; i++) {
        steps.push({ key: `c:${i}`, indices: [i], label: `Chunk ${i + 1}` });
      }
      return steps;
    }

    for (let a = 0; a < sentences.length; a += 2) {
      const b = a + 1;
      steps.push({ key: `c:${a}`, indices: [a], label: `Chunk ${a + 1}` });
      if (b < sentences.length) {
        steps.push({ key: `c:${b}`, indices: [b], label: `Chunk ${b + 1}` });
        steps.push({ key: `p:${a}+${b}`, indices: [a, b], label: `Chunks ${a + 1} + ${b + 1}` });
      }
    }
    return steps;
  }

  function stepText(sentences, step) {
    const parts = step.indices.map(i => sentences[i]).filter(Boolean);
    return parts.join(" ");
  }

  // ---------- Recording ----------
  function pickBestMimeType() {
    // Prefer formats that tend to play cross-browser.
    // Browser may still decide; that’s okay.
    const preferred = [
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
      "audio/aac",
      "audio/webm;codecs=opus",
      "audio/webm"
    ];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return null;
    for (const t of preferred) {
      try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {}
    }
    return null;
  }

  // ---------- HOME UI ----------
  let HOME_HTML = null;
  let sentences = [];
  let currentParagraphId = null;

  function renderSentencesList() {
    const ul = $("sentenceList");
    const paragraphInput = $("paragraph");
    if (!ul) return;
    ul.innerHTML = "";

    const paragraphText = (paragraphInput?.value || "").trim();
    const pid = paragraphText ? simpleHash(paragraphText) : null;
    const results = pid ? getCheckResults(pid) : {};

    sentences.forEach((s, i) => {
      const li = document.createElement("li");

      const dot = document.createElement("span");
      dot.className = "progress-dot";
      // In normal mode we store c:i keys; in pairs mode, still store chunk keys & pair keys.
      const mark = pid ? results[`c:${i}`] : null;
      if (mark?.pass === true) dot.classList.add("pass");
      if (mark?.pass === false) dot.classList.add("fail");

      const text = document.createElement("span");
      text.textContent = `${i + 1}. ${s}`;

      li.appendChild(dot);
      li.appendChild(text);
      ul.appendChild(li);
    });
  }

  function renderSavedParagraphsBar() {
    const el = $("savedParagraphsBar");
    if (!el) return;

    const paras = getSavedParagraphs();
    if (!paras.length) {
      el.style.display = "none";
      el.innerHTML = "";
      return;
    }
    el.style.display = "flex";
    el.innerHTML = "";

    paras.forEach(p => {
      const card = document.createElement("div");
      card.className = "saved-paragraph";
      card.innerHTML = `
        <div class="name">${p.name || "Paragraph"}</div>
        <div class="meta">${formatTS(p.ts)}</div>
        <div style="font-size:13px;color:#444;margin-bottom:8px;">${(p.text || "").slice(0,120)}${(p.text && p.text.length > 120) ? "…" : ""}</div>
        <div class="actions">
          <button class="restore-par-small">⤺ Restore</button>
          <button class="rename-par-small">✎ Rename</button>
          <button class="delete-par-small">🗑 Delete</button>
        </div>
      `;
      el.appendChild(card);

      card.querySelector(".restore-par-small").onclick = () => {
        const paragraphInput = $("paragraph");
        if (paragraphInput) paragraphInput.value = p.text || "";
        sentences = Array.isArray(p.sentences) ? p.sentences : [];
        renderSentencesList();
        const startBtn = $("startBtn");
        if (startBtn) startBtn.disabled = sentences.length === 0;

        saveAppState({
          paragraph: paragraphInput ? paragraphInput.value : "",
          chunkSize: $("chunkSize")?.value ?? null,
          memorizeTime: $("memorizeTime")?.value ?? null,
          sentences
        });
        setTopNotice("Restored " + (p.name || "paragraph"));
      };

      card.querySelector(".rename-par-small").onclick = () => {
        const nn = prompt("Rename paragraph", p.name || "Paragraph");
        if (nn && nn.trim()) {
          renameSavedParagraph(p.id, nn.trim());
          renderSavedParagraphsBar();
        }
      };

      card.querySelector(".delete-par-small").onclick = () => {
        if (!confirm("Delete saved paragraph?")) return;
        deleteSavedParagraph(p.id);
        renderSavedParagraphsBar();
        setTopNotice("Deleted paragraph.");
      };
    });
  }

  function wireHomeUI() {
    const paragraphInput = $("paragraph");
    const splitBtn = $("splitBtn");
    const splitSmallBtn = $("splitSmallBtn");
    const startBtn = $("startBtn");
    const newParagraphBtn = $("newParagraphBtn");
    const restoreParagraphBtn = $("restoreParagraphBtn");
    const chunkSizeInput = $("chunkSize");
    const chunkSizeLabel = $("chunkSizeLabel");
    const memorizeInput = $("memorizeTime");
    const memorizeLabel = $("memorizeTimeLabel");
    const requestMicBtn = $("requestMicBtn");

    // sanity
    if (!paragraphInput || !splitBtn || !splitSmallBtn || !startBtn) {
      setTopNotice("Missing required elements in index.html.");
      return;
    }

    function getChunkSize() {
      const v = Number(chunkSizeInput ? chunkSizeInput.value : 14);
      return Number.isFinite(v) ? v : 14;
    }
    function getMemorizeTime() {
      const v = Number(memorizeInput ? memorizeInput.value : 10);
      return Number.isFinite(v) ? v : 10;
    }
    function updateChunkLabel() {
      if (chunkSizeLabel) chunkSizeLabel.textContent = String(getChunkSize());
    }
    function updateMemorizeLabel() {
      if (memorizeLabel) memorizeLabel.textContent = String(getMemorizeTime());
    }

    if (chunkSizeInput) {
      chunkSizeInput.oninput = () => {
        updateChunkLabel();
        saveAppState({ paragraph: paragraphInput.value, chunkSize: chunkSizeInput.value, memorizeTime: memorizeInput?.value ?? null, sentences });
      };
      updateChunkLabel();
    }
    if (memorizeInput) {
      memorizeInput.oninput = () => {
        updateMemorizeLabel();
        saveAppState({ paragraph: paragraphInput.value, chunkSize: chunkSizeInput?.value ?? null, memorizeTime: memorizeInput.value, sentences });
      };
      updateMemorizeLabel();
    }

    // recall radios
    try {
      const radios = document.querySelectorAll('input[name="recallMode"]');
      if (radios && radios.length) {
        const saved = getRecallMode();
        radios.forEach(r => {
          r.checked = (r.value === saved);
          r.onchange = () => {
            setRecallMode(r.value);
            setTopNotice("Recall mode: " + getRecallMode());
            saveAppState({ paragraph: paragraphInput.value, chunkSize: chunkSizeInput?.value ?? null, memorizeTime: memorizeInput?.value ?? null, sentences });
          };
        });
      }
    } catch {}

    // request mic
    if (requestMicBtn) {
      requestMicBtn.onclick = async () => {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true });
          setTopNotice("Microphone access granted.");
        } catch (e) {
          setTopNotice("Microphone access denied or not available.");
          console.error(e);
        }
      };
    }

    // Restore button wiring (state OR last saved paragraph)
    function wireRestoreButton() {
      if (!restoreParagraphBtn) return;

      const state = loadAppState();
      const paras = getSavedParagraphs();
      const hasState = !!(state && state.paragraph);
      const hasParas = paras.length > 0;

      if (!hasState && !hasParas) {
        restoreParagraphBtn.style.display = "none";
        return;
      }

      restoreParagraphBtn.style.display = "inline-block";
      restoreParagraphBtn.onclick = () => {
        try {
          const latestState = loadAppState();
          if (latestState && latestState.paragraph) {
            paragraphInput.value = latestState.paragraph || "";
            if (latestState.chunkSize && chunkSizeInput) { chunkSizeInput.value = latestState.chunkSize; updateChunkLabel(); }
            if (latestState.memorizeTime && memorizeInput) { memorizeInput.value = latestState.memorizeTime; updateMemorizeLabel(); }
            if (Array.isArray(latestState.sentences)) sentences = latestState.sentences;
            renderSentencesList();
            startBtn.disabled = sentences.length === 0;
            setTopNotice("Previous paragraph restored.");
            return;
          }

          // Otherwise restore last saved paragraph
          const paras2 = getSavedParagraphs();
          const lastId = localStorage.getItem(LS_LAST_PAR);
          let p = null;
          if (lastId) p = paras2.find(x => x.id === lastId);
          if (!p && paras2.length) p = paras2[paras2.length - 1];
          if (p) {
            paragraphInput.value = p.text || "";
            sentences = Array.isArray(p.sentences) ? p.sentences : [];
            renderSentencesList();
            startBtn.disabled = sentences.length === 0;
            setTopNotice("Restored " + (p.name || "paragraph"));
          }
        } catch (e) {
          console.warn(e);
        }
      };
    }

    wireRestoreButton();
    renderSavedParagraphsBar();

    // New paragraph
    if (newParagraphBtn) {
      newParagraphBtn.onclick = () => {
        const t = (paragraphInput.value || "").trim();
        if (t || (sentences && sentences.length)) {
          if (!confirm("Clear current paragraph and start a new one?")) return;
          // autosave paragraph first
          if (t) saveParagraphToStore(t, null, sentences, simpleHash(t));
        }
        paragraphInput.value = "";
        sentences = [];
        renderSentencesList();
        startBtn.disabled = true;
        try { localStorage.removeItem(LS_STATE); } catch {}
        if (restoreParagraphBtn) restoreParagraphBtn.style.display = "none";
        renderSavedParagraphsBar();
        setTopNotice("New paragraph started — ready for input.");
      };
    }

    // Split
    splitBtn.onclick = () => {
      const text = (paragraphInput.value || "").trim();
      if (!text) return;

      const base = splitIntoSentences(text);
      const maxWords = getChunkSize();
      const out = [];

      base.forEach(s => {
        const words = s.split(/\s+/).filter(Boolean);
        if (words.length <= maxWords) out.push(s);
        else out.push(...splitSmaller([s], maxWords));
      });

      sentences = out;
      renderSentencesList();
      startBtn.disabled = sentences.length === 0;

      saveAppState({ paragraph: paragraphInput.value, chunkSize: chunkSizeInput?.value ?? null, memorizeTime: memorizeInput?.value ?? null, sentences });
      setTopNotice(`Split into sentences (max ${maxWords} words)`);
      wireRestoreButton();
    };

    // Split smaller
    splitSmallBtn.onclick = () => {
      const text = (paragraphInput.value || "").trim();
      if (!text) return;

      const base = splitIntoSentences(text);
      sentences = splitSmaller(base, getChunkSize());
      renderSentencesList();
      startBtn.disabled = sentences.length === 0;

      saveAppState({ paragraph: paragraphInput.value, chunkSize: chunkSizeInput?.value ?? null, memorizeTime: memorizeInput?.value ?? null, sentences });
      setTopNotice(`Split smaller used (chunk size ${getChunkSize()})`);
      wireRestoreButton();
    };

    // Start training
    startBtn.onclick = () => {
      if (!sentences.length) {
        setTopNotice("No chunks — press Split / Split smaller first.");
        return;
      }

      const text = (paragraphInput.value || "").trim();
      if (!text) {
        setTopNotice("Paste a paragraph first.");
        return;
      }

      currentParagraphId = simpleHash(text);
      saveAppState({ paragraph: text, chunkSize: chunkSizeInput?.value ?? null, memorizeTime: memorizeInput?.value ?? null, sentences });

      // Save paragraph to store (so it appears in bar)
      saveParagraphToStore(text, null, sentences, currentParagraphId);
      renderSavedParagraphsBar();

      history.pushState({ page: "training" }, "Training", "#training");
      showTrainingUI();
    };

    setTopNotice(`Ready. Chunk size = ${getChunkSize()}.`);
  }

  // ---------- TRAINING UI ----------
  function showTrainingUI() {
    const paragraphText = (($("paragraph")?.value) || "").trim();
    const paragraphId = currentParagraphId || (paragraphText ? simpleHash(paragraphText) : null);

    if (!paragraphId) {
      setTopNotice("Training failed: no paragraphId.");
      return;
    }
    if (!Array.isArray(sentences) || !sentences.length) {
      setTopNotice("Training failed: no chunks.");
      return;
    }

    const mode = getRecallMode();
    const steps = buildSteps(sentences, mode);
    let stepIndex = 0;

    // rebuild training page
    document.body.innerHTML = `
      <h1>Memory Trainer</h1>
      <div id="notice" style="padding:10px;margin:10px 0;border-radius:10px;background:#f3f3f3;font:14px system-ui;"></div>
      <div id="status"></div>
      <div id="prompt" class="prompt"></div>
      <div id="countdown" class="countdown"></div>

      <div class="row">
        <button id="recBtn">🎤 Record</button>
        <button id="stopBtn" disabled>⏹ Stop</button>
        <button id="playBtn" disabled>▶ Play</button>
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

      <button id="savedToggle" class="saved-toggle" aria-expanded="false">▸ Saved</button>
      <aside id="savedPanel" class="saved-panel" aria-hidden="true">
        <div class="saved-header">
          <strong>Saved Attempts</strong>
          <button id="closeSaved" class="close-btn">✕</button>
        </div>
        <div id="savedList" class="saved-list"></div>
      </aside>
    `;

    setTopNotice("Training UI ready.");

    const status = $("status");
    const prompt = $("prompt");
    const countdownEl = $("countdown");
    const hint = $("hint");

    const recBtn = $("recBtn");
    const stopBtn = $("stopBtn");
    const playBtn = $("playBtn");
    const pauseBtn = $("pauseBtn");
    const saveBtn = $("saveBtn");
    const nextBtn = $("nextBtn");
    const learnAgainBtn = $("learnAgainBtn");
    const goHomeBtn = $("goHomeBtn");

    const savedToggle = $("savedToggle");
    const savedPanel = $("savedPanel");
    const savedList = $("savedList");
    const closeSaved = $("closeSaved");

    // Recording state
    let mediaRecorder = null;
    let chunks = [];
    let attemptBlob = null;
    let attemptUrl = null;
    let recordingStartTime = 0;
    let recordingTimer = null;
    let lastAttemptDuration = 0;
    let mainAudio = null;
    let mainPlaying = false;

    // Countdown state
    let timer = null;
    let remaining = 0;
    let paused = false;

    // Compare URLs
    let compareRefUrls = [];
    let compareAttUrl = null;

    function cleanupAttemptUrls() {
      try {
        if (attemptUrl) { URL.revokeObjectURL(attemptUrl); attemptUrl = null; }
        if (compareAttUrl) { URL.revokeObjectURL(compareAttUrl); compareAttUrl = null; }
        compareRefUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
        compareRefUrls = [];
        const old = document.getElementById("compareArea");
        if (old) old.remove();
        const durEl = $("recDuration"); if (durEl) durEl.textContent = "0.0s";
      } catch {}
    }

    function stopMainAudio() {
      try {
        if (mainAudio) { mainAudio.pause(); mainAudio.currentTime = 0; }
      } catch {}
      mainAudio = null;
      mainPlaying = false;
      if (playBtn) playBtn.textContent = "▶ Play";
    }

    async function startRecording() {
      // stop countdown while recording
      try {
        if (timer) { clearInterval(timer); timer = null; countdownEl.textContent = "Recording..."; pauseBtn.disabled = true; }
      } catch {}

      cleanupAttemptUrls();
      attemptBlob = null;
      chunks = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chosenType = pickBestMimeType();
      const options = chosenType ? { mimeType: chosenType } : undefined;

      mediaRecorder = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}

        const finalType = mediaRecorder?.mimeType || chosenType || "audio/webm";
        attemptBlob = new Blob(chunks, { type: finalType });
        attemptUrl = URL.createObjectURL(attemptBlob);

        lastAttemptDuration = ((Date.now() - recordingStartTime) / 1000) || 0;

        const durEl = $("recDuration");
        if (durEl) durEl.textContent = lastAttemptDuration.toFixed(1) + "s";

        const dot = $("recDot"); if (dot) dot.classList.remove("on");
        if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }

        stopMainAudio();
        playBtn.disabled = false;
        saveBtn.disabled = false;
        hint.textContent = "Recorded. You can play it back or save it.";

        setTopNotice("Recorded as: " + (attemptBlob.type || finalType));
      };

      mediaRecorder.start();
      recordingStartTime = Date.now();

      const dot = $("recDot"); if (dot) dot.classList.add("on");
      recordingTimer = setInterval(() => {
        const durEl = $("recDuration");
        if (durEl) durEl.textContent = ((Date.now() - recordingStartTime) / 1000).toFixed(1) + "s";
      }, 100);

      hint.textContent = "Recording… speak clearly, then press Stop.";
      setTopNotice("Recording… " + (chosenType || "(browser default)"));
    }

    function stopRecording() {
      try {
        if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
      } catch (e) {
        console.warn("stopRecording failed", e);
      }
    }

    function playAttempt() {
      if (!attemptUrl) return;
      try {
        if (!mainAudio) {
          mainAudio = new Audio(attemptUrl);
          mainAudio.onended = () => { mainPlaying = false; if (playBtn) playBtn.textContent = "▶ Play"; };
        }
        if (!mainPlaying) {
          mainAudio.play();
          mainPlaying = true;
          playBtn.textContent = "■ Stop";
        } else {
          stopMainAudio();
        }
      } catch (e) {
        console.error("playAttempt failed", e);
      }
    }

    async function saveAttemptForCurrentStep() {
      if (!attemptBlob) return;

      const step = steps[stepIndex];
      const mimeType = attemptBlob.type || "audio/webm";
      const duration = lastAttemptDuration || 0;

      // Reference saving rules:
      // - We ONLY store references for SINGLE chunks (step.key starts with "c:")
      // - Pair steps (p:) do NOT store a combined reference automatically.
      const isSingleChunk = step.key.startsWith("c:");
      if (!isSingleChunk) {
        // test attempt only for combined step (manual marking)
        hint.textContent = "Saved attempt (not stored). Use Mark Correct/Incorrect below.";
        showCompareUIForStep(step, null, { blob: attemptBlob, mimeType, duration });
        saveBtn.disabled = true;
        nextBtn.disabled = false;
        learnAgainBtn.disabled = false;
        return;
      }

      const chunkIndex = step.indices[0];

      const existingRef = await getReferenceAttempt(paragraphId, chunkIndex);
      const isRef = !existingRef;

      if (isRef) {
        const id = await saveAttemptToDB({
          paragraphId,
          chunkIndex,
          blob: attemptBlob,
          mimeType,
          duration,
          isReference: true
        });
        hint.textContent = `Saved reference for chunk ${chunkIndex + 1}. (${duration.toFixed(1)}s)`;
        saveBtn.disabled = true;
        nextBtn.disabled = false;

        // if all chunks have refs, next time we run we’ll be in test mode
        return id;
      } else {
        // test attempt (not stored)
        hint.textContent = `Recorded attempt for chunk ${chunkIndex + 1}. (not saved)`;
        saveBtn.disabled = true;
        nextBtn.disabled = false;

        showCompareUIForStep(step, existingRef, { blob: attemptBlob, mimeType, duration });
      }
    }

    function openSavedPanel() {
      savedPanel.classList.add("open");
      savedToggle.classList.add("open");
      savedToggle.setAttribute("aria-expanded", "true");
      savedPanel.setAttribute("aria-hidden", "false");
      refreshSavedPanel();
    }

    function closeSavedPanel() {
      savedPanel.classList.remove("open");
      savedToggle.classList.remove("open");
      savedToggle.setAttribute("aria-expanded", "false");
      savedPanel.setAttribute("aria-hidden", "true");
    }

    async function refreshSavedPanel() {
      try {
        savedList.innerHTML = "";

        // Paragraphs section
        const paras = getSavedParagraphs();
        if (paras.length) {
          const psec = document.createElement("div");
          psec.className = "saved-chunk";
          psec.innerHTML = `<div class="saved-chunk-title">Paragraphs <small style="color:#666;margin-left:8px">(${paras.length})</small></div>`;
          paras.forEach(p => {
            const row = document.createElement("div");
            row.className = "saved-item";
            row.innerHTML = `
              <div class="saved-meta"><strong>${p.name || "Paragraph"}</strong> <span style="margin-left:8px;color:#666">${formatTS(p.ts)}</span></div>
              <div class="saved-actions">
                <button class="restore-par">⤺ Restore</button>
                <button class="rename-par">✎ Rename</button>
                <button class="delete-par">🗑 Delete</button>
              </div>
            `;
            psec.appendChild(row);

            row.querySelector(".restore-par").onclick = () => {
              // Restore to home by rebuilding home UI
              history.pushState({ page: "home" }, "Home", "#home");
              showHomeUI();
              const paragraphInput = $("paragraph");
              if (paragraphInput) paragraphInput.value = p.text || "";
              sentences = Array.isArray(p.sentences) ? p.sentences : [];
              renderSentencesList();
              const startBtn = $("startBtn");
              if (startBtn) startBtn.disabled = sentences.length === 0;
              saveAppState({
                paragraph: paragraphInput ? paragraphInput.value : "",
                chunkSize: $("chunkSize")?.value ?? null,
                memorizeTime: $("memorizeTime")?.value ?? null,
                sentences
              });
              setTopNotice("Restored " + (p.name || "paragraph"));
            };

            row.querySelector(".rename-par").onclick = () => {
              const nn = prompt("Rename paragraph", p.name || "Paragraph");
              if (nn && nn.trim()) { renameSavedParagraph(p.id, nn.trim()); refreshSavedPanel(); }
            };

            row.querySelector(".delete-par").onclick = () => {
              if (!confirm("Delete saved paragraph?")) return;
              deleteSavedParagraph(p.id);
              refreshSavedPanel();
              setTopNotice("Deleted saved paragraph.");
            };
          });

          savedList.appendChild(psec);
        }

        // Attempts section (current paragraph only)
        const all = await getAttemptsForParagraph(paragraphId);
        if (!all.length) {
          if (!paras.length) savedList.innerHTML = `<div style="padding:10px;color:#666">No saved attempts for this paragraph.</div>`;
          return;
        }

        const byChunk = {};
        all.forEach(a => (byChunk[a.chunkIndex] = byChunk[a.chunkIndex] || []).push(a));

        Object.keys(byChunk).sort((a,b) => a - b).forEach(ci => {
          const group = byChunk[ci];
          const h = document.createElement("div");
          h.className = "saved-chunk";
          h.innerHTML = `<div class="saved-chunk-title">Chunk ${Number(ci)+1} <small style="color:#666;margin-left:8px">(${group.length} attempts)</small></div>`;

          group.forEach(item => {
            const row = document.createElement("div");
            row.className = "saved-item";
            row.innerHTML = `
              <div class="saved-meta">${formatTS(item.ts)} <span style="margin-left:8px;color:#333">(${(item.duration||0).toFixed(1)}s)</span>
              ${item.isReference ? '<strong style="color:green;margin-left:8px">(reference)</strong>' : ''}</div>
              <div class="saved-actions">
                <button class="play-saved">▶ Play</button>
                <button class="delete-saved">🗑 Delete</button>
                ${!item.isReference ? `<button class="make-ref">★ Make reference</button>` : ""}
              </div>
            `;
            h.appendChild(row);

            row.querySelector(".play-saved").onclick = () => {
              const b0 = item.blob;
              const blob =
                (b0 instanceof Blob)
                  ? (b0.type ? b0 : new Blob([b0], { type: item.mimeType || "audio/webm" }))
                  : new Blob([b0], { type: item.mimeType || "audio/webm" });

              const url = URL.createObjectURL(blob);
              const a = new Audio(url);
              a.play().catch(err => console.error("Play failed", err));
              a.onended = () => setTimeout(() => URL.revokeObjectURL(url), 1500);
            };

            row.querySelector(".delete-saved").onclick = async () => {
              if (!confirm("Delete this saved attempt?")) return;
              await deleteAttemptById(item.id);
              refreshSavedPanel();
              hint.textContent = "Deleted saved attempt.";
            };

            const makeBtn = row.querySelector(".make-ref");
            if (makeBtn) {
              makeBtn.onclick = async () => {
                await setReferenceAttempt(paragraphId, Number(item.chunkIndex), item.id);
                hint.textContent = "Reference updated.";
                refreshSavedPanel();
              };
            }
          });

          savedList.appendChild(h);
        });

      } catch (e) {
        console.error("refreshSavedPanel failed", e);
        savedList.innerHTML = `<div style="padding:10px;color:#666">Failed to load saved panel.</div>`;
      }
    }

    function clearCompareUI() {
      const old = document.getElementById("compareArea");
      if (old) old.remove();
      if (compareAttUrl) { try { URL.revokeObjectURL(compareAttUrl); } catch {} compareAttUrl = null; }
      compareRefUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
      compareRefUrls = [];
    }

    function showCompareUIForStep(step, refAttemptMaybe, userAttempt) {
      clearCompareUI();

      const div = document.createElement("div");
      div.id = "compareArea";
      div.style.marginTop = "12px";

      const isPairStep = step.key.startsWith("p:");
      const stepLabel = step.label;

      if (!isPairStep) {
        // single chunk compare
        div.innerHTML = `
          <div style="font-weight:bold;margin-bottom:6px">Compare ( ${stepLabel} )</div>
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <div style="flex:1">
              <div style="font-size:12px;color:#666">Reference</div>
              <div style="margin-top:6px;">
                <div style="font-size:14px;color:#111;margin-bottom:6px;">Reference recording
                  <span style="font-size:12px;color:#666;margin-left:8px">${((refAttemptMaybe?.duration)||0).toFixed(1)}s</span>
                </div>
                <audio id="refPlayer" controls style="width:100%"></audio>
              </div>
            </div>
            <div style="flex:1">
              <div style="font-size:12px;color:#666">Your attempt</div>
              <div style="margin-top:6px;">
                <div style="font-size:14px;color:#111;margin-bottom:6px;">Your recording
                  <span style="font-size:12px;color:#666;margin-left:8px">${((userAttempt?.duration)||0).toFixed(1)}s</span>
                </div>
                <audio id="attPlayer" controls style="width:100%"></audio>
              </div>
            </div>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;">
            <button id="markCorrect">Mark Correct</button>
            <button id="markIncorrect">Mark Incorrect</button>
            <button id="replaceRef">Make this the reference</button>
          </div>
        `;
      } else {
        // Pair step compare: show refs for both chunks separately, plus your attempt.
        div.innerHTML = `
          <div style="font-weight:bold;margin-bottom:6px">Compare ( ${stepLabel} )</div>
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <div style="flex:1">
              <div style="font-size:12px;color:#666">Reference chunk ${step.indices[0] + 1}</div>
              <audio id="refA" controls style="width:100%;margin-top:6px"></audio>

              <div style="font-size:12px;color:#666;margin-top:10px">Reference chunk ${step.indices[1] + 1}</div>
              <audio id="refB" controls style="width:100%;margin-top:6px"></audio>

              <div style="font-size:12px;color:#666;margin-top:10px">
                No single combined reference is recorded automatically for A+B.
              </div>
            </div>
            <div style="flex:1">
              <div style="font-size:12px;color:#666">Your attempt (A+B)</div>
              <div style="margin-top:6px;">
                <audio id="attPlayer" controls style="width:100%"></audio>
              </div>
            </div>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;">
            <button id="markCorrect">Mark Correct</button>
            <button id="markIncorrect">Mark Incorrect</button>
          </div>
        `;
      }

      hint.after(div);

      // Attach audio URLs
      try {
        // user attempt
        const attPlayer = document.getElementById("attPlayer");
        if (attPlayer && userAttempt?.blob) {
          const b0 = userAttempt.blob;
          const attBlob = (b0 instanceof Blob) ? (b0.type ? b0 : new Blob([b0], { type: userAttempt.mimeType || "audio/webm" }))
                                               : new Blob([b0], { type: userAttempt.mimeType || "audio/webm" });
          compareAttUrl = URL.createObjectURL(attBlob);
          attPlayer.src = compareAttUrl;
        }

        if (!isPairStep) {
          const refPlayer = document.getElementById("refPlayer");
          if (refPlayer && refAttemptMaybe?.blob) {
            const b0 = refAttemptMaybe.blob;
            const refBlob = (b0 instanceof Blob) ? (b0.type ? b0 : new Blob([b0], { type: refAttemptMaybe.mimeType || "audio/webm" }))
                                                 : new Blob([b0], { type: refAttemptMaybe.mimeType || "audio/webm" });
            const u = URL.createObjectURL(refBlob);
            compareRefUrls.push(u);
            refPlayer.src = u;
          }
        } else {
          // pair: load refA and refB
          const [a, b] = step.indices;
          Promise.all([getReferenceAttempt(paragraphId, a), getReferenceAttempt(paragraphId, b)]).then(([ra, rb]) => {
            const refA = document.getElementById("refA");
            const refB = document.getElementById("refB");

            if (refA && ra?.blob) {
              const bb = (ra.blob instanceof Blob) ? (ra.blob.type ? ra.blob : new Blob([ra.blob], { type: ra.mimeType || "audio/webm" }))
                                                   : new Blob([ra.blob], { type: ra.mimeType || "audio/webm" });
              const u = URL.createObjectURL(bb);
              compareRefUrls.push(u);
              refA.src = u;
            }

            if (refB && rb?.blob) {
              const bb = (rb.blob instanceof Blob) ? (rb.blob.type ? rb.blob : new Blob([rb.blob], { type: rb.mimeType || "audio/webm" }))
                                                   : new Blob([rb.blob], { type: rb.mimeType || "audio/webm" });
              const u = URL.createObjectURL(bb);
              compareRefUrls.push(u);
              refB.src = u;
            }
          }).catch(console.warn);
        }
      } catch (e) {
        console.warn("compare audio attach failed", e);
      }

      // Marking buttons
      const markCorrect = document.getElementById("markCorrect");
      const markIncorrect = document.getElementById("markIncorrect");
      const replaceRef = document.getElementById("replaceRef");

      const stepKey = step.key;

      if (markCorrect) {
        markCorrect.onclick = () => {
          saveCheckResult(paragraphId, stepKey, true);
          hint.textContent = "Marked correct — moving on.";
          setTimeout(() => { nextStep(); }, 400);
        };
      }
      if (markIncorrect) {
        markIncorrect.onclick = () => {
          saveCheckResult(paragraphId, stepKey, false);
          hint.textContent = "Marked incorrect — try again.";
          setTimeout(() => { runStep(); }, 400);
        };
      }

      if (replaceRef) {
        replaceRef.onclick = async () => {
          // Only allowed for single chunk steps
          if (!step.key.startsWith("c:")) return;
          const chunkIndex = step.indices[0];

          try {
            // Save current attempt as reference (persist) then set as only ref
            const refId = await saveAttemptToDB({
              paragraphId,
              chunkIndex,
              blob: userAttempt.blob,
              mimeType: userAttempt.mimeType || "audio/webm",
              duration: userAttempt.duration || 0,
              isReference: true
            });
            await setReferenceAttempt(paragraphId, chunkIndex, refId);
            hint.textContent = "This attempt is now the reference.";
            refreshSavedPanel();
          } catch (e) {
            console.error(e);
            hint.textContent = "Failed to set reference.";
          }
        };
      }
    }

    function isStepTestMode(step) {
      // Test mode if:
      // - single chunk has a reference
      // - pair step: BOTH chunks have references (so you can compare to both)
      if (step.key.startsWith("c:")) {
        return getReferenceAttempt(paragraphId, step.indices[0]).then(ref => !!ref);
      }
      // pair step:
      return Promise.all(step.indices.map(i => getReferenceAttempt(paragraphId, i)))
        .then(refs => refs.every(r => !!r));
    }

    function getMemorizeTimeFromState() {
      const state = loadAppState();
      const v = Number(state?.memorizeTime ?? 10);
      return Number.isFinite(v) ? v : 10;
    }

    function runStep() {
      clearCompareUI();
      cleanupAttemptUrls();
      stopMainAudio();
      attemptBlob = null;

      nextBtn.disabled = true;
      playBtn.disabled = true;
      saveBtn.disabled = true;
      stopBtn.disabled = true;
      learnAgainBtn.disabled = true;

      const step = steps[stepIndex];
      const txt = stepText(sentences, step);

      status.textContent = `${step.label} (${stepIndex + 1} / ${steps.length})`;
      prompt.innerHTML = "";
      countdownEl.textContent = "";
      hint.textContent = "";

      // show "hold to show" button only in test mode; otherwise show sentence (study)
      isStepTestMode(step).then((testMode) => {
        if (testMode) {
          prompt.innerHTML = `
            <div style="margin-bottom:6px;">
              <button id="showSentenceBtn" class="show-sentence-btn">Show sentence (hold)</button>
            </div>
            <div id="tempSentence" class="prompt-sentence" style="display:none;"></div>
          `;
          const showBtn = document.getElementById("showSentenceBtn");
          const temp = document.getElementById("tempSentence");

          const reveal = () => { temp.textContent = txt; temp.style.display = "block"; };
          const hide = () => { temp.textContent = ""; temp.style.display = "none"; };

          showBtn.addEventListener("mousedown", reveal);
          showBtn.addEventListener("mouseup", hide);
          showBtn.addEventListener("mouseleave", hide);
          showBtn.addEventListener("touchstart", (e) => { e.preventDefault(); reveal(); }, { passive: false });
          showBtn.addEventListener("touchend", hide);
          showBtn.addEventListener("touchcancel", hide);
          showBtn.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); reveal(); } });
          showBtn.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); hide(); } });

          recBtn.disabled = false;
          remaining = getMemorizeTimeFromState();
          paused = false;
          pauseBtn.disabled = false;
          pauseBtn.textContent = "⏸ Pause";
          countdownEl.textContent = `Memorise: ${remaining}s`;
          hint.textContent = 'Hold "Show sentence" to peek; record anytime.';

          if (timer) clearInterval(timer);
          timer = setInterval(() => {
            if (paused) return;
            remaining -= 1;
            countdownEl.textContent = `Memorise: ${remaining}s`;
            if (remaining <= 0) {
              clearInterval(timer);
              timer = null;
              countdownEl.textContent = "Now recite it, then save your attempt.";
              learnAgainBtn.disabled = false;
              pauseBtn.disabled = true;
            }
          }, 1000);

        } else {
          // Study mode: show full text, enable record
          prompt.textContent = txt;
          recBtn.disabled = false;
          pauseBtn.disabled = true;
          countdownEl.textContent = "";
          hint.textContent = "Study this. Record your reference when ready.";
        }
      }).catch(e => {
        console.warn(e);
        // fallback: study mode
        prompt.textContent = txt;
        recBtn.disabled = false;
      });
    }

    function nextStep() {
      stepIndex += 1;
      if (stepIndex >= steps.length) {
        status.textContent = "Done! Check Saved panel to review recordings.";
        prompt.textContent = "";
        countdownEl.textContent = "";
        hint.textContent = "";
        recBtn.disabled = true;
        stopBtn.disabled = true;
        playBtn.disabled = true;
        saveBtn.disabled = true;
        nextBtn.disabled = true;
        learnAgainBtn.disabled = true;
        pauseBtn.disabled = true;
        return;
      }
      runStep();
    }

    // Buttons
    savedToggle.onclick = () => savedPanel.classList.contains("open") ? closeSavedPanel() : openSavedPanel();
    closeSaved.onclick = closeSavedPanel();

    pauseBtn.onclick = () => {
      if (pauseBtn.disabled) return;
      paused = !paused;
      pauseBtn.textContent = paused ? "▶ Resume" : "⏸ Pause";
      countdownEl.textContent = paused ? "Paused" : `Memorise: ${remaining}s`;
    };

    learnAgainBtn.onclick = () => {
      learnAgainBtn.disabled = true;
      runStep();
    };

    goHomeBtn.onclick = () => {
      // save state before leaving
      const state = loadAppState() || {};
      saveAppState({
        paragraph: state.paragraph || paragraphText,
        chunkSize: state.chunkSize ?? null,
        memorizeTime: state.memorizeTime ?? null,
        sentences
      });
      history.pushState({ page: "home" }, "Home", "#home");
      showHomeUI();
    };

    recBtn.onclick = async () => {
      try {
        recBtn.disabled = true_toggle(false); // intentional typo guard? nope.
      } catch {}
      // Proper:
      try {
        recBtn.disabled = true;
        stopBtn.disabled = false;
        await startRecording();
      } catch (e) {
        console.error(e);
        recBtn.disabled = false;
        stopBtn.disabled = true;
        hint.textContent = "Mic blocked. Allow microphone access and try again.";
      }
    };

    stopBtn.onclick = () => {
      stopBtn.disabled = true;
      stopRecording();
      recBtn.disabled = false;
    };

    playBtn.onclick = playAttempt;

    saveBtn.onclick = async () => {
      try {
        await saveAttemptForCurrentStep();
      } catch (e) {
        console.error(e);
        hint.textContent = "Failed to save attempt.";
      }
    };

    nextBtn.onclick = nextStep;

    // Start step 0
    runStep();

    // Open saved panel if there are saved attempts
    getAttemptsForParagraph(paragraphId).then(all => {
      if (all && all.length) openSavedPanel();
    }).catch(() => {});
  }

  // ---------- Home restoration ----------
  function showHomeUI() {
    if (!HOME_HTML) return location.reload();
    document.body.innerHTML = HOME_HTML;
    wireHomeUI();
    renderSavedParagraphsBar();

    // restore state into UI (lightly)
    const state = loadAppState();
    const paragraphInput = $("paragraph");
    const chunkSizeInput = $("chunkSize");
    const memorizeInput = $("memorizeTime");
    const chunkSizeLabel = $("chunkSizeLabel");
    const memorizeLabel = $("memorizeTimeLabel");
    const startBtn = $("startBtn");

    if (state?.paragraph && paragraphInput) paragraphInput.value = state.paragraph;
    if (state?.chunkSize && chunkSizeInput) chunkSizeInput.value = state.chunkSize;
    if (state?.memorizeTime && memorizeInput) memorizeInput.value = state.memorizeTime;
    if (chunkSizeLabel && chunkSizeInput) chunkSizeLabel.textContent = String(chunkSizeInput.value);
    if (memorizeLabel && memorizeInput) memorizeLabel.textContent = String(memorizeInput.value);

    if (Array.isArray(state?.sentences)) sentences = state.sentences;
    renderSentencesList();
    if (startBtn) startBtn.disabled = !sentences.length;

    setTopNotice("Home ready.");
  }

  // ---------- Navigation handling ----------
  window.addEventListener("popstate", () => {
    // If user hits back from training, restore home
    if (location.hash !== "#training") {
      showHomeUI();
    }
  });

  // ---------- Boot ----------
  document.addEventListener("DOMContentLoaded", () => {
    // capture home HTML once (your index.html home screen)
    HOME_HTML = document.body.innerHTML;

    // wire home
    wireHomeUI();

    // restore if URL says #training
    if (location.hash === "#training") {
      const state = loadAppState();
      if (Array.isArray(state?.sentences) && state.sentences.length) {
        sentences = state.sentences;
        currentParagraphId = state.paragraph ? simpleHash(state.paragraph) : null;
        showTrainingUI();
      } else {
        setTopNotice("No chunks found — split a paragraph first.");
        history.replaceState(null, "", location.pathname + location.search);
      }
    } else {
      // restore visual state without auto-starting training
      const state = loadAppState();
      if (state?.paragraph && $("paragraph")) $("paragraph").value = state.paragraph;
      if (Array.isArray(state?.sentences)) sentences = state.sentences;
      renderSentencesList();
      renderSavedParagraphsBar();
    }
  });

})();
