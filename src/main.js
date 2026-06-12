// 启动与状态机:PRELUDE → WINDOW(雾玻璃) → CROSSING(融穿) → WORLD(雨夜) ⇄ 回程。
// 一个呼吸钟、一个意图层,喂给每一幕。

import * as THREE from "three";
import { CONFIG, detectTier, detectTouch, queryFlag } from "./config.js";
import { createFogField, createGrainTexture } from "./fogfield.js";
import { createPalmPrint } from "./palmprint.js";
import { createIntent } from "./intent.js";
import { createBreath } from "./breath.js";
import { createDroplets } from "./droplets.js";
import { createWindowAct } from "./windowact.js";
import { createCrossing } from "./crossing.js";
import { createWorld } from "./world.js";
import { createAudio } from "./audio.js";

const canvas = document.querySelector("#glass-canvas");
const ui = {
  prelude: document.querySelector("#prelude"),
  beginMic: document.querySelector("#begin-mic"),
  beginQuiet: document.querySelector("#begin-quiet"),
  micNote: document.querySelector("#mic-note"),
  hint: document.querySelector("#hint"),
  modeWhisper: document.querySelector("#mode-whisper"),
  encounter: document.querySelector("#encounter"),
  soundToggle: document.querySelector("#sound-toggle"),
  carReturn: document.querySelector("#car-return"),
  debug: document.querySelector("#debug"),
};

const tier = detectTier();
const isTouch = detectTouch();

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === "full" ? 1.6 : 1.25));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

CONFIG.fog.simLongSide = tier === "full" ? 640 : 448;

const grainTexture = createGrainTexture();
const palmTexture = createPalmPrint();
const fog = createFogField(renderer, CONFIG.fog, palmTexture, grainTexture);
const droplets = createDroplets(CONFIG.droplets, fog);
const intent = createIntent(canvas, CONFIG);
const breath = createBreath(CONFIG.breath);
const audio = createAudio(CONFIG.audio);
const world = createWorld(renderer, CONFIG.world, tier, CONFIG.breathPeriod);
const windowAct = createWindowAct(renderer, fog, grainTexture, palmTexture, droplets);
const crossing = createCrossing(renderer);
windowAct.setWorldTexture(world.frameTexture);

const windowTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });

const MOUTH = { x: 0.5, y: 0.3 }; // 呵气在玻璃上晕开的位置

const app = {
  state: "prelude",
  micMode: false,
  crossingStart: 0,
  crossingDuration: CONFIG.crossing.duration,
  crossingFocus: { x: 0.5, y: 0.5 },
  hintTimers: [],
  worldEntered: false,
  worldEnteredAt: 0,
  worldWarmed: false,
  lastNavMode: "drift",
  // 用户已经发现了什么:只教没试过的,只在安静时开口。
  guide: { wiped: false, breathed: false, palmTried: false, walked: false, puffed: false, stepped: false },
  breathSessionPeak: 0,
  thinPalmHintAt: -100,
  hintHideTimer: null,
  hintSwapTimer: null,
  whisperTimer: null,
  whisperSwapTimer: null,
  currentHintKey: null,
  encounter: { kind: null, shownAt: -100, hideTimer: null, swapTimer: null },
  modeWhisperCount: { walk: 0, drift: 0 },
  fps: 60,
};

// ---------------------------------------------------------------- 三级文案

function showHint(text, holdSeconds = 6, { html = false, key = null } = {}) {
  hideWhisper();
  hideEncounter();
  clearTimeout(app.hintSwapTimer);
  const apply = () => {
    if (html) ui.hint.innerHTML = text;
    else ui.hint.textContent = text;
    app.currentHintKey = key;
    ui.hint.classList.add("visible");
    clearTimeout(app.hintHideTimer);
    app.hintHideTimer = setTimeout(() => {
      ui.hint.classList.remove("visible");
      app.currentHintKey = null;
    }, holdSeconds * 1000);
  };
  // 两句话之间永远留一口气:旧句呼出,新句呼入,不硬切。
  if (ui.hint.classList.contains("visible")) {
    ui.hint.classList.remove("visible");
    clearTimeout(app.hintHideTimer);
    app.currentHintKey = null;
    app.hintSwapTimer = setTimeout(apply, 1150);
  } else {
    apply();
  }
}

function hideHint() {
  clearTimeout(app.hintHideTimer);
  clearTimeout(app.hintSwapTimer);
  ui.hint.classList.remove("visible");
  app.currentHintKey = null;
}

function hideWhisper() {
  clearTimeout(app.whisperTimer);
  clearTimeout(app.whisperSwapTimer);
  ui.modeWhisper.classList.remove("visible");
}

function hideEncounter() {
  clearTimeout(app.encounter.hideTimer);
  clearTimeout(app.encounter.swapTimer);
  ui.encounter.classList.remove("swap");
  ui.encounter.classList.remove("visible");
}

function whisper(text, holdSeconds = 3.6) {
  if (app.state !== "world") return;
  if (ui.hint.classList.contains("visible")) return;
  hideEncounter();
  clearTimeout(app.whisperSwapTimer);
  const apply = () => {
    ui.modeWhisper.textContent = text;
    ui.modeWhisper.classList.add("visible");
    clearTimeout(app.whisperTimer);
    app.whisperTimer = setTimeout(
      () => ui.modeWhisper.classList.remove("visible"),
      holdSeconds * 1000,
    );
  };
  if (ui.modeWhisper.classList.contains("visible") &&
      ui.modeWhisper.textContent !== text) {
    ui.modeWhisper.classList.remove("visible");
    clearTimeout(app.whisperTimer);
    app.whisperSwapTimer = setTimeout(apply, 620);
  } else {
    apply();
  }
}

const ENCOUNTER_LINES = {
  lamp: "路灯把雨照成一圈细针",
  arch: "断拱下面,雨声变了形",
  lantern: "一盏灯笼绕过你,往街深处去了",
  vending: "贩卖机为没有人亮着",
  breath: "你的白气在雨里散开",
  firstStep: "水面替你数着脚步",
};

function noteEncounter(kind, time, force = false) {
  const line = ENCOUNTER_LINES[kind];
  if (!line) return;
  const enc = app.encounter;
  if (force) {
    hideHint();
    hideWhisper();
  } else if (ui.hint.classList.contains("visible") ||
      ui.modeWhisper.classList.contains("visible")) {
    return;
  }
  const visible = ui.encounter.classList.contains("visible");
  const apply = () => {
    ui.encounter.classList.remove("swap");
    ui.encounter.textContent = line;
    enc.kind = kind;
    enc.shownAt = time;
    ui.encounter.classList.add("visible");
    clearTimeout(enc.hideTimer);
    enc.hideTimer = setTimeout(() => ui.encounter.classList.remove("visible"), 5600);
  };
  if (visible && enc.kind !== kind) {
    ui.encounter.classList.add("swap");
    ui.encounter.classList.remove("visible");
    clearTimeout(enc.hideTimer);
    clearTimeout(enc.swapTimer);
    enc.swapTimer = setTimeout(apply, 580);
    return;
  }
  apply();
}

const KEYCAP = (label) => `<kbd>${label}</kbd>`;

function clearHintTimers() {
  for (const timer of app.hintTimers) clearTimeout(timer);
  app.hintTimers = [];
  hideHint();
}

function setState(next) {
  app.state = next;
  document.body.dataset.state = next;
  ui.carReturn.classList.toggle("visible", next === "world");
}

// ---------------------------------------------------------------- 幕间转换

function enterWindow({ firstTime = true } = {}) {
  setState("window");
  world.setView("car");
  intent.resetPalm(); // 标题页玩雾留下的冷却不带进来
  if (!app.worldWarmed) {
    app.worldWarmed = true;
    setTimeout(() => world.warmup(), 900);
  }
  if (firstTime) {
    app.hintTimers.push(setTimeout(
      () => showHint("擦一擦玻璃。", 5, { key: "wipe" }),
      1400,
    ));
    app.hintTimers.push(setTimeout(() => {
      if (app.micMode) {
        showHint("准备好了——对着夜呵一口气,再把手掌贴上去。", 9, { key: "breathe" });
      } else if (isTouch) {
        // 手机没有空格:手掌的温度自己会让玻璃起雾。
        showHint("准备好了——把手掌贴在玻璃上,捂一会儿,别松开。", 9, { key: "breathe" });
      } else {
        showHint(
          `准备好了——按住 ${KEYCAP("空格")} 呵气,再把手掌贴上去。`,
          9,
          { html: true, key: "breathe" },
        );
      }
    }, 10000));
  } else {
    app.hintTimers.push(setTimeout(
      () => showHint("玻璃上,你擦过的地方还认得你。", 5),
      1600,
    ));
  }
}

function startCrossing(focus) {
  clearHintTimers();
  setState("crossing");
  app.crossingStart = performance.now() / 1000;
  app.crossingDuration = CONFIG.crossing.duration;
  app.crossingFocus = { ...focus };
  crossing.setFocus(focus.x, focus.y);
  crossing.setFrost(false);
  windowAct.render(windowTarget);
  crossing.setTextures(windowTarget.texture, world.frameTexture);
  world.setView("walk");
  world.beginArrival();
  audio.meltThrough(app.crossingDuration);
}

function enterWorld() {
  setState("world");
  app.lastNavMode = "drift";
  app.worldEnteredAt = performance.now() / 1000;
  intent.settle();
  if (!app.worldEntered) {
    app.worldEntered = true;
    app.hintTimers.push(setTimeout(() => {
      showHint("你在窗外了——夜原来积着一层水。", 6.5);
    }, 2200));
    // 剧场拍:一盏灯笼准点从你面前掠过。
    app.hintTimers.push(setTimeout(() => {
      world.summonLanternPass();
    }, 19500));
    app.hintTimers.push(setTimeout(() => {
      noteEncounter("lantern", performance.now() / 1000);
    }, 22000));
    app.hintTimers.push(setTimeout(() => {
      if (isTouch) {
        showHint(
          `${KEYCAP("拖动")} 环顾 &nbsp;·&nbsp; ${KEYCAP("长按")} 往前走`,
          9,
          { html: true },
        );
      } else {
        showHint(
          `${KEYCAP("拖动")} 环顾 &nbsp;·&nbsp; ` +
          `${KEYCAP("W")}${KEYCAP("A")}${KEYCAP("S")}${KEYCAP("D")} 在雨里走 &nbsp;·&nbsp; ` +
          `${KEYCAP("空格")} 呵一口白气`,
          9,
          { html: true },
        );
      }
    }, 9200));
    app.hintTimers.push(setTimeout(() => {
      if (!app.guide.walked) {
        showHint("站着不动也行——夜会自己路过你。", 7);
      }
    }, 28500));
  }
}

function startReturn() {
  clearHintTimers();
  setState("returning");
  app.crossingStart = performance.now() / 1000;
  app.crossingDuration = CONFIG.crossing.returnDuration;
  crossing.setFocus(0.5, 0.5);
  crossing.setFrost(true);
  world.render(false);
  world.setView("car");
  windowAct.render(windowTarget);
  crossing.setTextures(world.frameTexture, windowTarget.texture);
  audio.frostBack(app.crossingDuration);
}

// ---------------------------------------------------------------- 启动接线

// 屏幕常亮:这个游戏鼓励你什么都不按,别让系统在漂移途中把屏幕熄了。
let wakeLock = null;
let wantWakeLock = false;
async function keepAwake() {
  wantWakeLock = true;
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    // 低电量模式等会拒绝,沉默接受。
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    audio.resumeIfNeeded();
    if (wantWakeLock) keepAwake();
  }
});
window.addEventListener("pointerdown", () => audio.resumeIfNeeded());

ui.beginMic.addEventListener("click", async () => {
  await audio.unlock();
  keepAwake();
  try {
    await breath.enableMic();
    app.micMode = true;
  } catch {
    // 注意触屏没有空格——兜底是掌温;且 prelude 即将淡出,正经的说明
    // 等进了窗幕再用 hint 讲一遍。
    const fallbackNote = isTouch
      ? "麦克风沉默着。掌心的温度会替你呼吸。"
      : "麦克风沉默着。空格会替你呼吸。";
    ui.micNote.textContent = fallbackNote;
    setTimeout(() => showHint(fallbackNote, 6), 6800);
  }
  ui.prelude.classList.add("hidden");
  enterWindow();
});

ui.beginQuiet.addEventListener("click", async () => {
  await audio.unlock();
  keepAwake();
  ui.prelude.classList.add("hidden");
  enterWindow();
});

ui.soundToggle.addEventListener("click", async () => {
  await audio.unlock();
  audio.setMuted(!audio.muted);
  ui.soundToggle.textContent = audio.muted ? "无 声" : "有 声";
});

ui.carReturn.addEventListener("click", () => {
  if (app.state === "world") startReturn();
});

// 键盘步行(空格留给呼吸)。
const NAV_KEY_MAP = {
  KeyW: "fwd", ArrowUp: "fwd",
  KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
};
const pressedNav = new Set();
window.addEventListener("keydown", (event) => {
  const action = NAV_KEY_MAP[event.code];
  if (!action || event.metaKey || event.ctrlKey || event.altKey) return;
  pressedNav.add(action);
  app.guide.walked = true;
  if (app.state === "world") event.preventDefault();
});
window.addEventListener("keyup", (event) => {
  const action = NAV_KEY_MAP[event.code];
  if (action) pressedNav.delete(action);
});
window.addEventListener("blur", () => pressedNav.clear());
window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && (app.state === "world" || app.state === "window")) {
    event.preventDefault();
  }
});

function navFrame() {
  return {
    x: (pressedNav.has("right") ? 1 : 0) - (pressedNav.has("left") ? 1 : 0),
    z: (pressedNav.has("fwd") ? 1 : 0) - (pressedNav.has("back") ? 1 : 0),
    active: pressedNav.size > 0,
  };
}

// 开发跳幕:?act=window|world 跳过标题(静音,指针模式)。
const actJump = queryFlag("act");
if (actJump === "window" || actJump === "world") {
  ui.prelude.classList.add("hidden");
  if (actJump === "world") {
    setState("world");
    world.setView("walk");
    world.beginArrival();
    app.worldEntered = true;
    app.worldEnteredAt = performance.now() / 1000;
  } else {
    enterWindow({ firstTime: false });
  }
  const unlockOnGesture = () => {
    audio.unlock().then(() => {
      if (app.state === "world") audio.setInside(false, 0.5);
    });
  };
  window.addEventListener("pointerdown", unlockOnGesture, { once: true });
  window.addEventListener("keydown", unlockOnGesture, { once: true });
}

// 开发钩子:控制台里随时可用。
window.fogDev = {
  breathe: (seconds = 2.5) => breath.simulate(seconds),
  dive: (x = 0.5, y = 0.45) => {
    if (app.state === "window") startCrossing({ x, y });
  },
  surface: () => {
    if (app.state === "world") startReturn();
  },
  lantern: () => {
    world.summonLanternPass();
  },
  freeze: (p = null) => {
    app.crossingFreeze = p;
  },
  tp: (x, z, yaw = null, pitch = null) => {
    world.nav.x = x;
    world.nav.z = z;
    if (yaw !== null) world.nav.yaw = yaw;
    if (pitch !== null) world.nav.pitch = pitch;
    // 落地后站定 30 秒,漂移不要把取景推走。
    world.nav.lastKeyAt = performance.now() / 1000 + 30;
    world.nav.velX = 0;
    world.nav.velZ = 0;
  },
  state: () => app.state,
  world,
};

// ---------------------------------------------------------------- 主循环

let viewWidth = 1;
let viewHeight = 1;

// 帧率看门狗:扛不住就降渲染分辨率和雨量,只降不升(避免来回抖)。
// 手机直接从中档起步——反射 + 高 DPR 全开它撑不住。
const quality = {
  level: tier === "lite" ? 1 : 2,
  lastDropAt: 0,
  ratios: [1.0, 1.25, tier === "full" ? 1.6 : 1.25],
  rain: [0.35, 0.65, 1],
};

function applyQuality() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.ratios[quality.level]));
  renderer.setSize(viewWidth, viewHeight, false);
  world.setRainDensity(quality.rain[quality.level]);
  world.setQuality(quality.level); // 水镜倒影分辨率跟着降
  const ratio = renderer.getPixelRatio();
  // 雾场跟 CSS 尺寸走,不动它——动了擦痕会被清掉。
  world.resize(viewWidth, viewHeight, ratio);
  windowTarget.setSize(Math.round(viewWidth * ratio), Math.round(viewHeight * ratio));
}

function resize() {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  if (width === viewWidth && height === viewHeight) return;
  viewWidth = width;
  viewHeight = height;
  renderer.setSize(width, height, false);
  const ratio = renderer.getPixelRatio();
  fog.resize(width, height);
  windowAct.resize(width, height);
  world.resize(width, height, ratio);
  crossing.resize(width, height);
  windowTarget.setSize(Math.round(width * ratio), Math.round(height * ratio));
}

window.addEventListener("resize", resize);
resize();
applyQuality();

// 长按是核心交互:别让浏览器弹出长按菜单/选中文本。
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

let lastTime = performance.now() / 1000;

function tick(nowMs) {
  requestAnimationFrame(tick);
  const time = nowMs / 1000;
  const dt = Math.min(time - lastTime, 0.05);
  lastTime = time;
  app.fps += ((dt > 0 ? 1 / dt : 60) - app.fps) * 0.05;

  resize();
  if (time > 6 && app.fps < 42 && quality.level > 0 && time - quality.lastDropAt > 5) {
    quality.level -= 1;
    quality.lastDropAt = time;
    applyQuality();
  }
  const breathCycle = 0.5 + 0.5 * Math.sin((Math.PI * 2 * time) / CONFIG.breathPeriod - Math.PI / 2);
  const breathEnv = breath.frame(dt, time);
  const onGlass = app.state === "prelude" || app.state === "window";
  // 触屏静音模式:没有空格呵气,长按本身就算"雾够厚"——掌温融穿。
  // 不在玻璃上时传 null:掌印逻辑整体停摆,长按行走不会被慢充能掐断。
  const palmAlwaysMelts = isTouch && !app.micMode;
  const fogAt = !onGlass ? null : (palmAlwaysMelts ? () => 1 : fog.sample);
  const signals = intent.frame(dt, time, fogAt);

  // —— 玻璃上的事:擦拭、呵气、凝珠 ——
  if (onGlass) {
    for (const wipe of signals.wipes) {
      const speed = wipe.speed ?? 0;
      fog.addWipe({
        ax: wipe.ax, ay: wipe.ay, bx: wipe.bx, by: wipe.by,
        radius: CONFIG.fog.wipeRadius * (wipe.tap ? 0.85 : 1 + Math.min(speed * 3, 0.5)),
        strength: CONFIG.fog.wipeStrength * (wipe.tap ? 0.6 : 1),
      });
      if (!wipe.tap) {
        audio.wipeSqueak(speed, wipe.ax);
        droplets.fromWipe(wipe);
      }
      if (!app.guide.wiped) {
        app.guide.wiped = true;
        // 指令在被执行的那一刻溶解。
        if (app.currentHintKey === "wipe") hideHint();
      }
    }

    // 呵气:雾团供给 + 全玻璃回雾加速(一车厢的湿气)。
    // 触屏静音模式下,手掌按住的地方被体温焐出雾——代替呵气。
    if (palmAlwaysMelts && signals.palm.active) {
      fog.setBreath(signals.palm.x, signals.palm.y, 0.9, 0.24);
    } else {
      fog.setBreath(MOUTH.x, MOUTH.y, breathEnv * CONFIG.fog.breathRate);
    }
    if (breathEnv > 0.4) {
      app.breathSessionPeak = Math.max(app.breathSessionPeak, breathEnv);
      if (!app.guide.breathed) {
        app.guide.breathed = true;
        if (app.currentHintKey === "breathe") hideHint();
      }
    }
    // 一口气呵完:过饱和的雾凝出水珠。
    if (app.breathSessionPeak > 0.4 && breathEnv < 0.15) {
      droplets.condense(MOUTH.x, MOUTH.y + 0.06, CONFIG.fog.breathRadius);
      app.breathSessionPeak = 0;
    }

    // 手掌。
    if (signals.palm.justPlanted) {
      fog.stampPalm(signals.palm.x, signals.palm.y, CONFIG.palm.printRadius, 0.55);
      app.guide.palmTried = true;
    }
    if (signals.palm.active && !signals.palm.fogThick &&
        signals.palm.charge > 0.18 && time - app.thinPalmHintAt > 14 &&
        app.state === "window") {
      app.thinPalmHintAt = time;
      showHint("先呵一口气——让雾厚一点。", 5);
    }
    if (signals.palm.fired && app.state === "window") {
      startCrossing({ x: signals.palm.x, y: signals.palm.y });
    }

    const regrowScale = 1 +
      CONFIG.fog.regrowBreathSwing * (breathCycle * 2 - 1) +
      breathEnv * 2.2;
    droplets.update(dt, time);
    fog.update(dt, regrowScale);
  }

  // —— 声音的持续层 ——
  let lampProx = 0;
  let vendingProx = 0;
  if (app.state === "world") {
    const nav = world.nav;
    for (let i = 0; i < 8; i++) {
      const lampZ = -8 - i * 14;
      const lampX = i % 2 === 0 ? -4.2 : 4.2;
      const d = Math.hypot(nav.x - lampX, nav.z - lampZ);
      lampProx = Math.max(lampProx, 1 - Math.min(d / 7, 1));
    }
    vendingProx = 1 - Math.min(Math.hypot(nav.x - 3.4, nav.z + CONFIG.world.streetLength - 8) / 9, 1);
  }
  audio.update(dt, {
    breath: breathEnv,
    palmCharge: onGlass && signals.palm.active ? signals.palm.charge : 0,
    lampProx,
    vendingProx,
  });

  // —— 各幕 ——
  switch (app.state) {
    case "prelude": {
      world.update(dt, time, breathCycle);
      world.render(false);
      windowAct.update(time, {
        dim: 0.72 + breathCycle * 0.12,
        breathVis: breathEnv,
        breathPos: MOUTH,
        palm: signals.palm,
        palmThick: signals.palm.fogThick ? 1 : 0,
      });
      windowAct.render(null);
      break;
    }
    case "window": {
      world.update(dt, time, breathCycle);
      world.render(false);
      windowAct.update(time, {
        dim: 1,
        breathVis: breathEnv,
        breathPos: MOUTH,
        palm: signals.palm,
        palmThick: signals.palm.fogThick ? 1 : 0,
      });
      windowAct.render(null);
      break;
    }
    case "crossing": {
      const p = app.crossingFreeze ??
        Math.min((time - app.crossingStart) / app.crossingDuration, 1);
      world.update(dt, time, breathCycle, navFrame(), { x: 0, y: 0 });
      world.render(false);
      crossing.setTextures(windowTarget.texture, world.frameTexture);
      crossing.render(p, time);
      if (p >= 1) enterWorld();
      break;
    }
    case "world": {
      const nav = navFrame();
      // 触屏:长按不动 = 朝视线方向走。
      if (isTouch && signals.holding) {
        nav.z = 1;
        nav.active = true;
        app.guide.walked = true;
      }
      world.update(dt, time, breathCycle, nav, signals.drag);
      world.render(true);

      // 呵气:呼出一团白。
      if (breathEnv > 0.45 && app.breathSessionPeak < breathEnv) {
        app.breathSessionPeak = breathEnv;
      }
      if (app.breathSessionPeak > 0.45 && breathEnv < 0.2) {
        world.breathPuff();
        app.breathSessionPeak = 0;
        if (!app.guide.puffed) {
          app.guide.puffed = true;
          noteEncounter("breath", time);
        }
      }

      // 邂逅。
      for (const touch of world.consumeTouchEvents()) {
        if (touch.kind === "step") {
          audio.stepSplash(touch.intensity ?? 0.5);
          if (!app.guide.stepped) {
            app.guide.stepped = true;
            noteEncounter("firstStep", time);
          }
          continue;
        }
        if (touch.kind === "vending") audio.vendingChime();
        if (touch.kind === "end") {
          showHint("水到尽头了。月亮还在。", 6);
          continue;
        }
        noteEncounter(touch.kind, time);
      }

      // 模式低语:教两次,然后沉默。
      const navMode = world.nav.mode;
      if (navMode !== app.lastNavMode) {
        app.modeWhisperCount[navMode] = (app.modeWhisperCount[navMode] || 0) + 1;
        if (app.modeWhisperCount[navMode] <= 2) {
          if (navMode === "walk") {
            whisper("你在走——夜跟着你");
          } else {
            whisper("你停下了——夜带着你", 4.6);
          }
        }
        app.lastNavMode = navMode;
      }
      break;
    }
    case "returning": {
      const p = Math.min((time - app.crossingStart) / app.crossingDuration, 1);
      world.update(dt, time, breathCycle);
      world.render(false);
      windowAct.update(time, { dim: 1 });
      windowAct.render(windowTarget);
      crossing.setTextures(world.frameTexture, windowTarget.texture);
      crossing.render(p, time);
      if (p >= 1) enterWindow({ firstTime: false });
      break;
    }
  }

  if (location.hash.includes("debug")) {
    ui.debug.classList.add("visible");
    if (Math.floor(time * 2) % 2 === 0) {
      ui.debug.textContent = JSON.stringify({
        state: app.state,
        fps: Math.round(app.fps),
        tier,
        touch: isTouch,
        quality: quality.level,
        drops: droplets.count,
        fogAtMouth: Number(fog.sample(0.5, 0.3).toFixed(2)),
        ...intent.debug,
        ...breath.debug,
        ...world.debug,
      }, null, 1).replaceAll('"', "");
    }
  }
}

requestAnimationFrame(tick);
document.documentElement.dataset.journeyReady = "true";
