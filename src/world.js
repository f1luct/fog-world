// 窗外。一条冬夜的雨街:路灯把雨照成细针，湿沥青拖着灯光的倒影，
// 偶尔一辆车驶过。站台下有只猫，街尽头一台贩卖机为没有人亮着。
// 没有真实光照——全是自发光、叠加混合和雾，夜自己会把其余补齐。

import * as THREE from "three";

// ---------------------------------------------------------------- 纹理工厂

function makeGlowTexture(size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function makeStreakTexture() {
  // 湿路面上拖长的灯光倒影:一端亮、一端散。
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.3, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  // 横向也收个软边
  const side = ctx.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, "rgba(0,0,0,1)");
  side.addColorStop(0.25, "rgba(0,0,0,0)");
  side.addColorStop(0.75, "rgba(0,0,0,0)");
  side.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(canvas);
}

function makeVendingTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#10131c";
  ctx.fillRect(0, 0, 128, 256);
  // 发光的灯箱面板
  const panel = ctx.createLinearGradient(0, 0, 0, 256);
  panel.addColorStop(0, "#cfe8ff");
  panel.addColorStop(0.5, "#9fc4e8");
  panel.addColorStop(1, "#7da8d4");
  ctx.fillStyle = panel;
  ctx.fillRect(10, 12, 78, 180);
  // 一排排饮料
  const colors = ["#e85d4a", "#f2b134", "#7ec850", "#4aa8e8", "#e8e3d4"];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      ctx.fillStyle = colors[(row * 4 + col) % colors.length];
      ctx.fillRect(16 + col * 18, 22 + row * 42, 12, 28);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(16 + col * 18, 22 + row * 42, 4, 28);
    }
  }
  // 侧边蓝色灯带
  ctx.fillStyle = "#bfe2ff";
  ctx.fillRect(96, 12, 8, 220);
  // 取物口
  ctx.fillStyle = "#05070c";
  ctx.fillRect(14, 204, 70, 30);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------- 主体

export function createWorld(renderer, cfg, tier, breathPeriod) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060b);
  scene.fog = new THREE.FogExp2(0x05070d, 0.026);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 260);

  const glowTexture = makeGlowTexture();
  const streakTexture = makeStreakTexture();

  const frameTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });

  const touchEvents = [];
  const street = cfg.streetLength;

  // ------------------------------------------------ 地面:湿沥青
  const groundMaterial = new THREE.ShaderMaterial({
    uniforms: {
      u_time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 v_world;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        v_world = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 v_world;
      uniform float u_time;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      void main() {
        vec2 p = v_world.xz;
        float n = hash(floor(p * 6.0)) * 0.5 + hash(floor(p * 23.0)) * 0.5;
        // 湿沥青:深蓝黑，颗粒里偶尔闪一粒雨光。
        vec3 color = vec3(0.030, 0.036, 0.052) * (0.75 + 0.5 * n);
        float sparkle = step(0.992, hash(floor(p * 31.0) + floor(u_time * 2.0)));
        color += vec3(0.20, 0.22, 0.26) * sparkle;
        // 街心略亮(车道磨光)，路缘更深。
        float lane = exp(-abs(v_world.x) * 0.28);
        color += vec3(0.012, 0.014, 0.018) * lane;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    fog: false,
  });
  // 手写雾衰减太啰嗦，地面直接用大平面 + 场景雾即可——改回内置材质。
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, street + 120),
    groundMaterial,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -street / 2 + 10;
  scene.add(ground);

  // ------------------------------------------------ 路灯
  const lampColor = new THREE.Color(0xffb877);
  const lamps = [];
  const reflectionStreaks = [];
  const poleGeometry = new THREE.CylinderGeometry(0.06, 0.09, 5.2, 6);
  const poleMaterial = new THREE.MeshBasicMaterial({ color: 0x0a0c10 });
  const coneMaterial = new THREE.ShaderMaterial({
    uniforms: { u_color: { value: lampColor } },
    vertexShader: /* glsl */ `
      varying float v_y;
      void main() {
        v_y = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float v_y;
      uniform vec3 u_color;
      void main() {
        // 顶端贴着灯头最亮,向下很快散没——雨雾里的光锥是渐隐的,不是帐篷。
        float a = pow(v_y, 3.2) * 0.055;
        gl_FragColor = vec4(u_color, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  for (let i = 0; i < 8; i++) {
    const z = -8 - i * 14;
    const x = i % 2 === 0 ? -4.2 : 4.2;
    const lamp = new THREE.Group();

    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.y = 2.6;
    lamp.add(pole);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe2b0 }),
    );
    head.position.set(0, 5.15, 0);
    lamp.add(head);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: lampColor,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.85,
    }));
    glow.position.set(0, 5.15, 0);
    glow.scale.setScalar(3.4);
    lamp.add(glow);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: lampColor,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.22,
    }));
    halo.position.set(0, 5.15, 0);
    halo.scale.setScalar(9);
    lamp.add(halo);

    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 2.3, 5.0, 12, 1, true),
      coneMaterial,
    );
    cone.position.y = 2.6;
    lamp.add(cone);

    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        color: lampColor,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.02;
    lamp.add(pool);

    lamp.position.set(x, 0, z);
    scene.add(lamp);
    lamps.push({ group: lamp, x, z, glow, lastTouchAt: -100 });

    // 倒影长条:每帧转向镜头。
    const streak = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 9),
      new THREE.MeshBasicMaterial({
        map: streakTexture,
        color: lampColor,
        transparent: true,
        opacity: 0.30,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    streak.rotation.x = -Math.PI / 2;
    streak.position.set(x, 0.03, z);
    scene.add(streak);
    reflectionStreaks.push({ mesh: streak, x, z, seed: Math.random() * 10 });
  }

  // ------------------------------------------------ 雨
  const rainCount = tier === "full" ? 1500 : 700;
  const rainBoxH = 14;
  {
    const positions = new Float32Array(rainCount * 2 * 3);
    const seeds = new Float32Array(rainCount * 2);
    const tips = new Float32Array(rainCount * 2);
    for (let i = 0; i < rainCount; i++) {
      const x = (Math.random() - 0.5) * 36;
      const y = Math.random() * rainBoxH;
      const z = (Math.random() - 0.5) * 36;
      const seed = Math.random();
      for (let v = 0; v < 2; v++) {
        const o = (i * 2 + v) * 3;
        positions[o] = x;
        positions[o + 1] = y;
        positions[o + 2] = z;
        seeds[i * 2 + v] = seed;
        tips[i * 2 + v] = v;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute("tip", new THREE.BufferAttribute(tips, 1));
    var rainUniforms = {
      u_time: { value: 0 },
      u_center: { value: new THREE.Vector3() },
      u_wind: { value: 0.5 },
    };
    const rain = new THREE.LineSegments(geometry, new THREE.ShaderMaterial({
      uniforms: rainUniforms,
      vertexShader: /* glsl */ `
        attribute float seed;
        attribute float tip;
        uniform float u_time;
        uniform vec3 u_center;
        uniform float u_wind;
        varying float v_alpha;
        void main() {
          float speed = 7.5 + seed * 4.5;
          float y = mod(position.y - u_time * speed, ${rainBoxH.toFixed(1)});
          float len = (0.30 + seed * 0.28) * tip;
          vec3 wp = vec3(
            position.x + u_center.x + u_wind * (y + len) * 0.07,
            y + len,
            position.z + u_center.z
          );
          float dist = length(wp.xz - u_center.xz);
          v_alpha = (0.10 + seed * 0.12) * smoothstep(19.0, 6.0, dist);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float v_alpha;
        void main() {
          gl_FragColor = vec4(0.62, 0.70, 0.82, v_alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    rain.frustumCulled = false;
    scene.add(rain);
  }

  // ------------------------------------------------ 水洼
  const puddles = [];
  const puddleDefs = [
    { x: -1.6, z: -16, r: 1.5 },
    { x: 2.4, z: -33, r: 1.1 },
    { x: -3.0, z: -52, r: 1.8 },
    { x: 0.8, z: -70, r: 1.3 },
    { x: -1.2, z: -88, r: 1.5 },
  ];
  for (const def of puddleDefs) {
    const uniforms = {
      u_time: { value: 0 },
      u_splash: { value: 0 },
      u_warm: { value: 0.4 + Math.random() * 0.5 },
    };
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(def.r, 28),
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: /* glsl */ `
          varying vec2 v_local;
          void main() {
            v_local = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 v_local;
          uniform float u_time;
          uniform float u_splash;
          uniform float u_warm;
          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }
          void main() {
            float r = length(v_local);
            // 水面本体:比沥青更深的一面暗镜，朝灯的方向带点暖。
            vec3 color = vec3(0.018, 0.024, 0.038);
            color += vec3(0.05, 0.035, 0.02) * u_warm * (0.4 + 0.3 * v_local.y);
            // 雨点的环:两层随机相位的扩散圆。
            float rings = 0.0;
            for (int layer = 0; layer < 2; layer++) {
              float fl = float(layer);
              vec2 p = v_local * (1.8 + fl * 1.4) + fl * 3.7;
              vec2 cell = floor(p);
              vec2 f = fract(p) - 0.5;
              float h = hash(cell + fl * 13.0);
              float phase = fract(u_time * (0.45 + 0.35 * h) + h * 7.0);
              vec2 jitter = vec2(hash(cell + 1.3), hash(cell + 4.7)) * 0.4 - 0.2;
              float ringR = phase * 0.42;
              float ring = smoothstep(0.05, 0.0, abs(length(f - jitter) - ringR));
              rings += ring * (1.0 - phase) * (0.5 + u_splash * 2.0);
            }
            color += vec3(0.35, 0.38, 0.42) * rings * 0.30;
            float alpha = smoothstep(1.0, 0.78, r / ${"1.0"});
            gl_FragColor = vec4(color, alpha * 0.92);
          }
        `,
        transparent: true,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(def.x, 0.025, def.z);
    mesh.scale.setScalar(def.r);
    mesh.geometry.scale(1 / def.r, 1 / def.r, 1); // 让 v_local 归一化到单位圆
    scene.add(mesh);
    puddles.push({ ...def, uniforms, lastSplashAt: -100 });
  }

  // ------------------------------------------------ 你的车(起点)
  const car = new THREE.Group();
  {
    const bodyMaterial = new THREE.MeshBasicMaterial({ color: 0x0b0e14 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 4.4), bodyMaterial);
    body.position.y = 0.62;
    car.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 2.4), bodyMaterial);
    cabin.position.set(0, 1.36, -0.2);
    car.add(cabin);
    // 你刚才坐的位置，窗里还留着一点暖。
    const windowGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.42),
      new THREE.MeshBasicMaterial({
        color: 0xffc488,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    windowGlow.position.set(-0.86, 1.32, 0.4);
    windowGlow.rotation.y = -Math.PI / 2;
    car.add(windowGlow);
    const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffc488,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.3,
    }));
    innerGlow.position.set(-0.9, 1.3, 0.4);
    innerGlow.scale.setScalar(1.6);
    car.add(innerGlow);
    car.position.set(1.9, 0, 2.8);
    car.rotation.y = 0.04;
    scene.add(car);
  }

  // ------------------------------------------------ 公交站台与猫
  const shelter = new THREE.Group();
  const cat = { eyes: [], group: null, lastTouchAt: -100 };
  {
    const frameMaterial = new THREE.MeshBasicMaterial({ color: 0x0c0f15 });
    for (const px of [-1.5, 1.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.08), frameMaterial);
      post.position.set(px, 1.2, 0);
      shelter.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 1.4), frameMaterial);
    roof.position.y = 2.4;
    shelter.add(roof);
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 1.8),
      new THREE.MeshBasicMaterial({
        color: 0x16202e,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    );
    back.position.set(0, 1.4, -0.62);
    shelter.add(back);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.07, 0.4), frameMaterial);
    bench.position.set(0, 0.46, -0.3);
    shelter.add(bench);

    // 猫:一团蹲着的暗影 + 两点会眨的眼。
    const catGroup = new THREE.Group();
    const blob = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x07090d }),
    );
    blob.scale.set(1, 0.85, 1.3);
    catGroup.add(blob);
    const headBlob = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x07090d }),
    );
    headBlob.position.set(0, 0.12, 0.14);
    catGroup.add(headBlob);
    for (const ex of [-0.035, 0.035]) {
      const eye = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xc8e89a,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.9,
      }));
      eye.position.set(ex, 0.13, 0.23);
      eye.scale.setScalar(0.05);
      catGroup.add(eye);
      cat.eyes.push(eye);
    }
    catGroup.position.set(0.9, 0.14, -0.32);
    catGroup.rotation.y = -0.5;
    shelter.add(catGroup);
    cat.group = catGroup;

    shelter.position.set(-3.6, 0, -48);
    shelter.rotation.y = 0.08;
    scene.add(shelter);
  }

  // ------------------------------------------------ 贩卖机(街的尽头)
  const vending = { group: new THREE.Group(), lastTouchAt: -100, hummed: false };
  {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.9, 0.75),
      [
        new THREE.MeshBasicMaterial({ color: 0x10131c }),
        new THREE.MeshBasicMaterial({ color: 0x10131c }),
        new THREE.MeshBasicMaterial({ color: 0x10131c }),
        new THREE.MeshBasicMaterial({ color: 0x10131c }),
        new THREE.MeshBasicMaterial({ map: makeVendingTexture() }),
        new THREE.MeshBasicMaterial({ color: 0x10131c }),
      ],
    );
    box.position.y = 0.95;
    vending.group.add(box);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0x9fc8e8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.4,
    }));
    glow.position.set(0, 1.1, 0.5);
    glow.scale.set(2.6, 3.2, 1);
    vending.group.add(glow);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        color: 0x9fc8e8,
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.03, 0.8);
    vending.group.add(pool);
    vending.group.position.set(3.4, 0, -street + 8);
    vending.group.rotation.y = -0.5;
    scene.add(vending.group);

    // 它的倒影。
    const streak = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 5),
      new THREE.MeshBasicMaterial({
        map: streakTexture,
        color: 0x9fc8e8,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    streak.rotation.x = -Math.PI / 2;
    streak.position.set(3.4, 0.03, -street + 8);
    scene.add(streak);
    reflectionStreaks.push({ mesh: streak, x: 3.4, z: -street + 8, seed: 3 });
  }

  // ------------------------------------------------ 远处的城市光
  for (const [x, z, scaleX, color, opacity] of [
    [0, -street - 50, 110, 0x52301a, 0.85],
    [-35, -street - 40, 60, 0x3c2616, 0.6],
    [25, 40, 80, 0x32220f, 0.45],
  ]) {
    const cityGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity,
      fog: false, // 它在雾的另一头:整片城市隔着雨发亮
    }));
    cityGlow.position.set(x, 5, z);
    cityGlow.scale.set(scaleX, 22, 1);
    scene.add(cityGlow);
  }

  // ------------------------------------------------ 过路车
  const passingCar = {
    active: false,
    group: new THREE.Group(),
    startAt: 0,
    duration: 8,
    fromZ: 0,
    toZ: 0,
    noted: false,
  };
  {
    for (const hx of [-0.55, 0.55]) {
      const head = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xfff2cc,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.95,
      }));
      head.position.set(hx, 0.65, -2.1); // 车头朝 -z(行驶方向)
      head.scale.setScalar(1.5);
      passingCar.group.add(head);
      const tail = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xff3826,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.8,
      }));
      tail.position.set(hx, 0.6, 2.1); // 从背后赶上来时,你看见的是这两点红
      tail.scale.setScalar(0.7);
      passingCar.group.add(tail);
    }
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.3, 4.3),
      new THREE.MeshBasicMaterial({ color: 0x0a0d12 }),
    );
    body.position.y = 0.75;
    passingCar.group.add(body);
    const splashGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0x8898ac,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.25,
    }));
    splashGlow.position.set(0, 0.3, 0);
    splashGlow.scale.set(4, 1.2, 1);
    passingCar.group.add(splashGlow);
    // 头灯倒影
    const streak = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 11),
      new THREE.MeshBasicMaterial({
        map: streakTexture,
        color: 0xfff2cc,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    streak.rotation.x = -Math.PI / 2;
    streak.rotation.z = Math.PI; // 亮端朝车头(-z 侧)
    streak.position.set(0, 0.04, -7);
    passingCar.group.add(streak);
    passingCar.group.visible = false;
    scene.add(passingCar.group);
  }

  function summonCarPass() {
    if (passingCar.active) return;
    passingCar.active = true;
    passingCar.noted = false;
    passingCar.startAt = -1; // 下一帧填充
    passingCar.group.visible = true;
  }

  // ------------------------------------------------ 呼出的白气
  const puffs = [];
  const puffPool = [];
  for (let i = 0; i < 6; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xdde4ea,
      blending: THREE.NormalBlending,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    sprite.visible = false;
    scene.add(sprite);
    puffPool.push(sprite);
  }

  function breathPuff() {
    const sprite = puffPool.find((s) => !s.visible);
    if (!sprite) return;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    sprite.position.copy(camera.position)
      .addScaledVector(dir, 0.9)
      .add(new THREE.Vector3(0, -0.25, 0));
    sprite.visible = true;
    puffs.push({
      sprite,
      velocity: dir.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0.12, 0)),
      age: 0,
      life: 2.4,
    });
  }

  // ------------------------------------------------ 导航:漂移 / 步行
  const nav = {
    mode: "drift",
    x: 0.6,
    z: 1.2,
    yaw: 0,        // 0 = 朝 -z(街的深处)
    pitch: 0,
    velX: 0,
    velZ: 0,
    keyBlend: 0,   // 0 漂移 1 步行
    lastKeyAt: -10,
    bobPhase: 0,
  };

  function beginArrival() {
    nav.x = 0.6;
    nav.z = 1.2;
    nav.yaw = 0;
    nav.pitch = 0.06; // 到外面第一眼:微微抬头看雨
    nav.velX = 0;
    nav.velZ = 0;
    nav.keyBlend = 0;
    nav.mode = "drift";
  }

  // 车窗视角(车里看出去),微微偏向有灯的那侧。
  const carView = { x: 0.5, y: 1.26, z: 2.6, yaw: 0.1, pitch: 0.02 };
  let viewMode = "car";

  function setView(mode) {
    viewMode = mode;
  }

  function updateNav(dt, time, navInput, drag) {
    const walk = cfg.walk;
    // 拖动永远在转头。
    nav.yaw -= drag.x * walk.lookSpeed;
    nav.pitch = Math.max(
      -walk.maxPitch,
      Math.min(walk.maxPitch, nav.pitch + drag.y * walk.lookSpeed * 0.7),
    );

    const keyActive = navInput.active;
    if (keyActive) nav.lastKeyAt = time;
    const wantWalk = time - nav.lastKeyAt < walk.idleReturn;
    const blendRate = wantWalk ? dt / walk.blendIn : dt / walk.blendOut;
    nav.keyBlend += ((wantWalk ? 1 : 0) - nav.keyBlend) * Math.min(blendRate * 3, 1);
    nav.mode = nav.keyBlend > 0.5 ? "walk" : "drift";

    // 步行速度(沿视线方向)。
    const sin = Math.sin(nav.yaw);
    const cos = Math.cos(nav.yaw);
    const targetVelX = (navInput.x * cos - navInput.z * sin) * walk.speed;
    const targetVelZ = (-navInput.z * cos - navInput.x * sin) * walk.speed;
    const accel = keyActive ? dt / walk.accelTime : dt / walk.dragTime;
    nav.velX += (targetVelX - nav.velX) * Math.min(accel * 3, 1);
    nav.velZ += (targetVelZ - nav.velZ) * Math.min(accel * 3, 1);

    // 漂移:夜带着你慢慢往街深处走(沿视线水平投影)。
    const driftVelX = -sin * cfg.driftSpeed;
    const driftVelZ = -cos * cfg.driftSpeed;

    const moveX = driftVelX * (1 - nav.keyBlend) + nav.velX * nav.keyBlend;
    const moveZ = driftVelZ * (1 - nav.keyBlend) + nav.velZ * nav.keyBlend;
    nav.x += moveX * dt;
    nav.z += moveZ * dt;

    // 街的边界。
    nav.x = Math.max(-6.5, Math.min(6.5, nav.x));
    nav.z = Math.max(-street + 4, Math.min(5.5, nav.z));

    nav.bobPhase += Math.hypot(moveX, moveZ) * dt * 4.4;
  }

  // ------------------------------------------------ 事件检测
  let endNoted = false;

  function checkEncounters(time) {
    // 路灯:走进光锥。
    for (const lamp of lamps) {
      const d = Math.hypot(nav.x - lamp.x, nav.z - lamp.z);
      if (d < 2.4 && time - lamp.lastTouchAt > 30) {
        lamp.lastTouchAt = time;
        touchEvents.push({ kind: "lamp" });
      }
    }
    // 水洼:踩进去。
    for (const puddle of puddles) {
      const d = Math.hypot(nav.x - puddle.x, nav.z - puddle.z);
      if (d < puddle.r * 0.9 && time - puddle.lastSplashAt > 6) {
        puddle.lastSplashAt = time;
        puddle.uniforms.u_splash.value = 1;
        touchEvents.push({ kind: "puddle" });
      }
    }
    // 猫。
    {
      const d = Math.hypot(nav.x - (-2.7), nav.z - (-48.3));
      if (d < 2.6 && time - cat.lastTouchAt > 45) {
        cat.lastTouchAt = time;
        touchEvents.push({ kind: "cat" });
      }
    }
    // 贩卖机。
    {
      const d = Math.hypot(nav.x - 3.4, nav.z - (-street + 8));
      if (d < 2.8 && time - vending.lastTouchAt > 40) {
        vending.lastTouchAt = time;
        touchEvents.push({ kind: "vending" });
      }
    }
    // 街的尽头。
    if (!endNoted && nav.z < -street + 12) {
      endNoted = true;
      touchEvents.push({ kind: "end" });
    }
  }

  // ------------------------------------------------ 主更新
  function update(dt, time, breathCycle, navInput = null, drag = { x: 0, y: 0 }) {
    groundMaterial.uniforms.u_time.value = time;
    rainUniforms.u_time.value = time;

    if (viewMode === "car") {
      camera.position.set(carView.x, carView.y, carView.z);
      camera.rotation.set(carView.pitch, carView.yaw, 0, "YXZ");
      car.visible = false; // 自己的车,从里面看不见
    } else {
      car.visible = true;
      updateNav(dt, time, navInput ?? { x: 0, z: 0, active: false }, drag);
      const bob = Math.sin(nav.bobPhase) * 0.035;
      const sway = Math.sin(time * (Math.PI * 2) / breathPeriod) * 0.02;
      camera.position.set(nav.x, 1.52 + bob + sway, nav.z);
      camera.rotation.set(nav.pitch, nav.yaw, Math.sin(nav.bobPhase * 0.5) * 0.004, "YXZ");
      checkEncounters(time);
    }

    rainUniforms.u_center.value.copy(camera.position);

    // 倒影长条朝向镜头。
    for (const streak of reflectionStreaks) {
      const dx = camera.position.x - streak.x;
      const dz = camera.position.z - streak.z;
      const len = Math.hypot(dx, dz) || 1;
      const reach = Math.min(4.5 + len * 0.18, 9);
      streak.mesh.rotation.z = Math.atan2(dx / len, dz / len);
      streak.mesh.position.set(
        streak.x + (dx / len) * reach * 0.5,
        streak.mesh.position.y,
        streak.z + (dz / len) * reach * 0.5,
      );
      streak.mesh.scale.y = reach / 9;
      streak.mesh.material.opacity = 0.22 + 0.08 * Math.sin(time * 11 + streak.seed * 7);
    }

    // 路灯轻微呼吸 + 偶尔闪一下。
    for (let i = 0; i < lamps.length; i++) {
      const lamp = lamps[i];
      let flicker = 0.85 + 0.07 * Math.sin(time * 1.3 + i * 2.1);
      if (Math.sin(time * 17 + i * 31.7) > 0.996) flicker *= 0.6;
      lamp.glow.material.opacity = flicker;
    }

    // 水洼涟漪衰减。
    for (const puddle of puddles) {
      puddle.uniforms.u_time.value = time;
      puddle.uniforms.u_splash.value = Math.max(puddle.uniforms.u_splash.value - dt * 0.8, 0);
    }

    // 猫眨眼:每 3–6 秒闭 0.12 秒。
    {
      const blinkSeed = Math.floor(time / 4.3);
      const blinkPhase = time / 4.3 - blinkSeed;
      const closed = blinkPhase > 0.93 && blinkPhase < 0.96;
      for (const eye of cat.eyes) {
        eye.scale.y = closed ? 0.006 : 0.05;
      }
    }

    // 过路车。
    if (passingCar.active) {
      if (passingCar.startAt < 0) {
        passingCar.startAt = time;
        passingCar.fromZ = camera.position.z + 26;
        passingCar.toZ = camera.position.z - 70;
        passingCar.duration = 8;
      }
      const progress = (time - passingCar.startAt) / passingCar.duration;
      if (progress >= 1) {
        passingCar.active = false;
        passingCar.group.visible = false;
      } else {
        const z = passingCar.fromZ + (passingCar.toZ - passingCar.fromZ) * progress;
        passingCar.group.position.set(-2.4, 0, z);
        if (!passingCar.noted && z < camera.position.z + 4 && z > camera.position.z - 8) {
          passingCar.noted = true;
          touchEvents.push({ kind: "car", pan: -0.6 });
        }
      }
    }

    // 白气。
    for (let i = puffs.length - 1; i >= 0; i--) {
      const puff = puffs[i];
      puff.age += dt;
      const k = puff.age / puff.life;
      if (k >= 1) {
        puff.sprite.visible = false;
        puffs.splice(i, 1);
        continue;
      }
      puff.sprite.position.addScaledVector(puff.velocity, dt);
      puff.velocity.multiplyScalar(1 - dt * 0.8);
      puff.sprite.scale.setScalar(0.25 + k * 1.1);
      puff.sprite.material.opacity = 0.34 * (1 - k) * Math.min(k * 8, 1);
    }
  }

  function resize(width, height, pixelRatio) {
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    // 帧纹理:透过雾看本来就糊,降一档分辨率把预算留给世界本身。
    const scale = 0.6;
    frameTarget.setSize(
      Math.max(2, Math.round(width * pixelRatio * scale)),
      Math.max(2, Math.round(height * pixelRatio * scale)),
    );
  }

  function render(toScreen) {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(toScreen ? null : frameTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
  }

  function consumeTouchEvents() {
    return touchEvents.splice(0, touchEvents.length);
  }

  function warmup() {
    // 趁玩家还在擦玻璃,先把整套着色器编译掉,穿越时不掉帧。
    render(false);
  }

  return {
    update,
    render,
    resize,
    setView,
    beginArrival,
    summonCarPass,
    breathPuff,
    consumeTouchEvents,
    warmup,
    nav,
    get frameTexture() {
      return frameTarget.texture;
    },
    get debug() {
      return {
        navMode: nav.mode,
        x: Number(nav.x.toFixed(1)),
        z: Number(nav.z.toFixed(1)),
        carPass: passingCar.active,
      };
    },
  };
}
