# Guitar Tuner, Metronome, Chords & Song Charts

A standalone web app for acoustic guitar practice. It runs in the browser with vanilla HTML, CSS, and JavaScript. No build tools, package managers, or external runtime dependencies are required.

## Live Demo

[Try the app online](https://oedad25.github.io/my-guitar-app/)

## Features

- **Guitar Tuner**: Detects string pitch through the microphone and shows cents deviation from the nearest note.
- **Metronome**: Adjustable BPM practice click with beat visualization.
- **Chord Library**: Search built-in chords, view interactive SVG chord diagrams, and hear chord playback.
- **Generated Chords**: Search common major, minor, and 7th chords that are not stored in the library, such as `Dbm` or `Ab7`, and the app will generate a playable barre shape.
- **Song Chart Tool**: Upload or paste TXT, ChordPro, markdown, or plain chord sheets.
- **Transpose & Capo/Play**: Set the imported key, choose a target song key, and select capo/play shapes.
- **Minor Keys**: Use major or minor modes for imported and target song keys, such as `Am`, `Em`, or `F#m`.
- **Chart Playback**: Play through the detected chart chords with Web Audio.

## How To Use

Open `index.html` directly in a browser, or use the live demo above.

For local testing on another device, start a simple static server from this folder:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Then open `http://YOUR_COMPUTER_IP:8000/index.html` on a phone or tablet connected to the same network.

## Notes

- Microphone access for the tuner works best from the HTTPS live demo.
- Song chart upload is for text-based chord charts, not automatic chord detection from audio files.
- All audio synthesis and pitch detection use the Web Audio API.
