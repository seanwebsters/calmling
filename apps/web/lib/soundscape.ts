'use client';

/**
 * Gentle procedural ambience with the Web Audio API. No audio files.
 * A soft breeze always; rain when it rains; crickets at night; a rare, quiet
 * bird call by day. Everything fades in and out slowly — never sudden.
 */
export class Soundscape {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private breeze!: GainNode;
  private rain!: GainNode;
  private crickets!: GainNode;
  private timers: number[] = [];
  private state = { daylight: 1, weather: 'clear', night: false };

  async start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.master.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 4);

    const noise = this.noiseBuffer(ctx);
    // breeze: brown-ish noise through a slowly wandering low-pass
    this.breeze = this.noiseLayer(noise, 'lowpass', 420, 0.18);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.05;
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect((this.breeze as any)._filter.frequency);
    lfo.start();
    // rain: brighter noise, band-passed
    this.rain = this.noiseLayer(noise, 'bandpass', 2400, 0);
    // crickets: soft pulsed tone
    this.crickets = ctx.createGain();
    this.crickets.gain.value = 0;
    this.crickets.connect(this.master);
    const tone = ctx.createOscillator();
    tone.frequency.value = 4300;
    const pulse = ctx.createGain();
    pulse.gain.value = 0;
    const pulseLfo = ctx.createOscillator();
    pulseLfo.type = 'square';
    pulseLfo.frequency.value = 3.2;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.012;
    pulseLfo.connect(pulseDepth);
    pulseDepth.connect(pulse.gain);
    tone.connect(pulse);
    pulse.connect(this.crickets);
    tone.start();
    pulseLfo.start();
    this.timers.push(window.setInterval(() => this.maybeBird(), 9000));
    this.apply();
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04;
      d[i] = last * 3.2;
    }
    return buf;
  }

  private noiseLayer(buf: AudioBuffer, type: BiquadFilterType, freq: number, gain: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
    (g as any)._filter = f;
    return g;
  }

  private maybeBird() {
    const ctx = this.ctx;
    if (!ctx || this.state.night || this.state.weather === 'rain' || Math.random() > 0.35) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    const base = 2200 + Math.random() * 900;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(base * 0.95, t + 0.28);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.025, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + 0.32);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
  }

  update(daylight: number, weather: string) {
    const night = daylight < 0.2;
    if (Math.abs(daylight - this.state.daylight) < 0.05 && weather === this.state.weather && night === this.state.night) return;
    this.state = { daylight, weather, night };
    this.apply();
  }

  private apply() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const ramp = (g: GainNode, v: number) => {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(v, t + 6);
    };
    ramp(this.breeze, this.state.weather === 'breezy' ? 0.3 : 0.16);
    ramp(this.rain, this.state.weather === 'rain' ? 0.22 : 0);
    ramp(this.crickets, this.state.night && this.state.weather !== 'rain' ? 1 : 0);
  }

  async stop() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
    await new Promise((r) => setTimeout(r, 1600));
    await ctx.close();
    this.ctx = null;
  }
}
