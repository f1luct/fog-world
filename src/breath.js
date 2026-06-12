// 呼吸输入。麦克风版：呵气是宽带气流噪声——RMS 能量 + 谱平坦度两个阈值
// 就能和说话区分开（语音有谐波结构，平坦度低）。不开麦的版本：按住空格。
// 两条路都汇成同一个 0..1 的呼吸包络，下游不关心来源。

export function createBreath(cfg) {
  const state = {
    usingMic: false,
    micError: null,
    envelope: 0,     // 平滑后的呼吸强度 0..1
    detected: 0,     // 这一帧的原始判定强度
    keyHeld: false,
    simulateUntil: 0,
    time: 0,
  };

  let audioContext = null;
  let analyser = null;
  let timeData = null;
  let freqData = null;

  async function enableMic() {
    // AudioContext 必须在用户手势内同步建好并立刻 resume——
    // iOS 上等权限弹窗回来手势已过期,那时再 resume 可能永远 pending。
    // resume 不 await:就算暂时 suspended,授权采集开始后 WebKit 会放行。
    audioContext = audioContext || new AudioContext();
    audioContext.resume().catch(() => {});
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = cfg.fftSize;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    timeData = new Float32Array(analyser.fftSize);
    freqData = new Float32Array(analyser.frequencyBinCount);
    state.usingMic = true;
  }

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") state.keyHeld = true;
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") state.keyHeld = false;
  });
  window.addEventListener("blur", () => {
    state.keyHeld = false;
  });

  function readMic() {
    analyser.getFloatTimeDomainData(timeData);
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
    const rms = Math.sqrt(sum / timeData.length);
    if (rms < cfg.energyThreshold * 0.6) return 0;

    // 谱平坦度：只看 100Hz–4kHz（呵气的能量带），几何均值 / 算术均值。
    analyser.getFloatFrequencyData(freqData);
    const binHz = audioContext.sampleRate / analyser.fftSize;
    const lo = Math.max(1, Math.round(100 / binHz));
    const hi = Math.min(freqData.length - 1, Math.round(4000 / binHz));
    let logSum = 0;
    let linSum = 0;
    let count = 0;
    for (let i = lo; i <= hi; i++) {
      const power = Math.pow(10, freqData[i] / 10);
      logSum += Math.log(power + 1e-12);
      linSum += power;
      count++;
    }
    const flatness = Math.exp(logSum / count) / (linSum / count + 1e-12);
    if (flatness < cfg.flatnessThreshold) return 0;

    return Math.min((rms - cfg.energyThreshold * 0.6) / cfg.energyThreshold, 1);
  }

  function frame(dt, time) {
    state.time = time;
    let target = 0;
    let rate = cfg.attack;

    if (time < state.simulateUntil) {
      target = 1;
      rate = cfg.holdKeyRate;
    } else if (state.usingMic && analyser) {
      state.detected = readMic();
      target = state.detected;
    } else if (state.keyHeld) {
      target = 1;
      rate = cfg.holdKeyRate;
    }

    if (target > state.envelope) {
      state.envelope = Math.min(state.envelope + rate * dt * Math.max(target, 0.4), target);
    } else {
      state.envelope = Math.max(state.envelope - cfg.release * dt, target);
    }
    return state.envelope;
  }

  return {
    enableMic,
    frame,
    // 开发钩子：fogDev.breathe(2) 模拟一口两秒的呵气。
    simulate(seconds = 2) {
      state.simulateUntil = state.time + seconds;
    },
    get usingMic() {
      return state.usingMic;
    },
    get envelope() {
      return state.envelope;
    },
    get debug() {
      return {
        mic: state.usingMic,
        breath: Number(state.envelope.toFixed(3)),
        keyHeld: state.keyHeld,
      };
    },
  };
}
