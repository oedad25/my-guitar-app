# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Acoustic guitar tuner, metronome, and chord library — a standalone web app using vanilla JavaScript, HTML5, and CSS3 with no build tools, package managers, or external dependencies. Uses the Web Audio API for all audio processing.

## Development

No build step. Open `index.html` directly in a browser to run the app. No npm, no bundler, no test framework.

Live deployment: https://oedad25.github.io/my-guitar-app/

## Architecture

Single-page app with three source files: `index.html`, `app.js`, `style.css`.

**app.js** contains these main components:

- **Tuner class** — Pitch detection via autocorrelation algorithm on microphone input. Supports standard guitar tuning (E2, A2, D3, G3, B3, E4). Shows cents deviation with ±5 cent "in tune" threshold.
- **Metronome class** — Beat scheduling with Web Audio oscillators. Uses a lookahead scheduler for precise timing. Downbeat at 1000 Hz, regular beats at 800 Hz. BPM range 40–218.
- **chordData array** — 17 beginner open chord definitions (major, minor, 7th) with fret positions, finger numbers, and startFret.
- **ChordDiagram object** — Renders horizontal SVG fretboard diagrams with strings, frets, nut, finger dots, and muted/open string markers.
- **ChordPlayer class** — Strums chords via Web Audio triangle oscillators with 40ms stagger between strings and a guitar-like envelope.
- **ui object** — DOM controller that binds events, manages tuner/metronome/chord state, and enforces mutual exclusion between tuner and metronome.

All components share a single `AudioContext` instance managed at the module level.
