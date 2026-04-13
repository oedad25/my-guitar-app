# Song Analyzer — Design Spec

## Overview

Add a "Song Analyzer" feature to the guitar app that lets users upload an audio file and automatically detect the chords used throughout the song. Results are displayed as an interactive timeline synced to audio playback, plus a chord sheet summary.

All processing runs client-side in the browser. The only new dependency is Essentia.js (WASM-based audio analysis library loaded via CDN).

## Architecture

A new fourth section card alongside Tuner, Metronome, and Chords.

**Data flow:**

1. User uploads an audio file (MP3, WAV, OGG, FLAC, AAC)
2. Web Audio API decodes it into raw audio data (`decodeAudioData`)
3. Essentia.js WASM processes the audio in frames through:
   `Windowing → Spectrum → SpectralPeaks → SpectralWhitening → HPCP → ChordsDetection`
4. Results stored as an array of `{ chord, startTime, endTime }` objects
5. Playback via an `<audio>` element with a synced timeline and chord display
6. Two views: horizontal scrolling timeline + chord sheet summary

**New dependencies (CDN script tags):**

- `essentia-wasm.web.js` (~220 KB)
- `essentia.js-core.js` (~340 KB)
- `essentia-wasm.web.wasm` (~2 MB, loaded automatically by the WASM JS file)

## Audio Upload & Decoding

### Upload UI

- A file input button styled to match the existing card design: "Upload Song"
- Accepts `audio/*` (MP3, WAV, OGG, FLAC, AAC)
- Shows the file name after selection
- An "Analyze" button to kick off processing
- A loading spinner/progress indicator during analysis

### Decoding Pipeline

1. Read the file as `ArrayBuffer` via `FileReader`
2. Decode with `AudioContext.decodeAudioData()` → returns `AudioBuffer`
3. Extract the audio as a mono `Float32Array` (average L+R channels if stereo)
4. Pass to Essentia.js for chord analysis

### Playback

- Use a standard `<audio>` element with `URL.createObjectURL(file)` as the source
- Native playback controls (play/pause, seek, volume)
- Sync the chord timeline to `audio.currentTime` via `requestAnimationFrame`

## Chord Analysis with Essentia.js

### Processing

- Divide mono audio into overlapping frames (frame size ~8192 samples, hop size ~2048 samples at 44.1kHz — ~4 chord estimates per second)
- For each frame, run the Essentia pipeline:
  1. `Windowing` (Hann window)
  2. `Spectrum` (FFT)
  3. `SpectralPeaks` (find prominent frequencies)
  4. `SpectralWhitening` (normalize spectral shape)
  5. `HPCP` (Harmonic Pitch Class Profile — a 12-bin chromagram)
  6. `ChordsDetection` (template matching against major/minor chord profiles)
- Each frame produces: `{ chord, quality, confidence }`

### Post-Processing

- Merge consecutive frames with the same chord into segments: `{ chord, startTime, endTime }`
- Filter out very short segments (< 0.3s) as noise — snap them to the surrounding chord
- Store the final chord sequence as an array

### Chord Vocabulary

- 24 chords: C, C#, D, D#, E, F, F#, G, G#, A, A#, B (major and minor)
- Display as e.g. "G", "Em", "F#m"
- "N" (no chord) for silence or unrecognizable sections

### Performance

- A 3-minute song at 44.1kHz ≈ 8 million samples → ~3,800 frames
- Essentia WASM should handle this in a few seconds on modern hardware
- Show a progress bar during analysis

## UI — Timeline View & Chord Sheet

### Timeline View (during playback)

- A horizontal bar below the audio player
- Divided into colored segments, one per detected chord
- Each segment shows the chord name (e.g. "G", "Em")
- A playhead cursor moves left-to-right synced to `audio.currentTime`
- The timeline auto-scrolls to keep the playhead visible
- The current chord is displayed prominently above the timeline in large text
- Clicking a segment seeks the audio to that point

### Chord Sheet (summary view)

- Displayed below the timeline
- Shows the chord progression as a readable sequence: `G | Em | C | D`
- Grouped into bars/measures if possible (based on even time divisions), otherwise a flowing sequence
- Each chord is a clickable badge that seeks to its first occurrence in the timeline

### Integration with Existing Chord Library

- When a detected chord exists in the `chordData` array, make it tappable to show the chord diagram
- Bridges the analyzer to the existing chord diagram feature — "I don't know this chord" → tap → see the fingering

### Styling

- Same card layout, colors, and font (Inter) as existing sections
- Chord segments use subtle color coding (major chords in one hue, minor in another) for visual scanning

## State Management & Integration

### Mutual Exclusion

- Song Analyzer uses its own `<audio>` element, separate from tuner mic and metronome oscillators
- Starting analysis/playback stops the tuner; starting the tuner stops song playback (mic would pick up song audio)
- Metronome can coexist with song playback (useful for practicing along)

### Audio Context

- Reuse the existing shared `AudioContext` via `getAudioContext()`
- Essentia.js uses its own internal processing — needs only the raw `Float32Array` from `decodeAudioData`

### Code Organization

- New `SongAnalyzer` class in `app.js` — file loading, Essentia processing, result storage
- New `SongTimeline` object in `app.js` — timeline rendering, playhead sync, chord sheet generation
- New UI bindings added to the existing `ui` object
- New HTML section in `index.html`
- New styles in `style.css`

### Error Handling

- Unsupported file format → "Could not decode this audio file"
- Analysis failure → message with option to retry
- Very short files (< 5 seconds) → skip analysis, show warning
