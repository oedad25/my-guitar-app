# Song Analyzer — Design Spec

## Overview

Add a "Song Analyzer" feature to the guitar app that lets users upload an audio file and automatically detect the chords used throughout the song. Results are displayed as an interactive timeline synced to audio playback, plus a chord sheet summary.

All processing runs client-side in the browser. The only new dependency is Essentia.js (WASM-based audio analysis library loaded via CDN). This is a deliberate exception to the project's "no external dependencies" principle — chord detection from audio is not feasible with vanilla JS alone. `CLAUDE.md` should be updated to document this dependency.

## Architecture

A new fourth section card alongside Tuner, Metronome, and Chords.

**Data flow:**

1. User uploads an audio file (MP3, WAV, OGG, FLAC, AAC)
2. Web Audio API decodes it into raw audio data (`decodeAudioData`)
3. Essentia.js WASM processes the audio in two phases:
   - **Phase 1 (per-frame):** `Windowing → Spectrum → SpectralPeaks → SpectralWhitening → HPCP` — produces one 12-bin HPCP vector per frame
   - **Phase 2 (batch):** All HPCP vectors are collected into an array and passed to `ChordsDetection` once — it uses an internal sliding window to smooth across frames and returns a sequence of chord labels
4. Results stored as an array of `{ chord, startTime, endTime }` objects
5. Playback via an `<audio>` element with a synced timeline and chord display
6. Two views: horizontal scrolling timeline + chord sheet summary

**New dependencies (CDN script tags, Essentia.js v0.1.3, IIFE build):**

```html
<script src="https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia-wasm.web.js"></script>
<script src="https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia.js-core.js"></script>
```

- `essentia-wasm.web.js` (~220 KB) + `essentia-wasm.web.wasm` (~2 MB, auto-loaded)
- `essentia.js-core.js` (~340 KB)
- Total: ~2.5 MB

**WASM loading strategy:** Load Essentia lazily — the `<script>` tags use `defer` or are injected dynamically when the user first opens the Song Analyzer section. Show a "Loading analyzer..." indicator while WASM compiles. If the CDN is unreachable, show "Could not load audio analyzer. Check your internet connection."

## Audio Upload & Decoding

### Upload UI

- A file input button styled to match the existing card design: "Upload Song"
- Accepts `audio/*` (MP3, WAV, OGG, FLAC, AAC)
- Maximum file size: 50 MB. Maximum duration: 10 minutes. Show a clear message if exceeded.
- Shows the file name after selection
- An "Analyze" button to kick off processing
- A loading spinner during analysis (see Performance section for details)

### Decoding Pipeline

1. Read the file as `ArrayBuffer` via `FileReader`
2. Decode with `AudioContext.decodeAudioData()` → returns `AudioBuffer`
3. Extract the audio as a mono `Float32Array` (average L+R channels if stereo)
4. Note: `decodeAudioData` returns audio at the AudioContext's sample rate (typically 44.1 or 48 kHz). Frame and hop sizes must be calculated relative to the actual sample rate, not hardcoded for 44.1 kHz.
5. Pass to Essentia.js for chord analysis

### Playback

- Use a standard `<audio>` element with `URL.createObjectURL(file)` as the source
- Call `URL.revokeObjectURL()` when a new file is loaded to avoid memory leaks
- Native playback controls (play/pause, seek, volume)
- Sync the chord timeline to `audio.currentTime` via `requestAnimationFrame`

## Chord Analysis with Essentia.js

### Processing — Phase 1: Per-Frame Feature Extraction

- Divide mono audio into overlapping frames (frame size ~8192 samples, hop size ~4096 samples — maintaining the 2:1 ratio required by `ChordsDetection`)
- At 44.1 kHz this gives ~10 HPCP vectors per second
- For each frame, run:
  1. `Windowing` (Hann window)
  2. `Spectrum` (FFT)
  3. `SpectralPeaks` (find prominent frequencies)
  4. `SpectralWhitening` (normalize spectral shape)
  5. `HPCP` (Harmonic Pitch Class Profile — a 12-bin chromagram)
- Collect all HPCP vectors into an array

### Processing — Phase 2: Batch Chord Detection

- Pass the entire array of HPCP vectors to `ChordsDetection` once
- The algorithm uses an internal sliding window to smooth across neighboring frames
- Returns a sequence of chord labels with their strengths

### Post-Processing

- Merge consecutive frames with the same chord into segments: `{ chord, startTime, endTime }`
- Filter out very short segments (< 0.3s) as noise — snap them to the surrounding chord
- Store the final chord sequence as an array

### Enharmonic Mapping

Essentia outputs sharp names exclusively (e.g. "A#", not "Bb"). The existing `chordData` array uses flats for some chords (e.g. "Bb"). Apply an enharmonic mapping for display and chord library lookups:

```js
const enharmonicMap = {
    "A#": "Bb", "C#": "Db", "D#": "Eb", "F#": "F#", "G#": "Ab"
};
```

Use flat names for display (more common in guitar contexts). Map both directions when looking up chords in `chordData`.

### Chord Vocabulary

- 24 chords: C, Db, D, Eb, E, F, F#, G, Ab, A, Bb, B (major and minor)
- Display as e.g. "G", "Em", "Bbm"
- "N" (no chord) for silence or unrecognizable sections — shown as gray gaps in the timeline, omitted from the chord sheet

### Performance

- A 3-minute song at 44.1 kHz ≈ 8 million samples → ~1,900 frames (at hop size 4096)
- Essentia WASM should handle this in a few seconds on modern hardware
- **Main thread processing with `setTimeout` chunking:** Process frames in batches (e.g. 200 frames per tick), yielding to the browser event loop between batches. This keeps the UI responsive and allows a progress bar to update with actual percentage. A spinner alone would freeze the UI during synchronous WASM computation.

## UI — Timeline View & Chord Sheet

### Timeline View (during playback)

- A horizontal bar below the audio player
- Divided into colored segments, one per detected chord
- Each segment shows the chord name (e.g. "G", "Em")
- Major chords: warm hue (e.g. amber/orange tones). Minor chords: cool hue (e.g. blue/purple tones). Ensure sufficient contrast against the dark background.
- A playhead cursor moves left-to-right synced to `audio.currentTime`
- The timeline auto-scrolls to keep the playhead visible
- The current chord is displayed prominently above the timeline in large text
- Clicking a segment seeks the audio to that point
- Chord segments should be `<button>` elements with `aria-label` (e.g. "G major, 0:12 to 0:18") for keyboard accessibility
- Current chord display should be an ARIA live region for screen reader announcements

### Chord Sheet (summary view)

- Displayed below the timeline
- Shows the chord progression as a flowing sequence of chord badges: `G | Em | C | D`
- No bar/measure grouping (beat detection is out of scope for v1)
- Each chord badge is a clickable button that seeks to its first occurrence in the timeline

### Integration with Existing Chord Library

- When a detected chord exists in the `chordData` array (after enharmonic mapping), make it tappable to show the chord diagram
- Bridges the analyzer to the existing chord diagram feature — "I don't know this chord" → tap → see the fingering

### Styling

- Same card layout, colors, and font (Inter) as existing sections
- Color coding as described above (warm for major, cool for minor)

## State Management & Integration

### Mutual Exclusion

- Song Analyzer uses its own `<audio>` element, separate from tuner mic and metronome oscillators
- Starting analysis/playback stops the tuner; starting the tuner stops song playback (mic would pick up song audio)
- Metronome can coexist with song playback (useful for practicing along)

### Audio Context

- Reuse the existing shared `AudioContext` via `getAudioContext()`
- Essentia.js uses its own internal processing — needs only the raw `Float32Array` from `decodeAudioData`

### Code Organization

- New `song-analyzer.js` file — keeps the Song Analyzer code separate from the existing `app.js` (which is already 627 lines). Loaded via an additional `<script>` tag. Contains:
  - `SongAnalyzer` class — file loading, Essentia processing, result storage
  - `SongTimeline` object — timeline rendering, playhead sync, chord sheet generation
- New UI bindings added to the existing `ui` object in `app.js`
- New HTML section in `index.html`
- New styles in `style.css`

### Error Handling

- Unsupported file format → "Could not decode this audio file"
- Analysis failure → message with option to retry
- Very short files (< 5 seconds) → skip analysis, show warning
- File too large (> 50 MB) or too long (> 10 minutes) → show limit message
- WASM load failure → "Could not load audio analyzer. Check your internet connection."
