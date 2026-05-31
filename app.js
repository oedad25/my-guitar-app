/**
 * Acoustic Guitar Tuner and Metronome Application
 * Uses Web Audio API for pitch detection and timing.
 */

// --- Audio Context Management ---
let audioContext = null;

function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

// --- Tuner Implementation ---
class Tuner {
    constructor() {
        this.isPlaying = false;
        this.source = null;
        this.analyser = null;
        this.bufferLength = 2048;
        this.dataArray = null;
        this.rafId = null;

        // Guitar Standard Tuning Frequencies (Approximate)
        // E2, A2, D3, G3, B3, E4
        this.notes = [
            { name: "E", frequency: 82.41 },
            { name: "A", frequency: 110.00 },
            { name: "D", frequency: 146.83 },
            { name: "G", frequency: 196.00 },
            { name: "B", frequency: 246.94 },
            { name: "E", frequency: 329.63 }
        ];

        // All chromatic notes for generic display
        this.noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    }

    async start() {
        const ctx = getAudioContext();
        await ctx.resume();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.source = ctx.createMediaStreamSource(stream);
            this.analyser = ctx.createAnalyser();
            this.analyser.fftSize = 2048;
            this.source.connect(this.analyser);
            
            this.dataArray = new Float32Array(this.bufferLength);
            this.isPlaying = true;
            this.update();
            
            ui.setTunerActive(true);
        } catch (err) {
            console.error("Error accessing microphone:", err);
            alert("Microphone access is required for the tuner to work.");
            this.isPlaying = false;
        }
    }

    stop() {
        this.isPlaying = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        if (this.source) {
            this.source.mediaStream.getTracks().forEach(track => track.stop());
            this.source.disconnect();
            this.source = null;
        }
        ui.setTunerActive(false);
        ui.resetTunerDisplay();
    }

    update() {
        if (!this.isPlaying) return;

        this.analyser.getFloatTimeDomainData(this.dataArray);
        const pitch = this.autoCorrelate(this.dataArray, audioContext.sampleRate);

        if (pitch !== -1) {
            this.processPitch(pitch);
        }

        this.rafId = requestAnimationFrame(() => this.update());
    }

    // Standard Auto-correlation algorithm
    autoCorrelate(buffer, sampleRate) {
        let size = buffer.length;
        let rms = 0;

        for (let i = 0; i < size; i++) {
            let val = buffer[i];
            rms += val * val;
        }
        rms = Math.sqrt(rms / size);

        // Noise gate
        if (rms < 0.01) return -1;

        let r1 = 0, r2 = size - 1, thres = 0.2;
        for (let i = 0; i < size / 2; i++) {
            if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
        }
        for (let i = 1; i < size / 2; i++) {
            if (Math.abs(buffer[size - i]) < thres) { r2 = size - i; break; }
        }

        buffer = buffer.slice(r1, r2);
        size = buffer.length;

        let c = new Array(size).fill(0);
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size - i; j++) {
                c[i] = c[i] + buffer[j] * buffer[j + i];
            }
        }

        let d = 0;
        while (c[d] > c[d + 1]) d++;
        let maxval = -1, maxpos = -1;
        for (let i = d; i < size; i++) {
            if (c[i] > maxval) {
                maxval = c[i];
                maxpos = i;
            }
        }
        let T0 = maxpos;

        let x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
        let a = (x1 + x3 - 2 * x2) / 2;
        let b = (x3 - x1) / 2;
        if (a) T0 = T0 - b / (2 * a);

        return sampleRate / T0;
    }

    processPitch(frequency) {
        const note = this.getNote(frequency);
        const cents = this.getCents(frequency, note.frequency);
        ui.updateTunerDisplay(note.name, frequency, cents);
    }

    getNote(frequency) {
        const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
        const midiNum = Math.round(noteNum) + 69;
        const frequencyStandard = 440 * Math.pow(2, (midiNum - 69) / 12);
        
        return {
            name: this.noteStrings[midiNum % 12],
            frequency: frequencyStandard,
            midi: midiNum
        };
    }

    getCents(frequency, targetFrequency) {
        return 1200 * Math.log2(frequency / targetFrequency);
    }
}

// --- Metronome Implementation ---
class Metronome {
    constructor() {
        this.isPlaying = false;
        this.bpm = 120;
        this.lookahead = 25.0; // ms
        this.scheduleAheadTime = 0.1; // s
        this.nextNoteTime = 0.0;
        this.timerID = null;
        this.beatsInBar = 4;
        this.currentBeat = 0;
    }

    start() {
        if (this.isPlaying) return;
        
        const ctx = getAudioContext();
        ctx.resume();
        
        this.isPlaying = true;
        this.currentBeat = 0;
        this.nextNoteTime = ctx.currentTime;
        this.scheduler();
    }

    stop() {
        this.isPlaying = false;
        if (this.timerID) clearTimeout(this.timerID);
        ui.setMetronomeActive(false);
    }

    scheduler() {
        if (!this.isPlaying) return;

        const ctx = getAudioContext();
        // While there are notes that will need to play before the next interval,
        // schedule them and advance the pointer.
        while (this.nextNoteTime < ctx.currentTime + this.scheduleAheadTime) {
            this.scheduleNote(this.currentBeat, this.nextNoteTime);
            this.nextNote();
        }
        
        this.timerID = setTimeout(() => this.scheduler(), this.lookahead);
    }

    nextNote() {
        const secondsPerBeat = 60.0 / this.bpm;
        this.nextNoteTime += secondsPerBeat;
        this.currentBeat = (this.currentBeat + 1) % this.beatsInBar;
    }

    scheduleNote(beatNumber, time) {
        const ctx = getAudioContext();
        const osc = ctx.createOscillator();
        const envelope = ctx.createGain();

        osc.frequency.value = (beatNumber === 0) ? 1000 : 800; // Stress the first beat
        envelope.gain.value = 1;
        
        // Envelope curve to avoid clicking
        envelope.gain.exponentialRampToValueAtTime(1, time + 0.001);
        envelope.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

        osc.connect(envelope);
        envelope.connect(ctx.destination);

        osc.start(time);
        osc.stop(time + 0.05);

        // Schedule visual update
        // We use a slight delay or simple requestAnimationFrame to sync visual, 
        // but since audio is precise, we can just trigger visual slightly ahead or draw it now.
        // For perfect sync, we'd use a separate visual timer, but for this simpler app:
        const drawTime = (time - ctx.currentTime) * 1000;
        setTimeout(() => {
            ui.highlightBeat(beatNumber);
        }, Math.max(0, drawTime));
    }

    setBpm(bpm) {
        this.bpm = bpm;
    }
}

// --- Chord Library Data ---
const chordData = [
    { name: "C",     frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0], startFret: 0 },
    { name: "D",     frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2], startFret: 0 },
    { name: "E",     frets: [0, 2, 2, 1, 0, 0],   fingers: [0, 2, 3, 1, 0, 0], startFret: 0 },
    { name: "G",     frets: [3, 2, 0, 0, 0, 3],   fingers: [2, 1, 0, 0, 0, 3], startFret: 0 },
    { name: "A",     frets: [-1, 0, 2, 2, 2, 0],  fingers: [0, 0, 1, 2, 3, 0], startFret: 0 },
    { name: "Bb",    frets: [-1, 1, 3, 3, 3, 1],  fingers: [0, 1, 2, 3, 4, 1], startFret: 0 },
    { name: "B",     frets: [-1, 2, 4, 4, 4, 2],  fingers: [0, 1, 2, 3, 4, 1], startFret: 0 },
    { name: "Am",    frets: [-1, 0, 2, 2, 1, 0],  fingers: [0, 0, 2, 3, 1, 0], startFret: 0 },
    { name: "Dm",    frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1], startFret: 0 },
    { name: "Em",    frets: [0, 2, 2, 0, 0, 0],   fingers: [0, 2, 3, 0, 0, 0], startFret: 0 },
    { name: "Bm",    frets: [-1, 2, 4, 4, 3, 2],  fingers: [0, 1, 3, 4, 2, 1], startFret: 0 },
    { name: "Gm",    frets: [-1, 1, 0, 0, 3, 3],  fingers: [0, 1, 0, 0, 3, 4], startFret: 0 },
    { name: "Fm",    frets: [-1, -1, 3, 1, 1, 1], fingers: [0, 0, 3, 1, 1, 1], startFret: 0 },
    { name: "F#m",   frets: [2, 4, 4, 2, 2, 2],   fingers: [1, 3, 4, 1, 1, 1], startFret: 2 },
    { name: "Abm",   frets: [4, 6, 6, 4, 4, 4],   fingers: [1, 3, 4, 1, 1, 1], startFret: 4 },
    { name: "Cm",    frets: [-1, 3, 5, 5, 4, 3],  fingers: [0, 1, 3, 4, 2, 1], startFret: 3 },
    { name: "A7",    frets: [-1, 0, 2, 0, 2, 0],  fingers: [0, 0, 2, 0, 3, 0], startFret: 0 },
    { name: "B7",    frets: [-1, 2, 1, 2, 0, 2],  fingers: [0, 2, 1, 3, 0, 4], startFret: 0 },
    { name: "C7",    frets: [-1, 3, 2, 3, 1, 0],  fingers: [0, 3, 2, 4, 1, 0], startFret: 0 },
    { name: "D7",    frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3], startFret: 0 },
    { name: "E7",    frets: [0, 2, 0, 1, 0, 0],   fingers: [0, 2, 0, 1, 0, 0], startFret: 0 },
    { name: "G7",    frets: [3, 2, 0, 0, 0, 1],   fingers: [3, 2, 0, 0, 0, 1], startFret: 0 },
    { name: "F",     frets: [-1, -1, 3, 2, 1, 1], fingers: [0, 0, 3, 2, 1, 1], startFret: 0 },
    { name: "Fmaj7", frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0], startFret: 0 },
    { name: "Cadd9", frets: [-1, 3, 2, 0, 3, 0],  fingers: [0, 2, 1, 0, 3, 0], startFret: 0 },
];

// Open string frequencies: E2, A2, D3, G3, B3, E4
const openStringFreqs = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63];

const chromaticNotes = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const noteIndexes = {
    "C": 0, "B#": 0,
    "C#": 1, "Db": 1,
    "D": 2,
    "D#": 3, "Eb": 3,
    "E": 4, "Fb": 4,
    "E#": 5, "F": 5,
    "F#": 6, "Gb": 6,
    "G": 7,
    "G#": 8, "Ab": 8,
    "A": 9,
    "A#": 10, "Bb": 10,
    "B": 11, "Cb": 11
};

const chordQualityPattern = /^(?:m|min|maj|M|dim|aug|sus|sus2|sus4|add\d*|\d+|#\d+|b\d+|\+|-|°|ø)*$/;

function transposeNote(note, semitones) {
    const index = noteIndexes[note];
    if (index === undefined) return note;
    return chromaticNotes[(index + semitones + 1200) % 12];
}

function formatKeyName(root, quality = "") {
    return `${root}${quality}`;
}

function parseKeyName(keyName) {
    const match = keyName.trim().match(/^([A-G](?:#|b)?)(?:\s*(m|min|minor|maj|major))?$/i);
    if (!match) return null;

    const root = `${match[1][0].toUpperCase()}${match[1].slice(1)}`;
    const quality = /^(m|min|minor)$/i.test(match[2] || "") ? "m" : "";

    if (noteIndexes[root] === undefined) return null;

    return {
        root: chromaticNotes[noteIndexes[root]],
        quality
    };
}

function parseChordCore(core) {
    const match = core.match(/^([A-G](?:#|b)?)([^/\s]*)(?:\/([A-G](?:#|b)?))?$/);
    if (!match || !chordQualityPattern.test(match[2])) return null;

    return {
        root: match[1],
        quality: match[2],
        bass: match[3] || "",
        name: `${match[1]}${match[2]}${match[3] ? `/${match[3]}` : ""}`
    };
}

function parseChordToken(token) {
    const match = token.match(/^([^A-Ga-z0-9#b]*)(.*?)([^A-Ga-z0-9#b/]*)$/);
    if (!match || !match[2]) return null;

    const chord = parseChordCore(match[2]);
    if (!chord) return null;

    return {
        prefix: match[1],
        suffix: match[3],
        chord
    };
}

function transposeChordName(chordName, semitones) {
    const chord = parseChordCore(chordName);
    if (!chord) return chordName;

    const root = transposeNote(chord.root, semitones);
    const bass = chord.bass ? `/${transposeNote(chord.bass, semitones)}` : "";
    return `${root}${chord.quality}${bass}`;
}

function normalizeChordForLookup(chordName) {
    const chord = parseChordCore(chordName);
    if (!chord) return chordName;

    const root = chromaticNotes[noteIndexes[chord.root]];
    return `${root}${chord.quality}`;
}

function findChordByName(chordName) {
    const normalized = normalizeChordForLookup(chordName);
    return chordData.find(chord => chord.name === normalized);
}

function normalizeChordSearch(query) {
    const trimmed = query.trim().replace(/\s+/g, "");
    const match = trimmed.match(/^([a-gA-G])([#b]?)(.*)$/);
    if (!match) return "";

    const root = `${match[1].toUpperCase()}${match[2]}`;
    return `${root}${match[3]}`;
}

function createGeneratedChord(chordName) {
    const parsed = parseChordCore(normalizeChordSearch(chordName));
    if (!parsed || parsed.bass) return null;

    const normalizedRoot = chromaticNotes[noteIndexes[parsed.root]];
    const quality = parsed.quality === "min" ? "m" : parsed.quality;
    const supportedQualities = ["", "m", "7"];

    if (!supportedQualities.includes(quality)) return null;

    const rootIndex = noteIndexes[normalizedRoot];
    const eShapeFret = (rootIndex - noteIndexes.E + 12) % 12;
    const aShapeFret = (rootIndex - noteIndexes.A + 12) % 12;
    const useAShape = aShapeFret > 0 && (eShapeFret === 0 || aShapeFret < eShapeFret);
    const fret = useAShape ? aShapeFret : eShapeFret || 12;

    const shapes = {
        e: {
            "": [fret, fret + 2, fret + 2, fret + 1, fret, fret],
            "m": [fret, fret + 2, fret + 2, fret, fret, fret],
            "7": [fret, fret + 2, fret, fret + 1, fret, fret]
        },
        a: {
            "": [-1, fret, fret + 2, fret + 2, fret + 2, fret],
            "m": [-1, fret, fret + 2, fret + 2, fret + 1, fret],
            "7": [-1, fret, fret + 2, fret, fret + 2, fret]
        }
    };

    const fingerings = {
        e: {
            "": [1, 3, 4, 2, 1, 1],
            "m": [1, 3, 4, 1, 1, 1],
            "7": [1, 3, 1, 2, 1, 1]
        },
        a: {
            "": [0, 1, 2, 3, 4, 1],
            "m": [0, 1, 3, 4, 2, 1],
            "7": [0, 1, 3, 1, 4, 1]
        }
    };

    return {
        name: `${normalizedRoot}${quality}`,
        frets: shapes[useAShape ? "a" : "e"][quality],
        fingers: fingerings[useAShape ? "a" : "e"][quality],
        startFret: fret,
        generated: true
    };
}

// --- Chord Diagram Renderer ---
const ChordDiagram = {
    render(chord, container) {
        const svgNS = "http://www.w3.org/2000/svg";
        const numStrings = 6;
        const numFrets = 5;
        const stringSpacing = 25;
        const fretSpacing = 30;
        const leftPad = 30;
        const topPad = 30;
        const width = leftPad + numFrets * fretSpacing + 20;
        const height = topPad + (numStrings - 1) * stringSpacing + 30;

        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("width", width);
        svg.setAttribute("height", height);
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

        // Chord name
        const title = document.createElementNS(svgNS, "text");
        title.setAttribute("x", leftPad + numFrets * fretSpacing / 2);
        title.setAttribute("y", 16);
        title.setAttribute("text-anchor", "middle");
        title.setAttribute("fill", "#ffffff");
        title.setAttribute("font-size", "16");
        title.setAttribute("font-weight", "700");
        title.setAttribute("font-family", "Inter, sans-serif");
        title.textContent = chord.name;
        svg.appendChild(title);

        // Nut (thick left line for open position)
        if (chord.startFret === 0) {
            const nut = document.createElementNS(svgNS, "line");
            nut.setAttribute("x1", leftPad);
            nut.setAttribute("y1", topPad);
            nut.setAttribute("x2", leftPad);
            nut.setAttribute("y2", topPad + (numStrings - 1) * stringSpacing);
            nut.setAttribute("stroke", "#ffffff");
            nut.setAttribute("stroke-width", "4");
            svg.appendChild(nut);
        }
        // Position label (e.g. "2fr") for barre chords above open position
        if (chord.startFret > 0) {
            const frLabel = document.createElementNS(svgNS, "text");
            frLabel.setAttribute("x", leftPad - 20);
            frLabel.setAttribute("y", topPad + 5);
            frLabel.setAttribute("text-anchor", "end");
            frLabel.setAttribute("fill", "#a1a1aa");
            frLabel.setAttribute("font-size", "11");
            frLabel.setAttribute("font-weight", "600");
            frLabel.setAttribute("font-family", "Inter, sans-serif");
            frLabel.textContent = chord.startFret + "fr";
            svg.appendChild(frLabel);
        }


        // Fret lines (vertical)
        for (let i = 0; i <= numFrets; i++) {
            const x = leftPad + i * fretSpacing;
            const line = document.createElementNS(svgNS, "line");
            line.setAttribute("x1", x);
            line.setAttribute("y1", topPad);
            line.setAttribute("x2", x);
            line.setAttribute("y2", topPad + (numStrings - 1) * stringSpacing);
            line.setAttribute("stroke", "#555");
            line.setAttribute("stroke-width", i === 0 && chord.startFret > 0 ? "2" : "1");
            svg.appendChild(line);
        }

        // String lines (horizontal, top = high E, bottom = low E)
        for (let i = 0; i < numStrings; i++) {
            const y = topPad + i * stringSpacing;
            const line = document.createElementNS(svgNS, "line");
            line.setAttribute("x1", leftPad);
            line.setAttribute("y1", y);
            line.setAttribute("x2", leftPad + numFrets * fretSpacing);
            line.setAttribute("y2", y);
            line.setAttribute("stroke", "#888");
            line.setAttribute("stroke-width", "1.5");
            svg.appendChild(line);
        }

        // Finger dots, muted/open markers
        // Visual row 0 (top) = string index 5 (high E), row 5 (bottom) = string index 0 (low E)
        for (let i = 0; i < numStrings; i++) {
            const row = numStrings - 1 - i;
            const y = topPad + row * stringSpacing;
            const fret = chord.frets[i];
            const finger = chord.fingers[i];

            if (fret === -1) {
                // Muted string: draw "x" to the left of the nut
                const text = document.createElementNS(svgNS, "text");
                text.setAttribute("x", leftPad - 16);
                text.setAttribute("y", y + 5);
                text.setAttribute("text-anchor", "middle");
                text.setAttribute("fill", "#a1a1aa");
                text.setAttribute("font-size", "14");
                text.setAttribute("font-weight", "600");
                text.setAttribute("font-family", "Inter, sans-serif");
                text.textContent = "x";
                svg.appendChild(text);
            } else if (fret === 0) {
                // Open string: draw "o" to the left of the nut
                const circle = document.createElementNS(svgNS, "circle");
                circle.setAttribute("cx", leftPad - 14);
                circle.setAttribute("cy", y);
                circle.setAttribute("r", "6");
                circle.setAttribute("fill", "none");
                circle.setAttribute("stroke", "#a1a1aa");
                circle.setAttribute("stroke-width", "1.5");
                svg.appendChild(circle);
            } else {
                // Fretted note: filled circle with finger number
                const cx = leftPad + (fret - (chord.startFret || 1) + 0.5) * fretSpacing;
                const dot = document.createElementNS(svgNS, "circle");
                dot.setAttribute("cx", cx);
                dot.setAttribute("cy", y);
                dot.setAttribute("r", "10");
                dot.setAttribute("fill", "#8257e5");
                svg.appendChild(dot);

                if (finger > 0) {
                    const label = document.createElementNS(svgNS, "text");
                    label.setAttribute("x", cx);
                    label.setAttribute("y", y + 4);
                    label.setAttribute("text-anchor", "middle");
                    label.setAttribute("fill", "#ffffff");
                    label.setAttribute("font-size", "11");
                    label.setAttribute("font-weight", "600");
                    label.setAttribute("font-family", "Inter, sans-serif");
                    label.textContent = finger;
                    svg.appendChild(label);
                }
            }
        }

        container.innerHTML = "";
        container.appendChild(svg);
    }
};

// --- Chord Player ---
class ChordPlayer {
    strum(chord) {
        const ctx = getAudioContext();
        ctx.resume();
        const now = ctx.currentTime;
        const strumDelay = 0.04; // 40ms between strings

        for (let i = 0; i < 6; i++) {
            const fret = chord.frets[i];
            if (fret === -1) continue;

            const freq = openStringFreqs[i] * Math.pow(2, fret / 12);
            const startTime = now + i * strumDelay;

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = "triangle";
            osc.frequency.value = freq;

            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.2);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(startTime);
            osc.stop(startTime + 1.3);
        }
    }

    playChordName(chordName, delay = 0) {
        const libraryChord = findChordByName(chordName);
        if (libraryChord && delay === 0) {
            this.strum(libraryChord);
            return;
        }

        if (libraryChord) {
            setTimeout(() => this.strum(libraryChord), delay * 1000);
            return;
        }

        this.playSynthChord(chordName, delay);
    }

    playSynthChord(chordName, delay = 0) {
        const chord = parseChordCore(chordName);
        if (!chord) return;

        const ctx = getAudioContext();
        ctx.resume();

        const rootIndex = noteIndexes[chord.root];
        const rootFrequency = 130.81 * Math.pow(2, rootIndex / 12); // C3 base
        const quality = chord.quality.toLowerCase();
        const third = quality.startsWith("m") || quality.includes("dim") ? 3 : 4;
        const fifth = quality.includes("dim") ? 6 : quality.includes("aug") ? 8 : 7;
        const intervals = [0, third, fifth];

        if (quality.includes("7")) intervals.push(10);

        intervals.forEach((interval, index) => {
            const startTime = ctx.currentTime + delay + index * 0.04;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = "triangle";
            osc.frequency.value = rootFrequency * Math.pow(2, interval / 12);

            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.18, startTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.1);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + 1.2);
        });
    }
}

// --- UI Controller ---
const ui = {
    // Tuner Elements
    startTunerBtn: document.getElementById('start-tuner-btn'),
    tunerStatus: document.getElementById('tuner-status'),
    noteName: document.getElementById('note-name'),
    freqDisplay: document.getElementById('frequency-display'),
    gaugeNeedle: document.getElementById('gauge-needle'),
    
    // Metronome Elements
    startMetronomeBtn: document.getElementById('start-metronome-btn'),
    bpmSlider: document.getElementById('bpm-slider'),
    bpmValue: document.getElementById('bpm-value'),
    bpmDecrease: document.getElementById('bpm-decrease'),
    bpmIncrease: document.getElementById('bpm-increase'),
    beatDots: document.querySelectorAll('.dot'),

    // Chord Elements
    chordSearchInput: document.getElementById('chord-search-input'),
    chordEmpty: document.getElementById('chord-empty'),
    chordGrid: document.getElementById('chord-grid'),
    chordDetail: document.getElementById('chord-detail'),
    chordDiagram: document.getElementById('chord-diagram'),
    playChordBtn: document.getElementById('play-chord-btn'),

    // Song Chart Elements
    songFileInput: document.getElementById('song-file-input'),
    songInput: document.getElementById('song-input'),
    sourceKeySelect: document.getElementById('source-key-select'),
    sourceKeyMode: document.getElementById('source-key-mode'),
    songKeyButtons: document.getElementById('song-key-buttons'),
    songKeyMode: document.getElementById('song-key-mode'),
    capoButtons: document.getElementById('capo-buttons'),
    playChartBtn: document.getElementById('play-chart-btn'),
    songChartMeta: document.getElementById('song-chart-meta'),
    songChartOutput: document.getElementById('song-chart-output'),

    // State
    isTunerRunning: false,
    isMetronomeRunning: false,
    selectedChord: null,
    generatedChord: null,
    generatedChordBtn: null,
    songChartText: "",
    sourceKey: "C",
    sourceKeyQuality: "",
    songKey: "C",
    songKeyQuality: "",
    selectedCapo: 0,
    sourceKeyWasEdited: false,
    chartPlaybackTimers: [],

    init() {
        // Tuner Events
        this.startTunerBtn.addEventListener('click', () => {
            if (this.isTunerRunning) {
                tuner.stop();
                this.startTunerBtn.textContent = "Start Tuner";
                this.startTunerBtn.classList.remove('active');
                this.isTunerRunning = false;
            } else {
                // Stop metronome if running to avoid audio conflict/noise
                if (this.isMetronomeRunning) this.toggleMetronome();
                
                tuner.start();
                this.startTunerBtn.textContent = "Stop Tuner";
                this.startTunerBtn.classList.add('active');
                this.isTunerRunning = true;
            }
        });

        // Metronome Events
        this.startMetronomeBtn.addEventListener('click', () => this.toggleMetronome());

        this.bpmSlider.addEventListener('input', (e) => {
            this.updateBpm(parseInt(e.target.value));
        });

        this.bpmDecrease.addEventListener('click', () => {
            const val = parseInt(this.bpmSlider.value) - 1;
            if (val >= 40) this.updateBpm(val);
        });

        this.bpmIncrease.addEventListener('click', () => {
            const val = parseInt(this.bpmSlider.value) + 1;
            if (val <= 218) this.updateBpm(val);
        });

        // Chord Library Events
        chordData.forEach((chord) => {
            const btn = document.createElement('button');
            btn.className = 'chord-btn';
            btn.textContent = chord.name;
            btn.dataset.chordName = chord.name.toLowerCase();
            btn.addEventListener('click', () => this.selectChord(chord, btn));
            this.chordGrid.appendChild(btn);
        });

        this.generatedChordBtn = document.createElement('button');
        this.generatedChordBtn.className = 'chord-btn generated-chord-btn';
        this.generatedChordBtn.hidden = true;
        this.generatedChordBtn.addEventListener('click', () => {
            if (this.generatedChord) this.selectChord(this.generatedChord, this.generatedChordBtn);
        });
        this.chordGrid.appendChild(this.generatedChordBtn);

        this.chordSearchInput.addEventListener('input', (event) => {
            this.filterChordLibrary(event.target.value);
        });

        this.playChordBtn.addEventListener('click', () => {
            if (this.selectedChord) {
                chordPlayer.strum(this.selectedChord);
            }
        });

        this.initSongChart();
    },

    filterChordLibrary(query) {
        const normalizedQuery = query.trim().toLowerCase();
        let visibleCount = 0;

        this.generatedChord = null;
        this.generatedChordBtn.hidden = true;

        this.chordGrid.querySelectorAll('.chord-btn:not(.generated-chord-btn)').forEach((button) => {
            const isMatch = button.dataset.chordName.includes(normalizedQuery);
            button.hidden = !isMatch;
            if (isMatch) visibleCount++;
        });

        if (normalizedQuery && visibleCount === 0) {
            this.generatedChord = createGeneratedChord(query);
            if (this.generatedChord) {
                this.generatedChordBtn.textContent = this.generatedChord.name;
                this.generatedChordBtn.title = `Generated barre shape for ${this.generatedChord.name}`;
                this.generatedChordBtn.hidden = false;
                visibleCount = 1;
            }
        }

        this.chordEmpty.hidden = visibleCount > 0;
    },

    initSongChart() {
        if (!this.songInput || !this.songKeyButtons || !this.capoButtons) return;

        this.renderKeyModeButtons();
        this.renderSongKeyButtons();
        this.renderCapoButtons();
        this.renderSongChart();

        this.songFileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                this.sourceKeyWasEdited = false;
                this.songInput.value = reader.result;
                this.updateSongChartText(reader.result, file.name);
            };
            reader.onerror = () => {
                this.songChartMeta.textContent = "Could not read that chart file.";
            };
            reader.readAsText(file);
        });

        this.songInput.addEventListener('input', (event) => {
            this.updateSongChartText(event.target.value);
        });

        this.sourceKeySelect.addEventListener('change', (event) => {
            this.sourceKeyWasEdited = true;
            this.sourceKey = event.target.value;
            this.renderSongChart();
        });

        this.sourceKeyMode.addEventListener('click', (event) => {
            if (!event.target.matches('button')) return;

            this.sourceKeyWasEdited = true;
            this.sourceKeyQuality = event.target.dataset.quality;
            this.renderKeyModeButtons();
            this.renderSongChart();
        });

        this.songKeyMode.addEventListener('click', (event) => {
            if (!event.target.matches('button')) return;

            this.songKeyQuality = event.target.dataset.quality;
            this.renderSongKeyButtons();
            this.renderCapoButtons();
            this.renderKeyModeButtons();
            this.renderSongChart();
        });

        this.playChartBtn.addEventListener('click', () => {
            if (this.chartPlaybackTimers.length > 0) {
                this.stopChartPlayback();
            } else {
                this.playSongChart();
            }
        });
    },

    updateSongChartText(text, fileName = "") {
        this.songChartText = text;
        this.stopChartPlayback();

        const detectedKey = this.detectSongKey(text);
        if (detectedKey && !this.sourceKeyWasEdited) {
            this.sourceKey = detectedKey.root;
            this.sourceKeyQuality = detectedKey.quality;
            this.songKey = detectedKey.root;
            this.songKeyQuality = detectedKey.quality;
            this.sourceKeySelect.value = detectedKey.root;
        }

        this.renderKeyModeButtons();
        this.renderSongKeyButtons();
        this.renderCapoButtons();
        this.renderSongChart(fileName);
    },

    detectSongKey(text) {
        const keyDirective = text.match(/^\s*(?:\{key:\s*([^}]+)\}|key\s*[:=-]\s*([A-G](?:#|b)?(?:\s*(?:m|min|minor|maj|major))?))/im);
        const directedKey = keyDirective && parseKeyName((keyDirective[1] || keyDirective[2]).trim());
        if (directedKey) {
            return directedKey;
        }

        const firstChord = this.extractSongChords(text)[0];
        if (!firstChord) return null;

        const parsed = parseChordCore(firstChord);
        if (!parsed) return null;

        return {
            root: chromaticNotes[noteIndexes[parsed.root]],
            quality: parsed.quality.toLowerCase().startsWith("m") ? "m" : ""
        };
    },

    renderKeyModeButtons() {
        this.updateKeyModeGroup(this.sourceKeyMode, this.sourceKeyQuality);
        this.updateKeyModeGroup(this.songKeyMode, this.songKeyQuality);
    },

    updateKeyModeGroup(group, activeQuality) {
        group.querySelectorAll('button').forEach((button) => {
            const isActive = button.dataset.quality === activeQuality;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', isActive ? "true" : "false");
        });
    },

    renderSongKeyButtons() {
        this.songKeyButtons.innerHTML = "";

        chromaticNotes.forEach((note) => {
            const button = document.createElement('button');
            button.type = "button";
            button.className = "key-btn";
            button.textContent = formatKeyName(note, this.songKeyQuality);
            button.setAttribute('aria-pressed', note === this.songKey ? "true" : "false");
            if (note === this.songKey) button.classList.add('active');
            button.addEventListener('click', () => {
                this.songKey = note;
                this.renderSongKeyButtons();
                this.renderCapoButtons();
                this.renderSongChart();
            });
            this.songKeyButtons.appendChild(button);
        });
    },

    renderCapoButtons() {
        this.capoButtons.innerHTML = "";

        for (let capo = 0; capo <= 11; capo++) {
            const button = document.createElement('button');
            const playKey = formatKeyName(transposeNote(this.songKey, -capo), this.songKeyQuality);
            button.type = "button";
            button.className = "capo-btn";
            button.textContent = `Capo ${capo} (${playKey})`;
            button.setAttribute('aria-pressed', capo === this.selectedCapo ? "true" : "false");
            if (capo === this.selectedCapo) button.classList.add('active');
            button.addEventListener('click', () => {
                this.selectedCapo = capo;
                this.renderCapoButtons();
                this.renderSongChart();
            });
            this.capoButtons.appendChild(button);
        }
    },

    getSongTransposeOffset() {
        return noteIndexes[this.songKey] - noteIndexes[this.sourceKey] - this.selectedCapo;
    },

    extractSongChords(text) {
        const chords = [];

        text.split(/\r?\n/).forEach((line) => {
            if (this.isSongDirectiveLine(line)) return;

            const bracketMatches = [...line.matchAll(/\[([^\]]+)\]/g)];
            bracketMatches.forEach((match) => {
                const chord = parseChordCore(match[1]);
                if (chord) chords.push(chord.name);
            });

            if (bracketMatches.length > 0) return;

            line.split(/\s+/).forEach((token) => {
                const parsed = parseChordToken(token);
                if (parsed) chords.push(parsed.chord.name);
            });
        });

        return chords;
    },

    isSongDirectiveLine(line) {
        return /^\s*\{[^}]+\}\s*$/.test(line) || /^\s*key\s*[:=-]/i.test(line);
    },

    renderSongChart(fileName = "") {
        const text = this.songChartText.trimEnd();
        this.songChartOutput.innerHTML = "";

        if (!text) {
            this.songChartMeta.textContent = "No chart loaded yet";
            this.playChartBtn.disabled = true;
            return;
        }

        const offset = this.getSongTransposeOffset();
        const chords = this.extractSongChords(text);
        const displayChords = chords.map(chord => transposeChordName(chord, offset));
        const uniqueChords = [...new Set(displayChords)];
        const songKey = formatKeyName(this.songKey, this.songKeyQuality);
        const playKey = formatKeyName(transposeNote(this.songKey, -this.selectedCapo), this.songKeyQuality);
        const source = fileName ? `${fileName} • ` : "";

        this.songChartMeta.textContent = `${source}${displayChords.length} chords • Song key ${songKey} • Capo ${this.selectedCapo}, play ${playKey}`;
        this.playChartBtn.disabled = displayChords.length === 0;

        if (uniqueChords.length > 0) {
            const summary = document.createElement('div');
            summary.className = "song-chord-summary";
            uniqueChords.forEach((chord) => summary.appendChild(this.createChartChordButton(chord)));
            this.songChartOutput.appendChild(summary);
        }

        text.split(/\r?\n/).forEach((line) => {
            const lineElement = document.createElement('div');
            lineElement.className = "chart-line";
            this.renderSongChartLine(line, lineElement, offset);
            this.songChartOutput.appendChild(lineElement);
        });
    },

    renderSongChartLine(line, container, offset) {
        if (line.length === 0) {
            container.appendChild(document.createTextNode("\u00a0"));
            return;
        }

        if (this.isSongDirectiveLine(line)) {
            const label = document.createElement('span');
            label.className = "chart-section";
            label.textContent = line.trim();
            container.appendChild(label);
            return;
        }

        const bracketPattern = /\[([^\]]+)\]/g;
        const hasBracketChords = [...line.matchAll(bracketPattern)].some(match => parseChordCore(match[1]));

        if (hasBracketChords) {
            let cursor = 0;
            line.replace(bracketPattern, (fullMatch, content, index) => {
                container.appendChild(document.createTextNode(line.slice(cursor, index)));

                const chord = parseChordCore(content);
                if (chord) {
                    container.appendChild(this.createChartChordButton(transposeChordName(chord.name, offset)));
                } else {
                    const label = document.createElement('span');
                    label.className = "chart-section";
                    label.textContent = fullMatch;
                    container.appendChild(label);
                }

                cursor = index + fullMatch.length;
                return fullMatch;
            });
            container.appendChild(document.createTextNode(line.slice(cursor)));
            return;
        }

        line.split(/(\s+)/).forEach((part) => {
            if (/^\s+$/.test(part)) {
                container.appendChild(document.createTextNode(part));
                return;
            }

            const parsed = parseChordToken(part);
            if (!parsed) {
                container.appendChild(document.createTextNode(part));
                return;
            }

            if (parsed.prefix) container.appendChild(document.createTextNode(parsed.prefix));
            container.appendChild(this.createChartChordButton(transposeChordName(parsed.chord.name, offset)));
            if (parsed.suffix) container.appendChild(document.createTextNode(parsed.suffix));
        });
    },

    createChartChordButton(chordName) {
        const button = document.createElement('button');
        button.type = "button";
        button.className = "chart-chord";
        button.textContent = chordName;
        button.title = `Play ${chordName}`;
        button.addEventListener('click', () => {
            this.showChordFromName(chordName);
            chordPlayer.playChordName(chordName);
        });
        return button;
    },

    showChordFromName(chordName) {
        const chord = findChordByName(chordName);
        if (!chord) return;

        const button = [...this.chordGrid.querySelectorAll('.chord-btn')]
            .find(btn => btn.textContent === chord.name);
        this.selectChord(chord, button);
    },

    playSongChart() {
        const chords = this.extractSongChords(this.songChartText)
            .map(chord => transposeChordName(chord, this.getSongTransposeOffset()));

        if (chords.length === 0) return;

        if (this.isTunerRunning) {
            tuner.stop();
            this.startTunerBtn.textContent = "Start Tuner";
            this.startTunerBtn.classList.remove('active');
            this.isTunerRunning = false;
        }

        this.playChartBtn.textContent = "Stop Chart";
        this.playChartBtn.classList.add('active');

        chords.forEach((chord, index) => {
            const timer = setTimeout(() => {
                chordPlayer.playChordName(chord);
            }, index * 900);
            this.chartPlaybackTimers.push(timer);
        });

        const finishTimer = setTimeout(() => this.stopChartPlayback(), chords.length * 900 + 500);
        this.chartPlaybackTimers.push(finishTimer);
    },

    stopChartPlayback() {
        this.chartPlaybackTimers.forEach(timer => clearTimeout(timer));
        this.chartPlaybackTimers = [];
        if (this.playChartBtn) {
            this.playChartBtn.textContent = "Play Chart";
            this.playChartBtn.classList.remove('active');
        }
    },

    selectChord(chord, btn) {
        this.selectedChord = chord;
        this.chordGrid.querySelectorAll('.chord-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        ChordDiagram.render(chord, this.chordDiagram);
        this.chordDetail.classList.add('visible');
    },

    toggleMetronome() {
        if (this.isMetronomeRunning) {
            metronome.stop();
            this.startMetronomeBtn.textContent = "Start";
            this.startMetronomeBtn.classList.remove('active');
            this.isMetronomeRunning = false;
        } else {
            // Stop tuner if running
            if (this.isTunerRunning) {
                tuner.stop();
                this.startTunerBtn.textContent = "Start Tuner";
                this.startTunerBtn.classList.remove('active');
                this.isTunerRunning = false;
            }

            metronome.start();
            this.startMetronomeBtn.textContent = "Stop";
            this.startMetronomeBtn.classList.add('active');
            this.isMetronomeRunning = true;
        }
    },

    updateBpm(bpm) {
        this.bpmSlider.value = bpm;
        this.bpmValue.textContent = bpm;
        metronome.setBpm(bpm);
    },

    setTunerActive(active) {
        if (active) {
            this.tunerStatus.classList.add('active');
        } else {
            this.tunerStatus.classList.remove('active');
        }
    },

    updateTunerDisplay(note, frequency, cents) {
        this.noteName.textContent = note;
        this.freqDisplay.textContent = `${frequency.toFixed(1)} Hz`;

        // Update Gauge
        // Cents range from -50 to +50 usually for display
        // Map -50..50 to 0..100% position (roughly)
        const percent = 50 + cents; // Simplified mapping
        
        // Clamp
        const clampedPercent = Math.max(0, Math.min(100, percent));
        this.gaugeNeedle.style.left = `${clampedPercent}%`;

        // Exact match visual
        if (Math.abs(cents) < 5) {
            this.noteName.classList.add('in-tune');
            this.gaugeNeedle.style.backgroundColor = '#04d361';
        } else {
            this.noteName.classList.remove('in-tune');
            this.gaugeNeedle.style.backgroundColor = '#ffffff';
        }
    },

    resetTunerDisplay() {
        this.noteName.textContent = "--";
        this.freqDisplay.textContent = "0 Hz";
        this.gaugeNeedle.style.left = "50%";
        this.noteName.classList.remove('in-tune');
    },

    setMetronomeActive(active) {
        // Visual updates if needed when started/stopped
    },

    highlightBeat(beatNumber) {
        this.beatDots.forEach((dot, index) => {
            if (index === beatNumber) {
                dot.classList.add('active');
                setTimeout(() => dot.classList.remove('active'), 150);
            }
        });
    }
};

// Initialize
const tuner = new Tuner();
const metronome = new Metronome();
const chordPlayer = new ChordPlayer();
ui.init();
