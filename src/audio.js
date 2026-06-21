// Procedural combat SFX via the Web Audio API — no asset files needed.
// Sounds are synthesised on the fly: a bright metallic clang for sword-on-sword,
// a duller thunk for a shield block, and a low thud for a blade biting flesh.
// The AudioContext must be created/resumed from a user gesture (see resume()).

class CombatAudio {
  constructor() {
    this.ctx    = null;
    this.master = null;
    this._noise = null;
    this._reverb = null;
  }

  // Lazily create the context and resume it. Call from a click/keydown handler.
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;                       // no Web Audio (or headless) → silent
      this.ctx    = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      this._noise  = this._makeNoiseBuffer();
      this._reverb = this._buildReverb();    // shared hall for epic clash tails
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // A convolution reverb fed from a wet send, for a big spacious tail.
  _buildReverb() {
    const conv = this.ctx.createConvolver();
    conv.buffer = this._makeImpulse(1.8, 2.6);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.9;
    conv.connect(wet).connect(this.master);
    return conv;
  }

  // Stereo decaying-noise impulse response for the reverb.
  _makeImpulse(dur, decay) {
    const rate = this.ctx.sampleRate;
    const len  = Math.floor(rate * dur);
    const buf  = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // One second of white noise, reused for every impact's "chink"/"slap".
  _makeNoiseBuffer() {
    const len = Math.floor(this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // A pitched blip with a fast attack + exponential decay envelope.
  _tone(freq, { type = 'sine', dur = 0.15, gain = 0.3, freqEnd, out } = {}) {
    const t0  = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type  = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(out || this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // A short filtered burst of noise.
  _noiseBurst({ dur = 0.1, gain = 0.25, type = 'bandpass', freq = 3000, q = 0.8, out } = {}) {
    const t0  = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(out || this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // A bus that fans out to the dry master and (optionally) the reverb send,
  // so a single sound lands both close and in a big hall.
  _bus(reverbSend = 0.5) {
    const bus = this.ctx.createGain();
    bus.connect(this.master);
    if (this._reverb && reverbSend > 0) {
      const send = this.ctx.createGain();
      send.gain.value = reverbSend;
      bus.connect(send).connect(this._reverb);
    }
    return bus;
  }

  // Medieval-knight clash: heavy steel broadswords meeting — a weighty thunk,
  // a dense, harsh, low-mid metallic CLANG of inharmonic partials, and gritty
  // noise for the bite. Lower and rougher than a katana's bright ring, with a
  // stone-hall tail.
  clash(intensity = 1) {
    if (!this.ctx) return;
    const v   = Math.max(0.35, Math.min(1, intensity));
    const bus = this._bus(0.55);

    // Heavy impact thunk — the heft of a broadsword and armour behind it.
    this._tone(140, { type: 'triangle', dur: 0.35, gain: 0.45 * v, freqEnd: 78, out: bus });
    this._tone(90,  { type: 'sine',     dur: 0.22, gain: 0.30 * v, freqEnd: 55, out: bus });

    // Dense, harsh metallic CLANG: a low-mid inharmonic stack. Square partials
    // up top give the rough, buzzy edge of thick steel; moderate decay so it
    // rings without singing.
    const base = 520 + Math.random() * 180;
    [1, 1.43, 1.97, 2.62, 3.36].forEach((m, i) => {
      const dur = 0.55 - i * 0.07;
      const g   = (0.13 * v) / (i * 0.7 + 1);
      this._tone(base * m, { type: i < 2 ? 'square' : 'triangle', dur, gain: g, out: bus });
    });

    // Gritty broadband bite — the harsh scrape of edge on edge.
    this._noiseBurst({ dur: 0.13, gain: 0.28 * v, type: 'bandpass', freq: 2400, q: 0.5, out: bus });
    this._noiseBurst({ dur: 0.09, gain: 0.18 * v, type: 'lowpass',  freq: 1300, q: 0.6, out: bus });
  }

  // Duller, woodier thunk — blade caught on a shield.
  block(intensity = 1) {
    if (!this.ctx) return;
    const v = Math.max(0.25, Math.min(1, intensity));
    this._tone(330, { type: 'triangle', dur: 0.17, gain: 0.32 * v, freqEnd: 150 });
    this._tone(180, { type: 'sine',     dur: 0.12, gain: 0.20 * v });
    this._noiseBurst({ dur: 0.11, gain: 0.18 * v, type: 'lowpass', freq: 1300, q: 0.5 });
  }

  // Low, fleshy thud — blade biting a body part.
  hit(intensity = 1) {
    if (!this.ctx) return;
    const v = Math.max(0.25, Math.min(1, intensity));
    this._tone(190, { type: 'sine', dur: 0.19, gain: 0.42 * v, freqEnd: 52 });
    this._noiseBurst({ dur: 0.08, gain: 0.16 * v, type: 'lowpass', freq: 900, q: 0.4 });
  }
}

export const audio = new CombatAudio();
