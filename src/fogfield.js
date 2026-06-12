// 雾场模拟。一对 ping-pong 半浮点渲染目标，R 通道存雾密度 [0, 1.25]。
// 擦拭以胶囊段注入（压低密度），呵气以高斯雾团注入（推高密度，可过饱和），
// 没有人动它时，密度向 1 缓慢回涨——擦亮的夜又一点点蒙上。

import * as THREE from "three";

const MAX_STROKES = 10;

const SIM_FRAGMENT = /* glsl */ `
  precision highp float;

  varying vec2 v_uv;
  uniform sampler2D u_state;
  uniform sampler2D u_grain;     // 回雾的不均匀性：真实玻璃的雾有纹理
  uniform sampler2D u_palm;      // 掌印形状
  uniform float u_dt;
  uniform float u_aspect;
  uniform float u_regrow;        // 已含呼吸钟调制的基础回涨速率
  uniform float u_edgeBoost;
  uniform float u_maxFog;
  uniform vec4 u_breath;         // xy 中心, z 半径, w 强度（0 = 没在呵气）
  uniform vec4 u_palmStamp;      // xy 中心, z 半径, w 擦除强度（0 = 无掌印）
  uniform float u_reset;         // 1 = 整面回到全雾
  uniform vec4 u_segs[${MAX_STROKES}];   // xy 起点, zw 终点（uv）
  uniform vec4 u_params[${MAX_STROKES}]; // 强度, 半径, 未用, 启用

  vec2 segmentInfo(vec2 point, vec2 start, vec2 end) {
    vec2 seg = end - start;
    float along = clamp(dot(point - start, seg) / max(dot(seg, seg), 0.00001), 0.0, 1.0);
    return vec2(distance(point, start + seg * along), along);
  }

  float soften(float v) {
    return v * v * (3.0 - 2.0 * v);
  }

  void main() {
    float fog = texture2D(u_state, v_uv).r;

    // —— 回雾：边缘先蒙、纹理不均、随车内呼吸起伏 ——
    float grain = texture2D(u_grain, v_uv * 1.7).r;
    vec2 edgeDist = min(v_uv, 1.0 - v_uv);
    float edge = 1.0 - smoothstep(0.0, 0.3, min(edgeDist.x, edgeDist.y));
    float regrow = u_regrow * (0.55 + 0.9 * grain) * (1.0 + edge * u_edgeBoost);
    fog += regrow * max(1.0 - fog, 0.0) * u_dt;

    // —— 呵气：一团暖湿的雾，中心可以过饱和到发白 ——
    if (u_breath.w > 0.001) {
      vec2 scale = vec2(u_aspect, 1.0);
      float d = distance(v_uv * scale, u_breath.xy * scale);
      float blob = exp(-pow(d / max(u_breath.z, 0.001), 2.0) * 2.4);
      fog += blob * u_breath.w * u_dt * max(u_maxFog - fog, 0.0);
    }

    // —— 指尖擦拭：胶囊段，乘法擦除留软边 ——
    vec2 here = v_uv * vec2(u_aspect, 1.0);
    for (int i = 0; i < ${MAX_STROKES}; i++) {
      vec4 params = u_params[i];
      if (params.w < 0.5) continue;
      vec2 start = u_segs[i].xy * vec2(u_aspect, 1.0);
      vec2 end = u_segs[i].zw * vec2(u_aspect, 1.0);
      vec2 stroke = segmentInfo(here, start, end);
      float impact = soften(smoothstep(params.y, params.y * 0.25, stroke.x));
      fog *= 1.0 - impact * params.x;
    }

    // —— 手掌贴上来：掌印形状一次性压走雾 ——
    if (u_palmStamp.w > 0.001) {
      vec2 scale = vec2(u_aspect, 1.0);
      vec2 local = (v_uv * scale - u_palmStamp.xy * scale) / u_palmStamp.z;
      vec2 palmUv = local * 0.5 + 0.5;
      if (palmUv.x > 0.0 && palmUv.x < 1.0 && palmUv.y > 0.0 && palmUv.y < 1.0) {
        float mask = texture2D(u_palm, palmUv).r;
        fog *= 1.0 - mask * u_palmStamp.w;
      }
    }

    fog = mix(fog, 1.0, u_reset);
    gl_FragColor = vec4(clamp(fog, 0.0, u_maxFog), 0.0, 0.0, 1.0);
  }
`;

const QUAD_VERTEX = /* glsl */ `
  varying vec2 v_uv;
  void main() {
    v_uv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

function createTarget(width, height) {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

// 雾的颗粒纹理：双层值噪声画进 canvas，回雾时的不均匀全靠它。
export function createGrainTexture(size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  const cell = 8;
  const grid = [];
  const gridSide = size / cell + 2;
  for (let i = 0; i < gridSide * gridSide; i++) grid.push(Math.random());
  const sample = (x, y) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    const fx = x / cell - gx;
    const fy = y / cell - gy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const idx = (ix, iy) => grid[((iy % gridSide) + gridSide) % gridSide * gridSide + ((ix % gridSide) + gridSide) % gridSide];
    const a = idx(gx, gy);
    const b = idx(gx + 1, gy);
    const c = idx(gx, gy + 1);
    const d = idx(gx + 1, gy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coarse = sample(x, y);
      const fine = sample(x * 3.1 % size, y * 3.1 % size);
      const v = Math.round((coarse * 0.65 + fine * 0.35) * 255);
      const o = (y * size + x) * 4;
      image.data[o] = image.data[o + 1] = image.data[o + 2] = v;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createFogField(renderer, cfg, palmTexture, grainTexture) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    u_state: { value: null },
    u_grain: { value: grainTexture },
    u_palm: { value: palmTexture },
    u_dt: { value: 1 / 60 },
    u_aspect: { value: 1 },
    u_regrow: { value: cfg.regrowRate },
    u_edgeBoost: { value: cfg.regrowEdgeBoost },
    u_maxFog: { value: cfg.overSaturation },
    u_breath: { value: new THREE.Vector4(0.5, 0.3, cfg.breathRadius, 0) },
    u_palmStamp: { value: new THREE.Vector4(0, 0, 1, 0) },
    u_reset: { value: 1 },
    u_segs: { value: Array.from({ length: MAX_STROKES }, () => new THREE.Vector4()) },
    u_params: { value: Array.from({ length: MAX_STROKES }, () => new THREE.Vector4()) },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERTEX,
    fragmentShader: SIM_FRAGMENT,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  let read = createTarget(4, 4);
  let write = createTarget(4, 4);
  let aspect = 1;
  let resetPending = 1;
  let queue = [];
  let breathInject = { x: 0.5, y: 0.3, radius: cfg.breathRadius, strength: 0 };
  let palmStamp = null; // { x, y, radius, strength }——只生效一步

  // CPU 影子格网：GPU 场的低清近似，跟同一套规则走。玩法判定
  //（按点雾够不够厚）从这里取样，不用每帧读回显存。
  const SHADOW_W = 24;
  const SHADOW_H = 14;
  const shadow = new Float32Array(SHADOW_W * SHADOW_H).fill(1);

  function shadowWipe(stroke) {
    const radius = (stroke.radius ?? cfg.wipeRadius) * 1.6;
    for (let gy = 0; gy < SHADOW_H; gy++) {
      for (let gx = 0; gx < SHADOW_W; gx++) {
        const px = ((gx + 0.5) / SHADOW_W) * aspect;
        const py = (gy + 0.5) / SHADOW_H;
        const ax = stroke.ax * aspect;
        const ay = stroke.ay;
        const bx = stroke.bx * aspect;
        const by = stroke.by;
        const segX = bx - ax;
        const segY = by - ay;
        const lenSq = Math.max(segX * segX + segY * segY, 1e-6);
        const along = Math.max(0, Math.min(1, ((px - ax) * segX + (py - ay) * segY) / lenSq));
        const d = Math.hypot(px - (ax + segX * along), py - (ay + segY * along));
        if (d < radius) {
          const impact = 1 - d / radius;
          shadow[gy * SHADOW_W + gx] *= 1 - impact * stroke.strength;
        }
      }
    }
  }

  function shadowStep(dt, regrowScale) {
    const regrow = cfg.regrowRate * regrowScale;
    for (let gy = 0; gy < SHADOW_H; gy++) {
      for (let gx = 0; gx < SHADOW_W; gx++) {
        const i = gy * SHADOW_W + gx;
        let fog = shadow[i];
        fog += regrow * Math.max(1 - fog, 0) * dt;
        if (breathInject.strength > 0.001) {
          const dx = ((gx + 0.5) / SHADOW_W - breathInject.x) * aspect;
          const dy = (gy + 0.5) / SHADOW_H - breathInject.y;
          const d = Math.hypot(dx, dy);
          const blob = Math.exp(-Math.pow(d / Math.max(breathInject.radius, 0.001), 2) * 2.4);
          fog += blob * breathInject.strength * dt * Math.max(cfg.overSaturation - fog, 0);
        }
        shadow[i] = Math.min(Math.max(fog, 0), cfg.overSaturation);
      }
    }
  }

  function sampleShadow(x, y) {
    const gx = Math.max(0, Math.min(SHADOW_W - 1, Math.floor(x * SHADOW_W)));
    const gy = Math.max(0, Math.min(SHADOW_H - 1, Math.floor(y * SHADOW_H)));
    return shadow[gy * SHADOW_W + gx];
  }

  function resize(viewWidth, viewHeight) {
    aspect = viewWidth / Math.max(viewHeight, 1);
    let simWidth;
    let simHeight;
    if (aspect >= 1) {
      simWidth = cfg.simLongSide;
      simHeight = Math.max(64, Math.round(cfg.simLongSide / aspect));
    } else {
      simHeight = cfg.simLongSide;
      simWidth = Math.max(64, Math.round(cfg.simLongSide * aspect));
    }
    read.dispose();
    write.dispose();
    read = createTarget(simWidth, simHeight);
    write = createTarget(simWidth, simHeight);
    uniforms.u_aspect.value = aspect;
    resetPending = 1;
  }

  // 快速划动在 30Hz 输入下会变成长跳段：切成小段分摊到后续步里，
  // 擦出来才是一道连续的痕而不是一串断点。
  function addWipe(stroke) {
    const length = Math.hypot(stroke.bx - stroke.ax, stroke.by - stroke.ay);
    const pieces = Math.min(Math.ceil(length / 0.014), 12);
    if (pieces <= 1) {
      queue.push(stroke);
    } else {
      for (let i = 0; i < pieces; i++) {
        const t0 = i / pieces;
        const t1 = (i + 1) / pieces;
        queue.push({
          ...stroke,
          ax: stroke.ax + (stroke.bx - stroke.ax) * t0,
          ay: stroke.ay + (stroke.by - stroke.ay) * t0,
          bx: stroke.ax + (stroke.bx - stroke.ax) * t1,
          by: stroke.ay + (stroke.by - stroke.ay) * t1,
        });
      }
    }
    if (queue.length > 120) queue.splice(0, queue.length - 120);
    shadowWipe(stroke);
  }

  function setBreath(x, y, strength, radius = cfg.breathRadius) {
    breathInject = { x, y, radius, strength };
  }

  function stampPalm(x, y, radius, strength) {
    palmStamp = { x, y, radius, strength };
    // 影子格网里掌印近似一个圆。
    shadowWipe({ ax: x, ay: y, bx: x, by: y, radius: radius * 0.7, strength: strength * 0.85 });
  }

  function update(dt, regrowScale = 1) {
    shadowStep(Math.min(dt, 0.05), regrowScale);
    uniforms.u_dt.value = Math.min(dt, 0.05);
    uniforms.u_regrow.value = cfg.regrowRate * regrowScale;
    uniforms.u_breath.value.set(
      breathInject.x, breathInject.y, breathInject.radius, breathInject.strength,
    );
    if (palmStamp) {
      uniforms.u_palmStamp.value.set(palmStamp.x, palmStamp.y, palmStamp.radius, palmStamp.strength);
      palmStamp = null;
    } else {
      uniforms.u_palmStamp.value.w = 0;
    }
    uniforms.u_reset.value = resetPending;
    resetPending = 0;

    const strokes = queue.splice(0, MAX_STROKES);
    for (let i = 0; i < MAX_STROKES; i++) {
      const seg = uniforms.u_segs.value[i];
      const params = uniforms.u_params.value[i];
      const stroke = strokes[i];
      if (stroke) {
        seg.set(stroke.ax, stroke.ay, stroke.bx, stroke.by);
        params.set(stroke.strength, stroke.radius ?? cfg.wipeRadius, 0, 1);
      } else {
        params.set(0, 0, 0, 0);
      }
    }

    uniforms.u_state.value = read.texture;
    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(write);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previousTarget);
    const swap = read;
    read = write;
    write = swap;
  }

  function refill() {
    resetPending = 1;
    queue = [];
    shadow.fill(1);
  }

  return {
    resize,
    addWipe,
    setBreath,
    stampPalm,
    update,
    refill,
    sample: sampleShadow,
    get texture() {
      return read.texture;
    },
    get pending() {
      return queue.length;
    },
  };
}
