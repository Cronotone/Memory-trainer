# Memory Trainer (Web App)

A browser-based memory study tool designed to help users memorise long paragraphs (e.g. exam notes, Irish essays) using **incremental recall + voice recording**.

This project runs entirely **on-device** (no backend yet). Audio, progress, and settings are stored locally using **IndexedDB** and **localStorage**.

---

## 🎯 Core Idea

The app helps users memorise a paragraph by:

1. Splitting it into manageable chunks
2. Learning chunks incrementally
3. Recording a **reference recording** (user’s own voice)
4. Testing recall against that reference
5. Gradually increasing recall difficulty

This avoids pronunciation issues in non-English languages (Irish, etc.) because the app compares **your voice to your own voice**, not speech-to-text.

---

## 🧠 How It Currently Works

### Home Screen
- Paste a paragraph
- Choose:
  - Chunk size (word-based)
  - Memorisation time
- Split text:
  - **Split into sentences**
  - **Split smaller** (breaks long sentences by commas/word count)
- Start training

Paragraphs are auto-saved locally and can be restored later.

---

### Training Flow

Each chunk goes through **two phases**:

#### 1. Study Phase (Reference creation)
- Sentence is shown
- User records themselves saying it correctly
- That recording becomes the **reference**
- Saved permanently in IndexedDB

#### 2. Test Phase (Recall)
- Sentence is hidden
- User recalls and records themselves
- App shows:
  - Reference audio
  - User attempt audio
- User manually marks:
  - ✅ Correct
  - ❌ Incorrect
  - Or replaces the reference

All attempts are grouped per paragraph + chunk.

---

## 🔁 Planned Recall Modes (in progress)

We are experimenting with **compound recall**, e.g.:

- Recall chunks 1 + 2 together
- Then 3 + 4 together
- Then all 4 together

This is optional and user-selectable (radio buttons on home screen).

---

## 💾 Storage

- **localStorage**
  - UI state
  - Settings
  - Saved paragraphs list
- **IndexedDB**
  - Audio recordings (Blob)
  - Reference recordings
  - Attempt history

No server, no uploads.

---

## 🎤 Audio Recording (Important)

### Current Strategy
- Uses `MediaRecorder` when possible
- **Safari/iPad fallback to WAV recording** using:
  - `AudioContext`
  - `ScriptProcessorNode`
  - Manual WAV encoding

### Known Problem (Important ❗)
- iPad Safari sometimes **still records WebM/Opus**
- Safari cannot reliably play WebM/Opus
- This causes:
  - “Error” in compare UI
  - Reference audio not playing
  - Saved reference marked but unusable

We are actively fixing:
- Safari detection
- Forcing WAV recording reliably
- Avoiding cached/duplicate `startRecording()` definitions

---

## 🐛 Known Issues

1. **Safari / iPad audio**
   - Sometimes records as `audio/webm; codecs=opus`
   - Must be WAV to work consistently
   - Suspected causes:
     - UA detection edge cases
     - Cached JS
     - Duplicate `startRecording()` definitions

2. **Large single JS file**
   - `app.js` is very long
   - Likely contains duplicate logic from iteration
   - Needs refactor into sections or modules

3. **Caching confusion**
   - Safari aggressively caches JS
   - We use `?v=XXX` on script tag but still hit issues

---

## 🛠 Tech Stack

- Vanilla HTML / CSS / JS
- IndexedDB
- MediaRecorder API
- Web Audio API (WAV fallback)
- No frameworks
- No backend

---

## 🚀 How to Run

```bash
# from project directory
python -m http.server 8000
