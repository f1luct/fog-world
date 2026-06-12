// 水镜地面。整条街是一面黑色的水镜:脚步荡开真实的波纹,
// 废墟楼影、零星暖窗和大月亮倒扣在水里,雨点在镜面上敲出一圈圈涟漪。
// 三件事各管一摊:波动方程模拟(ping-pong 半浮点 RT,模拟域跟随玩家)、
// 镜像相机平面反射(渲前把自己藏起来)、水面材质(梯度法线 + 菲涅尔 + 手动雾)。

import * as THREE from "three";

const MAX_STROKES = 10;
const STEP = 1 / 120;     // 模拟步长:120Hz,每帧最多两步
const DAMPING = 0.9930;

// ---------------------------------------------------------------- 模拟 shader
// 经典波动方程的 ping-pong 方案:R = 当前高度,G = 上一帧高度。
// u_shift 是域平移补偿:域中心吸附到新网格点时,所有采样都从旧位置取,
// 波纹跟着域一起平移,不会因为玩家走远就被整片抹掉。

const SIM_FRAGMENT = /* glsl */ `
  precision highp float;

  varying vec2 v_uv;
  uniform sampler2D u_state;
  uniform float u_texel;
  uniform float u_damping;
  uniform float u_clear;     // 1 = 整面归零(初始化用)
  uniform vec2 u_shift;      // 域平移量(uv),仅吸附后的第一步非零
  uniform vec4 u_segs[${MAX_STROKES}];   // xy 起点, zw 终点(域 uv)
  uniform vec4 u_params[${MAX_STROKES}]; // 强度, 半径(uv), 未用, 启用

  vec2 segmentInfo(vec2 point, vec2 start, vec2 end) {
    vec2 seg = end - start;
    float along = clamp(dot(point - start, seg) / max(dot(seg, seg), 0.00001), 0.0, 1.0);
    return vec2(distance(point, start + seg * along), along);
  }

  float soften(float v) {
    return v * v * (3.0 - 2.0 * v);
  }

  void main() {
    vec2 uv = v_uv + u_shift;
    vec4 center = texture2D(u_state, uv);
    float current = center.r;
    float previous = center.g;

    float left = texture2D(u_state, uv - vec2(u_texel, 0.0)).r;
    float right = texture2D(u_state, uv + vec2(u_texel, 0.0)).r;
    float down = texture2D(u_state, uv - vec2(0.0, u_texel)).r;
    float up = texture2D(u_state, uv + vec2(0.0, u_texel)).r;

    float next = ((left + right + down + up) * 0.5 - previous) * u_damping;
    float storedPrevious = current;

    // 边界吸收:波到域边渐渐消失,域平移从外面带进来的脏数据也靠它压掉
    vec2 edge = smoothstep(vec2(0.0), vec2(0.05), v_uv) *
      smoothstep(vec2(0.0), vec2(0.05), 1.0 - v_uv);
    next *= edge.x * edge.y;
    next *= 1.0 - u_clear;
    storedPrevious *= 1.0 - u_clear;

    // 胶囊段注入:splash 是零长度段(等于圆),stir 是绕圈的小短段
    for (int i = 0; i < ${MAX_STROKES}; i++) {
      vec4 params = u_params[i];
      if (params.w < 0.5) continue;
      vec2 stroke = segmentInfo(v_uv, u_segs[i].xy, u_segs[i].zw);
      float impact = soften(smoothstep(params.y, 0.0, stroke.x));
      next += impact * params.x;
    }

    gl_FragColor = vec4(clamp(next, -1.2, 1.2), clamp(storedPrevious, -1.2, 1.2), 0.0, 1.0);
  }
`;

const QUAD_VERTEX = /* glsl */ `
  varying vec2 v_uv;
  void main() {
    v_uv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// ---------------------------------------------------------------- 水面 shader
// 法线由三层叠出:波纹场梯度(只在模拟域内) + 程序化雨点扩散环(覆盖全水面)
// + 极轻的远处环境波。颜色 = 深水色与平面反射按菲涅尔混合——反射要明显,
// 这是一面"水镜",不是水洼。雾自己算,跟场景的 FogExp2 保持一致。

const WATER_VERTEX = /* glsl */ `
  uniform mat4 u_textureMatrix;
  varying vec3 v_world;
  varying vec4 v_refl;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    v_world = wp.xyz;
    v_refl = u_textureMatrix * wp;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  precision highp float;

  varying vec3 v_world;
  varying vec4 v_refl;
  uniform sampler2D u_height;     // 波纹高度场(R 通道)
  uniform sampler2D u_reflection; // 平面反射 RT
  uniform vec3 u_domain;          // 模拟域中心 x, 中心 z, 边长
  uniform float u_simTexel;
  uniform float u_time;
  uniform vec3 u_deepColor;
  uniform vec3 u_fogColor;
  uniform float u_fogDensity;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    // —— 一层:波纹场梯度。世界坐标映射进模拟 uv,域外梯度为 0 ——
    vec2 suv = (v_world.xz - u_domain.xy) / u_domain.z + 0.5;
    vec2 inner = smoothstep(vec2(0.0), vec2(0.08), suv) *
      smoothstep(vec2(0.0), vec2(0.08), 1.0 - suv);
    float mask = inner.x * inner.y;
    vec2 grad = vec2(0.0);
    if (mask > 0.001) {
      float hl = texture2D(u_height, suv - vec2(u_simTexel, 0.0)).r;
      float hr = texture2D(u_height, suv + vec2(u_simTexel, 0.0)).r;
      float hd = texture2D(u_height, suv - vec2(0.0, u_simTexel)).r;
      float hu = texture2D(u_height, suv + vec2(0.0, u_simTexel)).r;
      grad = vec2(hr - hl, hu - hd) * 2.8 * mask;
    }

    // —— 二层:雨点扩散环。网格 cell + 随机相位,从落点向外散一圈坡 ——
    for (int layer = 0; layer < 2; layer++) {
      float fl = float(layer);
      vec2 p = v_world.xz * (0.55 + fl * 0.4) + fl * 17.3;
      vec2 cell = floor(p);
      vec2 f = fract(p) - 0.5;
      float h = hash(cell + fl * 13.0);
      float phase = fract(u_time * (0.5 + 0.4 * h) + h * 7.0);
      vec2 jitter = vec2(hash(cell + 1.3), hash(cell + 4.7)) * 0.5 - 0.25;
      vec2 toCenter = f - jitter;
      float d = length(toCenter);
      float ringR = phase * 0.38;
      float band = smoothstep(0.06, 0.0, abs(d - ringR));
      grad += (toCenter / max(d, 0.001)) * band * (1.0 - phase) * 0.05;
    }

    // —— 三层:远处的环境微波,幅度很小,只为让镜面不死板 ——
    grad += vec2(
      sin(v_world.x * 0.6 + u_time * 0.7) + sin(v_world.z * 0.23 - u_time * 0.45),
      sin(v_world.z * 0.5 + u_time * 0.55) + sin(v_world.x * 0.31 + u_time * 0.4)
    ) * 0.006;

    vec3 normal = normalize(vec3(-grad.x, 1.0, -grad.y));
    vec3 viewDir = normalize(cameraPosition - v_world);

    // 投影采样反射。竖向扰动给得比横向大一截,再叠一层细碎的随机抖动——
    // 水面把高处的亮(月亮、灯)拉成一条颤动的光路,而不是一面干净镜子。
    float shiver = hash(floor(v_world.xz * 9.0) + floor(u_time * 2.5) * vec2(0.37, 0.71)) - 0.5;
    vec2 reflUv = v_refl.xy / max(v_refl.w, 0.0001) +
      vec2(normal.x * 0.05, normal.z * 0.17 + shiver * 0.013);
    vec3 reflection = texture2D(u_reflection, reflUv).rgb;

    float fresnel = 0.38 + 0.6 * pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);
    vec3 color = mix(u_deepColor, reflection, clamp(fresnel, 0.0, 1.0));

    // 与场景一致的指数雾,远处的镜面沉进夜里
    float depth = distance(cameraPosition, v_world);
    float fogFactor = exp(-u_fogDensity * u_fogDensity * depth * depth);
    color = mix(u_fogColor, color, fogFactor);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function createSimTarget(size) {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

// ---------------------------------------------------------------- 主体

export function createMirrorWater(renderer, opts = {}) {
  const {
    width = 64,
    length = 240,
    centerZ = -50,
    simRes = 288,
    domainSize = 44,
  } = opts;

  // ------------------------------------------------ 波纹模拟
  const simScene = new THREE.Scene();
  const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const simUniforms = {
    u_state: { value: null },
    u_texel: { value: 1 / simRes },
    u_damping: { value: DAMPING },
    u_clear: { value: 1 },
    u_shift: { value: new THREE.Vector2() },
    u_segs: { value: Array.from({ length: MAX_STROKES }, () => new THREE.Vector4()) },
    u_params: { value: Array.from({ length: MAX_STROKES }, () => new THREE.Vector4()) },
  };
  simScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: SIM_FRAGMENT,
      uniforms: simUniforms,
      depthTest: false,
      depthWrite: false,
    }),
  ));

  let read = createSimTarget(simRes);
  let write = createSimTarget(simRes);
  let clearAmount = 1;     // 第一步把未初始化的 RT 归零
  let stepAccumulator = 0;
  let queue = [];          // 待注入的胶囊段,世界坐标,步进时再换算成域 uv

  // 模拟域中心:吸附在 snapStep 网格上,只在玩家走出两个格子时才动
  const snapStep = (domainSize / simRes) * 2;
  let domainX = 0;
  let domainZ = centerZ;
  let pendingShiftX = 0; // 已吸附但尚未在模拟里补偿的平移量(世界米)
  let pendingShiftZ = 0;

  function enqueue(stroke) {
    // 域外的注入直接丢弃(留半径的余量,贴边的波还能进来半圈)
    const margin = (stroke.radius ?? 0.8) + 0.5;
    const half = domainSize / 2 + margin;
    if (Math.abs(stroke.ax - domainX) > half || Math.abs(stroke.az - domainZ) > half) return;
    queue.push(stroke);
    if (queue.length > 120) queue.splice(0, queue.length - 120);
  }

  function splash(x, z, strength, radius = 0.8) {
    enqueue({ ax: x, az: z, bx: x, bz: z, strength, radius });
  }

  // 漂移时的持续轻搅:落点绕小圈缓慢揉水面,搅出绵延不断的细波
  function stir(x, z, strength, time) {
    const swirl = 0.32 + strength * 0.3;
    const angle = time * (2.0 + strength * 2.2);
    enqueue({
      ax: x + Math.cos(angle) * swirl,
      az: z + Math.sin(angle) * swirl,
      bx: x + Math.cos(angle + 0.6) * swirl,
      bz: z + Math.sin(angle + 0.6) * swirl,
      strength: 0.04 + strength * 0.08,
      radius: 0.5,
    });
  }

  function runStep() {
    // 域平移补偿只在吸附后的第一步生效一次
    simUniforms.u_shift.value.set(pendingShiftX / domainSize, pendingShiftZ / domainSize);
    pendingShiftX = 0;
    pendingShiftZ = 0;

    let slot = 0;
    while (slot < MAX_STROKES && queue.length > 0) {
      const stroke = queue.shift();
      const ax = (stroke.ax - domainX) / domainSize + 0.5;
      const az = (stroke.az - domainZ) / domainSize + 0.5;
      const bx = (stroke.bx - domainX) / domainSize + 0.5;
      const bz = (stroke.bz - domainZ) / domainSize + 0.5;
      // 入队后域可能又平移过,完全滑出域的段在这里二次丢弃
      if (Math.max(ax, bx) < -0.05 || Math.min(ax, bx) > 1.05 ||
        Math.max(az, bz) < -0.05 || Math.min(az, bz) > 1.05) continue;
      simUniforms.u_segs.value[slot].set(ax, az, bx, bz);
      simUniforms.u_params.value[slot].set(stroke.strength, (stroke.radius ?? 0.8) / domainSize, 0, 1);
      slot++;
    }
    for (; slot < MAX_STROKES; slot++) {
      simUniforms.u_params.value[slot].set(0, 0, 0, 0);
    }

    simUniforms.u_state.value = read.texture;
    simUniforms.u_clear.value = clearAmount;
    clearAmount = 0;

    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(write);
    renderer.render(simScene, simCamera);
    renderer.setRenderTarget(previousTarget);
    const swap = read;
    read = write;
    write = swap;
  }

  // ------------------------------------------------ 平面反射
  // 镜像相机法:反射矩阵 R = 关于 y=0 平面的反射(即 y 取负)。
  // 概念上 reflectionCamera.matrixWorld = R * camera.matrixWorld;
  // 实操按 Reflector 的思路把位置/视线目标/up 各自过一遍 R 再 lookAt,
  // 避免直接塞行列式为 -1 的非正交旋转。投影矩阵直接抄主相机。
  // 场景里没有任何 y<0 的物体,水下不会有东西被错误反射,
  // 所以明确不做斜裁剪(oblique clipping),省一套投影矩阵手术。
  const reflectionCamera = new THREE.PerspectiveCamera();
  const textureMatrix = new THREE.Matrix4();
  const _camPos = new THREE.Vector3();
  const _rotation = new THREE.Matrix4();
  const _target = new THREE.Vector3();
  const _up = new THREE.Vector3();

  const qualityRatios = { 2: 0.36, 1: 0.26, 0: 0.18 };
  let reflectRatio = qualityRatios[2];
  let canvasW = 960;
  let canvasH = 540;
  let canvasPr = 1;
  const reflectionTarget = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });

  function rebuildReflectionTarget() {
    reflectionTarget.setSize(
      Math.max(2, Math.round(canvasW * canvasPr * reflectRatio)),
      Math.max(2, Math.round(canvasH * canvasPr * reflectRatio)),
    );
  }
  rebuildReflectionTarget();

  function setQuality(level) {
    reflectRatio = qualityRatios[level] ?? qualityRatios[2];
    rebuildReflectionTarget();
  }

  function resize(viewWidth, viewHeight, pixelRatio) {
    canvasW = viewWidth;
    canvasH = viewHeight;
    canvasPr = pixelRatio;
    rebuildReflectionTarget();
  }

  function renderReflection(scene, camera) {
    camera.updateMatrixWorld();
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    _rotation.extractRotation(camera.matrixWorld);

    // 位置、视线目标、up 各自关于 y=0 镜像(y 取负)
    reflectionCamera.position.set(_camPos.x, -_camPos.y, _camPos.z);
    _target.set(0, 0, -1).applyMatrix4(_rotation).add(_camPos);
    _target.y = -_target.y;
    _up.set(0, 1, 0).applyMatrix4(_rotation);
    _up.y = -_up.y;
    reflectionCamera.up.copy(_up);
    reflectionCamera.lookAt(_target);
    reflectionCamera.projectionMatrix.copy(camera.projectionMatrix);
    reflectionCamera.updateMatrixWorld();
    reflectionCamera.matrixWorldInverse.copy(reflectionCamera.matrixWorld).invert();

    // textureMatrix = bias(0.5) * proj * view,水面 shader 用它做投影采样
    textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    textureMatrix.multiply(reflectionCamera.projectionMatrix);
    textureMatrix.multiply(reflectionCamera.matrixWorldInverse);

    // 水面别照见自己
    const wasVisible = mesh.visible;
    mesh.visible = false;
    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(reflectionTarget);
    renderer.render(scene, reflectionCamera);
    renderer.setRenderTarget(previousTarget);
    mesh.visible = wasVisible;
  }

  // ------------------------------------------------ 水面网格
  const waterUniforms = {
    u_height: { value: read.texture },
    u_reflection: { value: reflectionTarget.texture },
    u_textureMatrix: { value: textureMatrix },
    u_domain: { value: new THREE.Vector3(domainX, domainZ, domainSize) },
    u_simTexel: { value: 1 / simRes },
    u_time: { value: 0 },
    u_deepColor: { value: new THREE.Color(0.012, 0.018, 0.034) },
    u_fogColor: { value: new THREE.Color(0.027, 0.039, 0.078) },
    u_fogDensity: { value: 0.020 },
  };
  const geometry = new THREE.PlaneGeometry(width, length);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms: waterUniforms,
    fog: false, // 雾在 fragment 里自己算,跟场景 FogExp2 同色同密度
  }));
  mesh.position.set(0, 0, centerZ);

  // ------------------------------------------------ 主更新
  function update(dt, time, centerX, centerZ2) {
    waterUniforms.u_time.value = time;

    // 域跟随:偏离超过两个模拟格就吸附到网格上,平移量记账等下一步补偿
    if (Math.abs(centerX - domainX) > snapStep) {
      const snapped = Math.round(centerX / snapStep) * snapStep;
      pendingShiftX += snapped - domainX;
      domainX = snapped;
    }
    if (Math.abs(centerZ2 - domainZ) > snapStep) {
      const snapped = Math.round(centerZ2 / snapStep) * snapStep;
      pendingShiftZ += snapped - domainZ;
      domainZ = snapped;
    }
    waterUniforms.u_domain.value.set(domainX, domainZ, domainSize);

    // 120Hz 定步推进,积压最多两步——慢帧宁可慢波也不连环补帧
    stepAccumulator = Math.min(stepAccumulator + dt, STEP * 2);
    while (stepAccumulator >= STEP) {
      stepAccumulator -= STEP;
      runStep();
    }
    waterUniforms.u_height.value = read.texture;
  }

  return {
    mesh,
    update,
    splash,
    stir,
    renderReflection,
    setQuality,
    resize,
  };
}
