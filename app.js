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
    { name: "Am",    frets: [-1, 0, 2, 2, 1, 0],  fingers: [0, 0, 2, 3, 1, 0], startFret: 0 },
    { name: "Dm",    frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1], startFret: 0 },
    { name: "Em",    frets: [0, 2, 2, 0, 0, 0],   fingers: [0, 2, 3, 0, 0, 0], startFret: 0 },
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
                const cx = leftPad + (fret - 0.5) * fretSpacing;
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
    chordGrid: document.getElementById('chord-grid'),
    chordDetail: document.getElementById('chord-detail'),
    chordDiagram: document.getElementById('chord-diagram'),
    playChordBtn: document.getElementById('play-chord-btn'),

    // State
    isTunerRunning: false,
    isMetronomeRunning: false,
    selectedChord: null,

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
            btn.addEventListener('click', () => this.selectChord(chord, btn));
            this.chordGrid.appendChild(btn);
        });

        this.playChordBtn.addEventListener('click', () => {
            if (this.selectedChord) {
                chordPlayer.strum(this.selectedChord);
            }
        });
    },

    selectChord(chord, btn) {
        this.selectedChord = chord;
        this.chordGrid.querySelectorAll('.chord-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
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
