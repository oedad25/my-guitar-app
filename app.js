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

    // State 
    isTunerRunning: false,
    isMetronomeRunning: false,

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
ui.init();
