// 车窗幕。一块全屏玻璃：外面的世界（低清渲染）隔着雾看进来——
// 雾厚处糊成一团光斑，擦开处清亮；水珠是一颗颗倒着装下世界的小透镜。
// 手掌贴上来时，掌印里的世界先亮起来。

import * as THREE from "three";

const MAX_DROPS = 20;

const FRAGMENT = /* glsl */ `
  precision highp float;

  varying vec2 v_uv;
  uniform sampler2D u_world;
  uniform sampler2D u_fog;
  uniform sampler2D u_grain;
  uniform sampler2D u_palm;
  uniform float u_aspect;
  uniform float u_time;
  uniform float u_dim;        // 标题幕压暗用
  uniform float u_breathVis;  // 正在呵气的可视强度
  uniform vec2 u_breathPos;
  uniform vec3 u_palmState;   // xy 掌位, z 充能
  uniform float u_palmThick;  // 按点的雾厚不厚（薄雾按不穿）
  uniform vec4 u_drops[${MAX_DROPS}];

  // 透过雾的世界：雾越厚采样半径越大。8 个泊松盘方向。
  vec3 blurredWorld(vec2 uv, float radius) {
    vec3 sum = texture2D(u_world, uv).rgb;
    if (radius < 0.0005) return sum;
    vec2 scale = vec2(radius / u_aspect, radius);
    sum *= 2.0;
    sum += texture2D(u_world, uv + vec2(0.78, 0.21) * scale).rgb;
    sum += texture2D(u_world, uv + vec2(-0.62, 0.55) * scale).rgb;
    sum += texture2D(u_world, uv + vec2(0.31, -0.83) * scale).rgb;
    sum += texture2D(u_world, uv + vec2(-0.86, -0.32) * scale).rgb;
    sum += texture2D(u_world, uv + vec2(0.12, 0.94) * scale).rgb;
    sum += texture2D(u_world, uv + vec2(0.95, -0.49) * scale * 0.6).rgb;
    sum += texture2D(u_world, uv + vec2(-0.41, -0.12) * scale * 0.5).rgb;
    sum += texture2D(u_world, uv + vec2(-0.17, 0.43) * scale * 0.4).rgb;
    return sum / 10.0;
  }

  void main() {
    vec2 scale = vec2(u_aspect, 1.0);

    float fogRaw = texture2D(u_fog, v_uv).r;
    float grain = texture2D(u_grain, v_uv * 2.3).r;
    float grainFine = texture2D(u_grain, v_uv * 7.1 + 0.37).r;
    // 颗粒只在雾上：密度被纹理咬出毛边，雾才像凝在玻璃上而不是一层灰。
    float fog = clamp(fogRaw * (0.82 + 0.30 * grain) * (0.9 + 0.2 * grainFine), 0.0, 1.3);
    float fogVis = clamp(fog, 0.0, 1.0);

    // 雾密度梯度 → 玻璃水膜的法线扰动；擦痕边缘的世界微微弯一下。
    vec2 texel = vec2(1.0 / 512.0);
    float fogL = texture2D(u_fog, v_uv - vec2(texel.x, 0.0)).r;
    float fogR = texture2D(u_fog, v_uv + vec2(texel.x, 0.0)).r;
    float fogD = texture2D(u_fog, v_uv - vec2(0.0, texel.y)).r;
    float fogU = texture2D(u_fog, v_uv + vec2(0.0, texel.y)).r;
    vec2 fogGrad = vec2(fogR - fogL, fogU - fogD);

    vec2 clearUv = v_uv + fogGrad * 0.018;
    vec3 sharp = texture2D(u_world, clearUv).rgb;

    float blurRadius = fogVis * fogVis * 0.075;
    vec3 hazy = blurredWorld(v_uv, blurRadius);

    // 雾的散射体色：外面的光糊成一片冷里带暖的亮，再叠一点车内的灰蓝。
    vec3 scatter = hazy * 1.3 + vec3(0.055, 0.062, 0.078);
    scatter += vec3(0.07, 0.065, 0.06) * grain;

    vec3 through = mix(sharp, hazy, smoothstep(0.04, 0.55, fogVis));
    vec3 color = mix(through, scatter, smoothstep(0.12, 0.95, fogVis) * 0.88);

    // 过饱和的新鲜呵气发白。
    float fresh = max(fogRaw - 1.0, 0.0) / 0.25;
    color += vec3(0.5, 0.52, 0.55) * fresh * (0.35 + 0.1 * grainFine);

    // 擦痕边缘：水膜攒在那里，压一道暗边再提一线高光。
    float gradMag = length(fogGrad);
    color *= 1.0 - smoothstep(0.0, 0.45, gradMag) * 0.28;
    color += vec3(0.7, 0.75, 0.8) * smoothstep(0.2, 0.6, gradMag) *
      max(fogGrad.y, 0.0) * 0.35;

    // —— 水珠：内含倒像的小透镜 ——
    for (int i = 0; i < ${MAX_DROPS}; i++) {
      vec4 drop = u_drops[i];
      if (drop.z < 0.0005) continue;
      vec2 d = (v_uv - drop.xy) * scale;
      float dist = length(d);
      float r = drop.z;
      if (dist > r * 1.6) continue;
      float body = smoothstep(r, r * 0.82, dist);
      // 珠内倒像：以珠心为轴翻转取样，略放大。夜太暗,透镜里提一档亮度,
      // 珠子才能从雾里跳出来。
      vec2 lensUv = drop.xy - d / scale * 1.5;
      vec3 lens = texture2D(u_world, clamp(lensUv, 0.0, 1.0)).rgb;
      lens = lens * 1.7 + vec3(0.05, 0.058, 0.07);
      // 左上一点高光，滑动时拉长。
      vec2 hl = d - vec2(-r * 0.3, r * 0.35 - drop.w * r * 0.3);
      float sparkleR = r * (0.32 - drop.w * 0.08);
      float sparkle = smoothstep(sparkleR, 0.0, length(hl));
      float rim = smoothstep(r * 0.82, r, dist) * smoothstep(r * 1.18, r * 0.95, dist);
      color = mix(color, lens, body * 0.92);
      color += vec3(0.9, 0.92, 0.95) * sparkle * 0.7;
      color += vec3(0.45, 0.5, 0.56) * rim * 0.9;
    }

    // —— 手掌贴上：掌印里的世界先醒过来 ——
    if (u_palmState.z > 0.001) {
      vec2 local = (v_uv - u_palmState.xy) * scale / 0.34 + 0.5;
      if (local.x > 0.0 && local.x < 1.0 && local.y > 0.0 && local.y < 1.0) {
        float mask = texture2D(u_palm, local).r;
        float charge = u_palmState.z;
        float open = mask * smoothstep(0.0, 0.6, charge);
        vec3 awake = sharp * (1.0 + charge * 0.7);
        // 雾厚时融出暖边（体温对着冰玻璃）；雾薄只留个印子。
        vec3 rimColor = mix(vec3(0.3, 0.35, 0.42), vec3(1.0, 0.72, 0.42), u_palmThick);
        float rim = smoothstep(0.05, 0.4, mask) * (1.0 - smoothstep(0.4, 0.9, mask));
        color = mix(color, awake, open * 0.9);
        color += rimColor * rim * charge * (0.5 + 0.3 * sin(u_time * 7.0));
      }
    }

    // 正在呵气：屏幕下缘浮起一层薄白。
    if (u_breathVis > 0.001) {
      float mouth = exp(-pow(distance(v_uv * scale, u_breathPos * scale) / 0.45, 2.0));
      color += vec3(0.16, 0.17, 0.19) * mouth * u_breathVis;
    }

    // 车窗的框：四边压暗 + 底部仪表台的一线暗影。
    vec2 edgeDist = min(v_uv, 1.0 - v_uv);
    float frame = smoothstep(0.0, 0.06, edgeDist.x) * smoothstep(0.0, 0.09, edgeDist.y);
    color *= 0.25 + 0.75 * frame;
    color *= 1.0 - (1.0 - smoothstep(0.0, 0.18, v_uv.y)) * 0.45;
    // 仪表台一点点暖光透上来。
    color += vec3(0.05, 0.03, 0.012) * (1.0 - smoothstep(0.0, 0.13, v_uv.y));

    color *= u_dim;
    gl_FragColor = vec4(color, 1.0);
  }
`;

const VERTEX = /* glsl */ `
  varying vec2 v_uv;
  void main() {
    v_uv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export function createWindowAct(renderer, fog, grainTexture, palmTexture, droplets) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    u_world: { value: null },
    u_fog: { value: null },
    u_grain: { value: grainTexture },
    u_palm: { value: palmTexture },
    u_aspect: { value: 1 },
    u_time: { value: 0 },
    u_dim: { value: 1 },
    u_breathVis: { value: 0 },
    u_breathPos: { value: new THREE.Vector2(0.5, 0.22) },
    u_palmState: { value: new THREE.Vector3(0.5, 0.5, 0) },
    u_palmThick: { value: 1 },
    u_drops: { value: droplets.uniformData },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  return {
    setWorldTexture(texture) {
      uniforms.u_world.value = texture;
    },
    resize(width, height) {
      uniforms.u_aspect.value = width / Math.max(height, 1);
    },
    update(time, { dim = 1, breathVis = 0, breathPos = null, palm = null, palmThick = 1 } = {}) {
      uniforms.u_time.value = time;
      uniforms.u_fog.value = fog.texture;
      uniforms.u_dim.value = dim;
      uniforms.u_breathVis.value = breathVis;
      if (breathPos) uniforms.u_breathPos.value.set(breathPos.x, breathPos.y);
      if (palm) {
        uniforms.u_palmState.value.set(palm.x, palm.y, palm.active ? Math.max(palm.charge, 0.04) : 0);
      } else {
        uniforms.u_palmState.value.z = 0;
      }
      uniforms.u_palmThick.value = palmThick;
    },
    render(target = null) {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
    },
  };
}
