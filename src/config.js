// 全部手感参数集中在这一个文件里，调整体验只动这里。

export const CONFIG = {
  // 10s ≈ 6 次/分钟的呼吸节奏——整扇玻璃随车里的人一起呼吸。
  breathPeriod: 10.0,

  fog: {
    simLongSide: 512,
    regrowRate: 0.016,     // 每秒向 1 回涨的基础速率（全屏回雾约 1 分钟量级）
    regrowEdgeBoost: 2.2,  // 屏幕边缘回雾更快（真实车窗从四角先蒙上）
    regrowBreathSwing: 0.5, // 呼吸钟对回雾速率的调制幅度
    wipeRadius: 0.046,     // 指尖擦痕半径（uv，相对短边）
    wipeStrength: 0.92,    // 一次擦过去掉的雾比例
    maxStrokesPerFrame: 10,
    breathRadius: 0.34,    // 呵气雾团半径
    breathRate: 1.1,       // 呵气时密度上涨速率（每秒）
    overSaturation: 1.25,  // 呵气允许的过饱和上限（>1 的部分发白、凝珠）
  },

  droplets: {
    max: 20,            // 同屏可见的水珠数（shader uniform 上限）
    spawnPerBreath: 3,  // 一次呵气结束后凝出的水珠数
    spawnFromWipe: 0.06, // 每次擦拭笔划凝珠的概率
    minRadius: 0.006,
    maxRadius: 0.016,
    slideThreshold: 0.009, // 半径超过它才开始下滑
    slideSpeed: 0.16,      // 满大小时的下滑速度（uv/s）
    growAlong: 0.012,      // 下滑途中扫积雾水、越滑越大
    trailRadiusScale: 0.55, // 尾迹擦痕相对珠子半径
  },

  pointer: {
    minStrokeDistance: 0.0016,
    maxStrokeDistance: 0.2,
    holdPalmDelay: 0.3,    // 按住不动多久算"手掌贴上去"
    holdMoveCancel: 0.03,  // 移动超过它就取消手掌、回到擦拭
  },

  breath: {
    // 麦克风呵气判定：宽带噪声（频谱平坦）+ 能量超阈值。
    fftSize: 1024,
    energyThreshold: 0.06,   // RMS 阈值
    flatnessThreshold: 0.32, // 谱平坦度阈值（呵气是噪声，说话谐波多、平坦度低）
    attack: 4.0,   // 检测到呵气后能量包络上升速率
    release: 1.6,  // 松开后回落速率
    holdKeyRate: 2.6, // 空格替代呵气时包络的上升速率
  },

  palm: {
    chargeTime: 1.8,      // 雾足够厚时，按住到融穿需要的秒数
    fogGate: 0.55,        // 按点附近平均雾密度低于它则充能极慢
    thinChargeScale: 0.12, // 雾太薄时的充能倍率（按了也只留个掌印）
    releaseRate: 0.8,     // 松手后充能消退速率
    cooldown: 2.5,
    printRadius: 0.17,    // 掌印半径（uv）
  },

  crossing: {
    duration: 3.8,
    returnDuration: 3.2,
  },

  world: {
    streetLength: 110,    // 街道长度（米），尽头是贩卖机
    driftSpeed: 0.55,     // 不操作时夜带着你慢慢往前走
    walk: {
      speed: 2.0,
      accelTime: 0.7,
      dragTime: 1.2,
      lookSpeed: 2.4,
      maxPitch: 1.0,
      idleReturn: 2.5,    // 松开按键几秒后漂移接管
      blendIn: 0.4,
      blendOut: 3.5,
    },
    carPassMinGap: 22,    // 过路车最小间隔（秒）
    carPassMaxGap: 46,
  },

  audio: {
    masterGain: 0.85,
    rainInsideFreq: 480,  // 车内雨声的低通截止——闷
    rainOutsideFreq: 8500,
    rainInsideGain: 0.30,
    rainOutsideGain: 0.55,
  },
};

export function detectTier() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("lite")) return "lite";
  const ua = navigator.userAgent || "";
  const mobile = navigator.userAgentData?.mobile || /Mobi|Android|iPhone|iPad/.test(ua);
  return mobile ? "lite" : "full";
}

export function queryFlag(name) {
  return new URLSearchParams(window.location.search).get(name);
}
