/**
 * Sounds, synthesised with the Web Audio API (no audio files): rain, and
 * calls for animal births, deaths and kills. Everything is off until the
 * player switches sound on (browsers only allow audio after a click).
 */

export type SoundName = "plop" | "unplop" | "chomp" | "roar" | "sadBaa" | "highBaa" | "meow" | "jaws";
export type SoundKey = SoundName | "rain";

/** Every sound, in the order the controls list them. */
export const SOUNDS: Array<{ key: SoundKey; label: string; tip: string }> = [
  { key: "rain", label: "Rain", tip: "Rain falling from the clouds: a hiss with pattering drops." },
  { key: "plop", label: "Fish dies", tip: "A plop." },
  { key: "unplop", label: "Fish breed", tip: "A reversed plop." },
  { key: "chomp", label: "Shark catches prey", tip: "A two-bite chomp." },
  { key: "jaws", label: "Sharks breed", tip: "The two-note shark theme (at most every 6 s)." },
  { key: "sadBaa", label: "Sheep dies", tip: "A sad, falling baa (also when eaten)." },
  { key: "highBaa", label: "Sheep breed", tip: "A high baa." },
  { key: "roar", label: "Cat catches sheep", tip: "A growling roar." },
  { key: "meow", label: "Cats breed", tip: "A meow." },
];

export interface SoundSetting {
  on: boolean;
  /** 0..1 */
  volume: number;
}

/** Default volumes: the rain is the loudest sound; animal calls sit well under it. */
const DEFAULT_VOLUME: Record<SoundKey, number> = {
  rain: 1, plop: 0.4, unplop: 0.4, chomp: 0.5, jaws: 0.5, sadBaa: 0.5, highBaa: 0.45, roar: 0.38, meow: 0.5,
};

const STORAGE_KEY = "critterJitterSounds";

/** Least time (ms) between two plays of the same sound, so busy worlds don't turn into noise. */
const MIN_GAP: Record<SoundName, number> = {
  plop: 70, unplop: 90, chomp: 250, roar: 1800, sadBaa: 450, highBaa: 450, meow: 900, jaws: 6000,
};

export class Sound {
  enabled = false;
  /** Each sound's own switch and volume (remembered in this browser). */
  readonly settings: Record<SoundKey, SoundSetting>;
  private ctx: BaseAudioContext | null = null;
  private master!: GainNode;
  private rainGain!: GainNode;
  private noise!: AudioBuffer;
  private last = new Map<SoundName, number>();
  private rainLevel = 0;
  /** Audio time until which the rain is being previewed. */
  private rainPreviewUntil = 0;

  constructor() {
    this.settings = Object.fromEntries(
      SOUNDS.map(({ key }) => [key, { on: true, volume: DEFAULT_VOLUME[key] }]),
    ) as Record<SoundKey, SoundSetting>;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Record<SoundKey, SoundSetting>>;
      for (const { key } of SOUNDS) {
        const s = saved[key];
        if (s && typeof s.on === "boolean" && typeof s.volume === "number") this.settings[key] = { on: s.on, volume: s.volume };
      }
    } catch {
      // Nothing saved (or storage unavailable): defaults.
    }
  }

  /** Changes one sound's switch or volume and remembers it. */
  setSound(key: SoundKey, change: Partial<SoundSetting>): void {
    Object.assign(this.settings[key], change);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Storage unavailable: the settings just aren't remembered.
    }
  }

  /** Puts every sound back to its default switch and volume. */
  resetSounds(): void {
    for (const { key } of SOUNDS) this.setSound(key, { on: true, volume: DEFAULT_VOLUME[key] });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.init();
    if (!this.ctx) return;
    if (!(this.ctx instanceof AudioContext)) return;
    if (on) void this.ctx.resume();
    else void this.ctx.suspend();
  }

  private init(): void {
    if (!this.ctx) this.attach(new AudioContext());
  }

  /** Plays one sound now at its set volume (even if it or all sound is switched off), to try it. */
  preview(key: SoundKey): void {
    this.init();
    if (this.ctx instanceof AudioContext) void this.ctx.resume();
    const t = this.ctx!.currentTime + 0.01;
    if (key === "rain") {
      this.rainPreviewUntil = t + 2;
      const vol = this.settings.rain.volume;
      this.rainGain.gain.cancelScheduledValues(t);
      this.rainGain.gain.setTargetAtTime(0.2 * vol, t, 0.1);
      this.rainGain.gain.setTargetAtTime(0, t + 2, 0.3);
      this.rainLevel = 1;
      for (let k = 0; k < 80; k++) this.drop(t + Math.random() * 2, Math.random() * 1.6 - 0.8, vol);
      return;
    }
    this.voice(key, t, 0, this.settings[key].volume);
  }

  /** Builds the sound graph on `ctx` (a live context, or an offline one to render sounds to a file). */
  attach(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.45;
    this.master.connect(ctx.destination);
    // Two seconds of white noise, reused by the rain and the chomps.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Rain: a steady hiss of filtered noise; droplets are added in update().
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 500;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5000;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    src.connect(hp).connect(lp).connect(this.rainGain).connect(this.master);
    src.start();
  }

  /**
   * Called once a frame. `rain` is 0..1 (how hard it's raining, 0 when
   * paused); `dt` is the frame time in seconds.
   */
  update(rain: number, dt: number): void {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (t < this.rainPreviewUntil) return; // let a preview play out
    const { on, volume } = this.settings.rain;
    const level = on ? rain * volume : 0;
    this.rainLevel = rain;
    this.rainGain.gain.setTargetAtTime(0.2 * level, t, 0.3);
    // Individual drops pattering, more of them the harder it rains.
    let drops = level > 0 ? rain * 40 * dt : 0;
    while (drops > 0) {
      if (Math.random() < drops) this.drop(t + Math.random() * dt, Math.random() * 1.6 - 0.8, volume);
      drops--;
    }
  }

  /**
   * Plays a sound at map position `pan` (-1 left .. 1 right), unless it's
   * switched off or played very recently.
   */
  play(name: SoundName, pan: number): void {
    if (!this.enabled || !this.ctx) return;
    const { on, volume } = this.settings[name];
    if (!on || volume <= 0) return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? -Infinity) < MIN_GAP[name]) return;
    this.last.set(name, now);
    this.voice(name, this.ctx.currentTime + 0.01, pan, volume);
  }

  private voice(name: SoundName, t: number, pan: number, volume: number): void {
    const out = this.panner(pan, volume);
    switch (name) {
      case "plop": return this.plop(t, out, 260, 1100);
      case "unplop": return this.plop(t, out, 1100, 260);
      case "chomp": this.chomp(t, out); return this.chomp(t + 0.16, out);
      case "roar": return this.roar(t, out);
      case "sadBaa": return this.baa(t, out, 330, 210, 0.75);
      case "highBaa": return this.baa(t, out, 560, 620, 0.45);
      case "meow": return this.meow(t, out);
      case "jaws": return this.jaws(t, out);
    }
  }

  /** A volume control feeding a stereo position, into the master volume. */
  private panner(pan: number, volume: number): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    const v = ctx.createGain();
    v.gain.value = volume;
    v.connect(p);
    return v;
  }

  /** Gain node with an attack / decay envelope, connected to `out`. */
  private env(out: AudioNode, t: number, peak: number, attack: number, length: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    g.connect(out);
    return g;
  }

  private osc(type: OscillatorType, t: number, length: number, to?: AudioNode): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    if (to) o.connect(to);
    o.start(t);
    o.stop(t + length + 0.05);
    return o;
  }

  private noiseSource(t: number, length: number, to: AudioNode): void {
    const n = this.ctx!.createBufferSource();
    n.buffer = this.noise;
    n.connect(to);
    n.start(t, Math.random() * 1.5);
    n.stop(t + length + 0.05);
  }

  /** A raindrop: a tiny, bright tick. */
  private drop(t: number, pan: number, volume: number): void {
    const out = this.panner(pan, volume);
    const g = this.env(out, t, 0.05 + 0.1 * Math.random() * this.rainLevel, 0.002, 0.03);
    const o = this.osc("sine", t, 0.04, g);
    o.frequency.setValueAtTime(2500 + Math.random() * 2500, t);
  }

  /** A water plop: a short sine whose pitch sweeps (up for a plop, down for the reverse). */
  private plop(t: number, out: AudioNode, from: number, to: number): void {
    const g = this.env(out, t, 0.5, 0.005, 0.14);
    const o = this.osc("sine", t, 0.14, g);
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + 0.08);
  }

  /** One bite: a crunchy burst of low noise over a thump. */
  private chomp(t: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.1);
    lp.connect(this.env(out, t, 0.9, 0.004, 0.12));
    this.noiseSource(t, 0.12, lp);
    const o = this.osc("sine", t, 0.12, this.env(out, t, 0.6, 0.004, 0.12));
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.1);
  }

  /** A big-cat roar: a growling low sawtooth, rough and falling, through a resonant filter. */
  private roar(t: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const len = 1.1;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.linearRampToValueAtTime(900, t + 0.25);
    lp.frequency.exponentialRampToValueAtTime(250, t + len);
    lp.connect(this.env(out, t, 0.7, 0.12, len));
    const o = this.osc("sawtooth", t, len, lp);
    o.frequency.setValueAtTime(90, t);
    o.frequency.linearRampToValueAtTime(120, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(60, t + len);
    // Growl: fast wobble in pitch.
    const lfo = this.osc("square", t, len);
    lfo.frequency.value = 28;
    const depth = ctx.createGain();
    depth.gain.value = 25;
    lfo.connect(depth).connect(o.frequency);
    // Breath.
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 600;
    bp.connect(this.env(out, t, 0.35, 0.1, len));
    this.noiseSource(t, len, bp);
  }

  /** A sheep's baa: a buzzy voice with the bleat's fast wobble, through vowel formants. */
  private baa(t: number, out: AudioNode, from: number, to: number, len: number): void {
    const ctx = this.ctx!;
    const g = this.env(out, t, 1.6, 0.06, len); // loud: the formant filters take most of the energy
    // Tremolo: the bleat.
    const trem = ctx.createGain();
    trem.gain.value = 0.7;
    trem.connect(g);
    const lfo = this.osc("sine", t, len);
    lfo.frequency.value = 22;
    const depth = ctx.createGain();
    depth.gain.value = 0.3;
    lfo.connect(depth).connect(trem.gain);
    // "aa" formants.
    const mix = ctx.createGain();
    for (const [f, q] of [[800, 5], [1250, 6], [2600, 8]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f;
      bp.Q.value = q;
      mix.connect(bp).connect(trem);
    }
    const o = this.osc("sawtooth", t, len, mix);
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + len);
  }

  /** A meow: pitch and vowel rise then fall ("m-ee-ow"). */
  private meow(t: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const len = 0.6;
    const g = this.env(out, t, 1.4, 0.05, len); // loud: the narrow filter takes most of the energy
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.linearRampToValueAtTime(2200, t + 0.2);
    bp.frequency.exponentialRampToValueAtTime(800, t + len);
    bp.connect(g);
    const o = this.osc("sawtooth", t, len, bp);
    o.frequency.setValueAtTime(480, t);
    o.frequency.linearRampToValueAtTime(780, t + 0.2);
    o.frequency.exponentialRampToValueAtTime(430, t + len);
  }

  /** The famous two-note shark theme: low E, F ... E, F, getting quicker. */
  private jaws(t: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const notes: Array<[number, number, number]> = [
      [0, 82.4, 0.35], [0.45, 87.3, 0.3], [1.2, 82.4, 0.3], [1.55, 87.3, 0.25], [2.0, 82.4, 0.2], [2.25, 87.3, 0.2],
    ];
    for (const [at, f, len] of notes) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 500;
      lp.connect(this.env(out, t + at, 0.6, 0.02, len));
      const o = this.osc("sawtooth", t + at, len, lp);
      o.frequency.value = f;
    }
  }
}
