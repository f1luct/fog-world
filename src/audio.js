// 声音。没有一个采样文件——雨、玻璃、嗡鸣全部由 WebAudio 现场合成。
// 最重要的一件事:车里和车外是同一场雨，只隔一个低通滤波器。
// 融穿玻璃的瞬间,滤波器打开,雨声涌进来——耳朵先于眼睛过去。

export function createAudio(cfg) {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  const state = {
    muted: false,
    unlocked: false,
    inside: true,
    nextPlinkAt: 0,
    nextSqueakAt: 0,
  };

  // 持续声源的句柄
  const live = {
    rainFilter: null,
    rainGain: null,
    rainBodyGain: null,
    plinkGain: null,
    breathGain: null,
    palmOsc: null,
    palmGain: null,
    lampGain: null,
    vendingGain: null,
    purrGain: null,
    windGain: null,
  };

  function makeNoiseBuffer() {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function loopNoise() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.start();
    return src;
  }

  async function unlock() {
    if (state.unlocked) {
      if (ctx.state === "suspended") await ctx.resume();
      return;
    }
    ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    noiseBuffer = makeNoiseBuffer();

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = state.muted ? 0 : cfg.masterGain;
    master.connect(compressor);
    compressor.connect(ctx.destination);

    // —— 雨声床:噪声 → 低通(车内闷/车外亮) ——
    const rainSrc = loopNoise();
    live.rainFilter = ctx.createBiquadFilter();
    live.rainFilter.type = "lowpass";
    live.rainFilter.frequency.value = cfg.rainInsideFreq;
    live.rainFilter.Q.value = 0.4;
    live.rainGain = ctx.createGain();
    live.rainGain.gain.value = cfg.rainInsideGain;
    rainSrc.connect(live.rainFilter);
    live.rainFilter.connect(live.rainGain);
    live.rainGain.connect(master);

    // 雨的身体:低频的一层闷响,车外更明显。
    const bodySrc = loopNoise();
    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = "lowpass";
    bodyFilter.frequency.value = 160;
    live.rainBodyGain = ctx.createGain();
    live.rainBodyGain.gain.value = 0.10;
    bodySrc.connect(bodyFilter);
    bodyFilter.connect(live.rainBodyGain);
    live.rainBodyGain.connect(master);

    // —— 呵气的气声 ——
    const breathSrc = loopNoise();
    const breathFilter = ctx.createBiquadFilter();
    breathFilter.type = "bandpass";
    breathFilter.frequency.value = 800;
    breathFilter.Q.value = 0.8;
    live.breathGain = ctx.createGain();
    live.breathGain.gain.value = 0;
    breathSrc.connect(breathFilter);
    breathFilter.connect(live.breathGain);
    live.breathGain.connect(master);

    // —— 手掌贴玻璃:体温的低鸣 ——
    live.palmOsc = ctx.createOscillator();
    live.palmOsc.type = "sine";
    live.palmOsc.frequency.value = 68;
    live.palmGain = ctx.createGain();
    live.palmGain.gain.value = 0;
    live.palmOsc.connect(live.palmGain);
    live.palmGain.connect(master);
    live.palmOsc.start();

    // —— 路灯的电流嗡 ——
    const lampOsc1 = ctx.createOscillator();
    lampOsc1.type = "triangle";
    lampOsc1.frequency.value = 100;
    const lampOsc2 = ctx.createOscillator();
    lampOsc2.type = "sine";
    lampOsc2.frequency.value = 200;
    live.lampGain = ctx.createGain();
    live.lampGain.gain.value = 0;
    lampOsc1.connect(live.lampGain);
    lampOsc2.connect(live.lampGain);
    live.lampGain.connect(master);
    lampOsc1.start();
    lampOsc2.start();

    // —— 贩卖机:压缩机 + 灯管的和弦 ——
    live.vendingGain = ctx.createGain();
    live.vendingGain.gain.value = 0;
    for (const freq of [110, 220, 331]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = freq < 200 ? 0.6 : 0.25;
      osc.connect(g);
      g.connect(live.vendingGain);
      osc.start();
    }
    live.vendingGain.connect(master);

    // —— 猫的呼噜:25Hz 颤的低音 ——
    const purrOsc = ctx.createOscillator();
    purrOsc.type = "sine";
    purrOsc.frequency.value = 52;
    const purrLfo = ctx.createOscillator();
    purrLfo.frequency.value = 24;
    const purrDepth = ctx.createGain();
    purrDepth.gain.value = 0.5;
    const purrAm = ctx.createGain();
    purrAm.gain.value = 0.5;
    purrLfo.connect(purrDepth);
    purrDepth.connect(purrAm.gain);
    purrOsc.connect(purrAm);
    live.purrGain = ctx.createGain();
    live.purrGain.gain.value = 0;
    purrAm.connect(live.purrGain);
    live.purrGain.connect(master);
    purrOsc.start();
    purrLfo.start();

    // —— 夜风(只在外面) ——
    const windSrc = loopNoise();
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 240;
    live.windGain = ctx.createGain();
    live.windGain.gain.value = 0;
    windSrc.connect(windFilter);
    windFilter.connect(live.windGain);
    live.windGain.connect(master);

    state.unlocked = true;
  }

  function setMuted(muted) {
    state.muted = muted;
    if (master) {
      master.gain.setTargetAtTime(muted ? 0 : cfg.masterGain, ctx.currentTime, 0.1);
    }
  }

  // 车内 ⇄ 车外:同一场雨,开合一个滤波器。
  function setInside(inside, fadeSeconds = 2) {
    state.inside = inside;
    if (!ctx) return;
    const now = ctx.currentTime;
    const freq = inside ? cfg.rainInsideFreq : cfg.rainOutsideFreq;
    const gain = inside ? cfg.rainInsideGain : cfg.rainOutsideGain;
    live.rainFilter.frequency.cancelScheduledValues(now);
    live.rainFilter.frequency.setValueAtTime(live.rainFilter.frequency.value, now);
    live.rainFilter.frequency.exponentialRampToValueAtTime(freq, now + fadeSeconds);
    live.rainGain.gain.setTargetAtTime(gain, now, fadeSeconds / 3);
    live.rainBodyGain.gain.setTargetAtTime(inside ? 0.10 : 0.16, now, fadeSeconds / 3);
    live.windGain.gain.setTargetAtTime(inside ? 0 : 0.05, now, fadeSeconds / 2);
  }

  // 雨点敲玻璃,只在车里听得见。
  function plink(time) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 1700 + Math.random() * 2200;
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const peak = 0.012 + Math.random() * 0.03;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0005, time + 0.07 + Math.random() * 0.06);
    osc.connect(gain);
    gain.connect(pan);
    pan.connect(master);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  // 指尖擦过蒙雾的玻璃。
  function wipeSqueak(speed, x = 0.5) {
    if (!state.unlocked || state.muted) return;
    const now = ctx.currentTime;
    if (now < state.nextSqueakAt) return;
    state.nextSqueakAt = now + 0.05;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 700 + Math.min(speed * 26000, 2600);
    filter.Q.value = 5;
    const gain = ctx.createGain();
    const peak = Math.min(0.02 + speed * 2.4, 0.12);
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (x - 0.5) * 1.4;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(master);
    src.start(now);
    src.stop(now + 0.12);
  }

  // 融穿:深处一声闷响,然后整场雨从滤波器里涌出来。
  function meltThrough(duration) {
    if (!state.unlocked) return;
    const now = ctx.currentTime;
    // 闷响
    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(90, now);
    thump.frequency.exponentialRampToValueAtTime(38, now + 0.7);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.4, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    thump.connect(thumpGain);
    thumpGain.connect(master);
    thump.start(now);
    thump.stop(now + 1.2);
    // 水汽卷走的嘶声
    const whoosh = ctx.createBufferSource();
    whoosh.buffer = noiseBuffer;
    whoosh.loop = true;
    const whooshFilter = ctx.createBiquadFilter();
    whooshFilter.type = "bandpass";
    whooshFilter.frequency.setValueAtTime(300, now);
    whooshFilter.frequency.exponentialRampToValueAtTime(2400, now + duration * 0.5);
    whooshFilter.Q.value = 0.7;
    const whooshGain = ctx.createGain();
    whooshGain.gain.setValueAtTime(0.0001, now);
    whooshGain.gain.exponentialRampToValueAtTime(0.22, now + duration * 0.35);
    whooshGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    whoosh.connect(whooshFilter);
    whooshFilter.connect(whooshGain);
    whooshGain.connect(master);
    whoosh.start(now);
    whoosh.stop(now + duration + 0.1);
    // 雨声打开
    setInside(false, duration * 0.7);
  }

  // 回程:霜从四边合拢,雨被重新关进玻璃外。
  function frostBack(duration) {
    if (!state.unlocked) return;
    const now = ctx.currentTime;
    const shimmer = ctx.createBufferSource();
    shimmer.buffer = noiseBuffer;
    shimmer.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(6000, now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + duration * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    shimmer.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    shimmer.start(now);
    shimmer.stop(now + duration + 0.1);
    setInside(true, duration * 0.8);
  }

  // 过路车:从背后赶上、又开远。耳朵跟着它从右后转到左前。
  function carPass(duration = 8) {
    if (!state.unlocked) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(260, now);
    filter.frequency.exponentialRampToValueAtTime(900, now + duration * 0.45);
    filter.frequency.exponentialRampToValueAtTime(200, now + duration);
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.20, now + duration * 0.45);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(0.5, now);
    pan.pan.linearRampToValueAtTime(-0.7, now + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(master);
    src.start(now);
    src.stop(now + duration + 0.1);
  }

  // 踩进水洼。
  function puddleSplash() {
    if (!state.unlocked) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.22);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(now);
    src.stop(now + 0.3);
    const drip = ctx.createOscillator();
    drip.type = "sine";
    drip.frequency.setValueAtTime(420, now + 0.05);
    drip.frequency.exponentialRampToValueAtTime(130, now + 0.18);
    const dripGain = ctx.createGain();
    dripGain.gain.setValueAtTime(0.06, now + 0.05);
    dripGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    drip.connect(dripGain);
    dripGain.connect(master);
    drip.start(now + 0.05);
    drip.stop(now + 0.25);
  }

  // 每一步踩在水面上:很轻,几乎只是雨声里的一点变化。
  function stepSplash(intensity = 0.5) {
    if (!state.unlocked || state.muted) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 0.7 + Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(280, now + 0.13);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.02 + intensity * 0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(now);
    src.stop(now + 0.18);
  }

  // 贩卖机的一声钟——街尽头的 orb。
  function vendingChime() {
    if (!state.unlocked) return;
    const now = ctx.currentTime;
    const carrier = ctx.createOscillator();
    carrier.frequency.value = 784; // G5
    const mod = ctx.createOscillator();
    mod.frequency.value = 784 * 1.5;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(420, now);
    modGain.gain.exponentialRampToValueAtTime(8, now + 2.2);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
    carrier.connect(gain);
    gain.connect(master);
    carrier.start(now);
    mod.start(now);
    carrier.stop(now + 2.8);
    mod.stop(now + 2.8);
  }

  // 每帧:持续声源跟着状态走。
  function update(dt, signals) {
    if (!state.unlocked) return;
    const now = ctx.currentTime;
    // 呵气
    live.breathGain.gain.setTargetAtTime((signals.breath ?? 0) * 0.085, now, 0.1);
    // 手掌
    live.palmGain.gain.setTargetAtTime((signals.palmCharge ?? 0) * 0.07, now, 0.08);
    if (signals.palmCharge > 0) {
      live.palmOsc.frequency.setTargetAtTime(68 + signals.palmCharge * 36, now, 0.1);
    }
    // 接近声
    live.lampGain.gain.setTargetAtTime((signals.lampProx ?? 0) * 0.028, now, 0.3);
    live.vendingGain.gain.setTargetAtTime((signals.vendingProx ?? 0) * 0.05, now, 0.3);
    live.purrGain.gain.setTargetAtTime((signals.catProx ?? 0) * 0.09, now, 0.4);
    // 玻璃上的雨点(只在车里)
    if (state.inside && now > state.nextPlinkAt) {
      plink(now + 0.01);
      state.nextPlinkAt = now + 0.18 + Math.random() * 1.4;
    }
  }

  return {
    unlock,
    setMuted,
    setInside,
    wipeSqueak,
    meltThrough,
    frostBack,
    carPass,
    puddleSplash,
    stepSplash,
    vendingChime,
    update,
    get muted() {
      return state.muted;
    },
    get unlocked() {
      return state.unlocked;
    },
  };
}
