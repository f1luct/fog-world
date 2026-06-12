// 穿越。去程：掌印融穿玻璃——洞口从手掌处烧开，边缘挂着水、卷着雾，
// 越张越大，整个人从洞里到了外面。回程：霜雾从四边爬回来，把世界
// 重新蒙进玻璃里。纯屏幕空间，两张帧纹理之间的事。

import * as THREE from "three";

const FRAGMENT = /* glsl */ `
  precision highp float;

  varying vec2 v_uv;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_progress;
  uniform vec2 u_focus;
  uniform float u_aspect;
  uniform float u_frost;     // 0 = 融穿出去，1 = 结霜回来
  uniform float u_time;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    v += noise(p) * 0.5;
    v += noise(p * 2.13) * 0.28;
    v += noise(p * 4.41) * 0.16;
    return v;
  }

  void main() {
    float p = clamp(u_progress, 0.0, 1.0);
    vec2 scale = vec2(u_aspect, 1.0);
    vec2 d0 = (v_uv - u_focus) * scale;
    float r0 = length(d0);

    // —— 洞口边界 ——
    // 去程：从掌心向外长；回程：霜从四边向中心收。
    float boundary;
    float rough = fbm(d0 * 4.0 + u_time * 0.15) - 0.5;
    if (u_frost < 0.5) {
      float grow = smoothstep(0.04, 0.86, p);
      float holeR = grow * grow * 1.9 + smoothstep(0.0, 0.18, p) * 0.12;
      boundary = r0 - holeR - rough * 0.16 * (1.0 - grow * 0.5);
    } else {
      vec2 edgeDist = min(v_uv, 1.0 - v_uv);
      float fromEdge = min(edgeDist.x * u_aspect, edgeDist.y);
      float creep = smoothstep(0.0, 0.9, p) * 0.85;
      boundary = creep - fromEdge - rough * 0.2;
      boundary = -boundary; // 统一符号：boundary < 0 处显示 u_to
    }

    float inside = smoothstep(0.015, -0.015, boundary);
    float rimBand = smoothstep(0.07, 0.0, abs(boundary));

    // —— 旧侧：靠近洞口的雾被卷开 ——
    float curl = rimBand * (1.0 - p * 0.4);
    vec2 curlDir = r0 > 0.0001 ? d0 / r0 : vec2(0.0);
    vec2 swirl = vec2(-curlDir.y, curlDir.x) * 0.5;
    vec2 fromUv = clamp(
      v_uv + (curlDir + swirl) / scale * curl * 0.06 +
        vec2(0.0, -0.5) / scale * curl * fbm(d0 * 7.0 + u_time * 0.4) * 0.05,
      0.002, 0.998
    );
    vec3 fromColor = texture2D(u_from, fromUv).rgb;

    // —— 新侧：从洞里看出去，镜头缓缓凑近 ——
    float dolly = (1.0 - p) * 0.06;
    vec2 toUv = clamp(u_focus + (v_uv - u_focus) * (1.0 - dolly), 0.002, 0.998);
    vec3 toColor = texture2D(u_to, toUv).rgb;

    vec3 color = mix(fromColor, toColor, inside);

    // —— 洞缘 ——
    if (u_frost < 0.5) {
      // 暖融的边：体温烧开冰玻璃，挂着将落未落的水。
      vec3 meltRim = mix(vec3(0.55, 0.6, 0.68), vec3(1.0, 0.66, 0.34), 0.6);
      color += meltRim * rimBand * (0.5 + 0.3 * fbm(d0 * 9.0 - u_time * 0.6));
      // 洞缘往下淌的水线。
      float dripNoise = fbm(vec2(v_uv.x * 30.0, v_uv.y * 3.0 - u_time * 0.8));
      float below = smoothstep(0.0, -0.12, d0.y) * rimBand;
      color += vec3(0.5, 0.56, 0.62) * below * smoothstep(0.55, 0.8, dripNoise) * 0.6;
    } else {
      // 冷霜的边：细小冰晶白。
      color += vec3(0.72, 0.78, 0.85) * rimBand *
        (0.4 + 0.4 * fbm(d0 * 14.0 + u_time * 0.2));
    }

    // 穿过的一瞬：一层薄亮。
    float flash = exp(-pow((p - 0.5) / 0.12, 2.0));
    vec3 veil = u_frost < 0.5 ? vec3(0.85, 0.82, 0.78) : vec3(0.78, 0.82, 0.88);
    color = mix(color, veil, flash * 0.45);

    // 边缘暗角收一收注意力。
    color *= 1.0 - smoothstep(0.5, 1.2, r0) * 0.35 * (1.0 - inside * 0.5);

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

export function createCrossing(renderer) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    u_from: { value: null },
    u_to: { value: null },
    u_progress: { value: 0 },
    u_focus: { value: new THREE.Vector2(0.5, 0.5) },
    u_aspect: { value: 1 },
    u_frost: { value: 0 },
    u_time: { value: 0 },
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
    setFocus(x, y) {
      uniforms.u_focus.value.set(x, y);
    },
    setTextures(fromTexture, toTexture) {
      uniforms.u_from.value = fromTexture;
      uniforms.u_to.value = toTexture;
    },
    setFrost(frost) {
      uniforms.u_frost.value = frost ? 1 : 0;
    },
    resize(width, height) {
      uniforms.u_aspect.value = width / Math.max(height, 1);
    },
    render(progress, time) {
      uniforms.u_progress.value = progress;
      uniforms.u_time.value = time;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
    },
  };
}
