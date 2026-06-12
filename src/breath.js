// 呼吸输入(无麦克风版)。桌面按住空格,触屏由掌温接管(见 main.js)。
// 输出一个 0..1 的呼吸包络,下游不关心来源。
// 麦克风版(谱平坦度判定真实呵气)在 git 历史里,想找回随时能找回。

export function createBreath(cfg) {
  const state = {
    envelope: 0,     // 平滑后的呼吸强度 0..1
    keyHeld: false,
    simulateUntil: 0,
    time: 0,
  };

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") state.keyHeld = true;
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") state.keyHeld = false;
  });
  window.addEventListener("blur", () => {
    state.keyHeld = false;
  });

  function frame(dt, time) {
    state.time = time;
    let target = 0;
    if (time < state.simulateUntil || state.keyHeld) {
      target = 1;
    }
    if (target > state.envelope) {
      state.envelope = Math.min(state.envelope + cfg.holdKeyRate * dt, target);
    } else {
      state.envelope = Math.max(state.envelope - cfg.release * dt, target);
    }
    return state.envelope;
  }

  return {
    frame,
    // 开发钩子:fogDev.breathe(2) 模拟一口两秒的呵气。
    simulate(seconds = 2) {
      state.simulateUntil = state.time + seconds;
    },
    get envelope() {
      return state.envelope;
    },
    get debug() {
      return {
        breath: Number(state.envelope.toFixed(3)),
        keyHeld: state.keyHeld,
      };
    },
  };
}
