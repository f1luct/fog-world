// 窗外。一座黑夜里的废墟之城:整条街是一面黑水镜,走一步荡开一圈波纹,
// 两侧楼影亮着零星暖窗,断拱横在头顶,灯笼慢慢漂,月亮很大。
// 街尽头,贩卖机还为没有人亮着。雨一直下。

import * as THREE from "three";
import { createMirrorWater } from "./mirrorwater.js";
import { createRuins } from "./ruins.js";
import { createSteering } from "./steering.js";

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

function makeEnvTexture() {
  // 一张小小的夜:上半冷蓝渐暗,地平线几抹路灯的暖。
  // 没有它,金属和玻璃反射不到任何东西,暗面是死黑。
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, 64);
  sky.addColorStop(0, "#101726");
  sky.addColorStop(0.45, "#080d18");
  sky.addColorStop(0.55, "#100b06");
  sky.addColorStop(1, "#020203");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 128, 64);
  for (const [x, w, a] of [[18, 14, 0.5], [54, 10, 0.35], [86, 16, 0.45], [112, 9, 0.3]]) {
    const blob = ctx.createRadialGradient(x, 33, 0, x, 33, w);
    blob.addColorStop(0, `rgba(255, 178, 110, ${a})`);
    blob.addColorStop(1, "rgba(255, 178, 110, 0)");
    ctx.fillStyle = blob;
    ctx.fillRect(x - w, 33 - w, w * 2, w * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeVendingTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#10131c";
  ctx.fillRect(0, 0, 128, 256);
  const panel = ctx.createLinearGradient(0, 0, 0, 256);
  panel.addColorStop(0, "#cfe8ff");
  panel.addColorStop(0.5, "#9fc4e8");
  panel.addColorStop(1, "#7da8d4");
  ctx.fillStyle = panel;
  ctx.fillRect(10, 12, 78, 180);
  const colors = ["#e85d4a", "#f2b134", "#7ec850", "#4aa8e8", "#e8e3d4"];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      ctx.fillStyle = colors[(row * 4 + col) % colors.length];
      ctx.fillRect(16 + col * 18, 22 + row * 42, 12, 28);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(16 + col * 18, 22 + row * 42, 4, 28);
    }
  }
  ctx.fillStyle = "#bfe2ff";
  ctx.fillRect(96, 12, 8, 220);
  ctx.fillStyle = "#05070c";
  ctx.fillRect(14, 204, 70, 30);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------- 主体

export function createWorld(renderer, cfg, tier, breathPeriod) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060a14);
  // 比上一版浅:废墟之城不阴森,夜是透的。
  scene.fog = new THREE.FogExp2(0x070a14, 0.020);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 320);

  const glowTexture = makeGlowTexture();

  // —— 光:夜空环境 + 月光方向光 + 每盏路灯一个点光源 ——
  scene.add(new THREE.HemisphereLight(0x33415c, 0x0a0c12, 2.8));
  scene.environment = makeEnvTexture();
  scene.environmentIntensity = 0.4;
  const moonLight = new THREE.DirectionalLight(0xbac8e0, 0.55);
  moonLight.position.set(12, 30, -155);
  scene.add(moonLight);

  const frameTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });
  const touchEvents = [];
  const street = cfg.streetLength;

  // ------------------------------------------------ 水镜地面
  const water = createMirrorWater(renderer, {
    width: 64,
    length: 240,
    centerZ: -50,
  });
  scene.add(water.mesh);

  // ------------------------------------------------ 废墟之城
  const ruins = createRuins({ streetHalfWidth: 9, length: street });
  scene.add(ruins.group);

  // ------------------------------------------------ 路灯(残存的,有几盏歪了)
  const lampColor = new THREE.Color(0xffb877);
  const lamps = [];
  const lampDefs = [];
  const poleGeometry = new THREE.CylinderGeometry(0.06, 0.09, 5.2, 12);
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x2b3038,
    metalness: 0.55,
    roughness: 0.4,
  });
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

    if (tier === "full" || i % 2 === 0) {
      const light = new THREE.PointLight(0xffb877, 420, 30, 2);
      light.position.set(0, 5.0, 0);
      lamp.add(light);
    }

    lamp.position.set(x, 0, z);
    // 废墟里的灯有几盏歪着,还坚持亮。
    lamp.rotation.z = [0, 0.06, -0.04, 0, 0.1, 0, -0.07, 0.03][i];
    scene.add(lamp);
    lamps.push({ group: lamp, x, z, glow, lastTouchAt: -100 });
    lampDefs.push({ x, z, r: 0.5 });
  }

  // ------------------------------------------------ 雨
  const rainCount = tier === "full" ? 1500 : 700;
  const rainBoxH = 14;
  let rainMesh = null;
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
    rainMesh = rain;
  }

  function setRainDensity(fraction) {
    rainMesh.geometry.setDrawRange(0, Math.floor(rainCount * fraction) * 2);
  }

  // ------------------------------------------------ 贩卖机(街的尽头)
  const vending = { group: new THREE.Group(), lastTouchAt: -100 };
  {
    const shellMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a3040,
      metalness: 0.6,
      roughness: 0.4,
    });
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.9, 0.75),
      [
        shellMaterial,
        shellMaterial,
        shellMaterial,
        shellMaterial,
        new THREE.MeshStandardMaterial({
          color: 0x05060a,
          emissive: 0xffffff,
          emissiveMap: makeVendingTexture(),
          emissiveIntensity: 0.9,
          roughness: 0.35,
        }),
        shellMaterial,
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
    const vendingLight = new THREE.PointLight(0x9fc8e8, 40, 11, 2);
    vendingLight.position.set(0, 1.2, 0.7);
    vending.group.add(vendingLight);
    vending.group.position.set(3.4, 0, -street + 8);
    vending.group.rotation.y = -0.5;
    scene.add(vending.group);
  }

  // ------------------------------------------------ 远处的城市余光
  for (const [x, z, scaleX, color, opacity] of [
    [-30, -street - 55, 70, 0x3c2616, 0.5],
    [25, 40, 80, 0x32220f, 0.45],
  ]) {
    const cityGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity,
      fog: false,
    }));
    cityGlow.position.set(x, 5, z);
    cityGlow.scale.set(scaleX, 22, 1);
    scene.add(cityGlow);
  }

  // ------------------------------------------------ 避障
  const steering = createSteering(
    [
      ...ruins.colliders,
      ...lampDefs,
      { x: 3.4, z: -street + 8, r: 1.3 }, // 贩卖机
    ],
    { minX: -8, maxX: 8, minZ: -street + 4, maxZ: 5.5 },
  );

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

  // ------------------------------------------------ 导航:漂移 / 步行,皆有避障
  const nav = {
    mode: "drift",
    x: 0.6,
    z: 1.2,
    yaw: 0,
    pitch: 0,
    velX: 0,
    velZ: 0,
    keyBlend: 0,
    lastKeyAt: -10,
    bobPhase: 0,
    lastStepPhase: 0,
  };

  function beginArrival() {
    nav.x = 0.6;
    nav.z = 1.2;
    nav.yaw = 0;
    nav.pitch = 0.06;
    nav.velX = 0;
    nav.velZ = 0;
    nav.keyBlend = 0;
    nav.mode = "drift";
    water.splash(nav.x, nav.z, 0.8, 1.2); // 落地的第一圈
  }

  const carView = { x: 0.5, y: 1.26, z: 2.6, yaw: 0.1, pitch: 0.02 };
  let viewMode = "car";

  function setView(mode) {
    viewMode = mode;
  }

  function updateNav(dt, time, navInput, drag) {
    const walk = cfg.walk;
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

    const sin = Math.sin(nav.yaw);
    const cos = Math.cos(nav.yaw);
    const targetVelX = (navInput.x * cos - navInput.z * sin) * walk.speed;
    const targetVelZ = (-navInput.z * cos - navInput.x * sin) * walk.speed;
    const accel = keyActive ? dt / walk.accelTime : dt / walk.dragTime;
    nav.velX += (targetVelX - nav.velX) * Math.min(accel * 3, 1);
    nav.velZ += (targetVelZ - nav.velZ) * Math.min(accel * 3, 1);

    const driftVelX = -sin * cfg.driftSpeed;
    const driftVelZ = -cos * cfg.driftSpeed;
    const moveX = driftVelX * (1 - nav.keyBlend) + nav.velX * nav.keyBlend;
    const moveZ = driftVelZ * (1 - nav.keyBlend) + nav.velZ * nav.keyBlend;

    // 避障与空气墙:位置由 steering 结算,快撞上就自己偏开。
    const resolved = steering.step({
      x: nav.x, z: nav.z, yaw: nav.yaw, moveX, moveZ, dt,
    });
    nav.x = resolved.x;
    nav.z = resolved.z;
    nav.yaw += resolved.yawNudge;

    const speed = Math.hypot(moveX, moveZ);
    nav.bobPhase += speed * dt * 4.4;

    // 脚步:每跨一步,水面荡开一圈。
    const stepIndex = Math.floor(nav.bobPhase / Math.PI);
    if (stepIndex !== nav.lastStepPhase && speed > 0.3) {
      nav.lastStepPhase = stepIndex;
      water.splash(
        nav.x - sin * 0.35,
        nav.z - cos * 0.35,
        0.5 + Math.min(speed * 0.15, 0.35),
        0.65,
      );
      touchEvents.push({ kind: "step", intensity: Math.min(speed / 2, 1) });
    } else if (speed > 0.05) {
      // 慢漂时水面被轻轻犁开。
      water.stir(nav.x, nav.z, 0.8, time);
    }
  }

  // ------------------------------------------------ 事件检测
  let endNoted = false;
  let archNotedAt = -100;

  function checkEncounters(time) {
    for (const lamp of lamps) {
      const d = Math.hypot(nav.x - lamp.x, nav.z - lamp.z);
      if (d < 2.4 && time - lamp.lastTouchAt > 30) {
        lamp.lastTouchAt = time;
        touchEvents.push({ kind: "lamp" });
      }
    }
    // 断拱下(z≈-44 横跨街道)。
    if (Math.abs(nav.z + 44) < 2 && Math.abs(nav.x) < 6 && time - archNotedAt > 60) {
      archNotedAt = time;
      touchEvents.push({ kind: "arch" });
    }
    {
      const d = Math.hypot(nav.x - 3.4, nav.z - (-street + 8));
      if (d < 2.8 && time - vending.lastTouchAt > 40) {
        vending.lastTouchAt = time;
        touchEvents.push({ kind: "vending" });
      }
    }
    if (!endNoted && nav.z < -street + 12) {
      endNoted = true;
      touchEvents.push({ kind: "end" });
    }
  }

  // ------------------------------------------------ 主更新
  function update(dt, time, breathCycle, navInput = null, drag = { x: 0, y: 0 }) {
    rainUniforms.u_time.value = time;

    if (viewMode === "car") {
      camera.position.set(carView.x, carView.y, carView.z);
      camera.rotation.set(carView.pitch, carView.yaw, 0, "YXZ");
    } else {
      updateNav(dt, time, navInput ?? { x: 0, z: 0, active: false }, drag);
      const bob = Math.sin(nav.bobPhase) * 0.035;
      const sway = Math.sin(time * (Math.PI * 2) / breathPeriod) * 0.02;
      camera.position.set(nav.x, 1.52 + bob + sway, nav.z);
      camera.rotation.set(nav.pitch, nav.yaw, Math.sin(nav.bobPhase * 0.5) * 0.004, "YXZ");
      checkEncounters(time);
    }

    rainUniforms.u_center.value.copy(camera.position);

    // 水镜模拟域跟着镜头走。
    water.update(dt, time, camera.position.x, camera.position.z);

    // 废墟:窗的微闪、灯笼的漂移。
    ruins.update(dt, time);

    // 路灯轻微呼吸 + 偶尔闪一下。
    for (let i = 0; i < lamps.length; i++) {
      const lamp = lamps[i];
      let flicker = 0.85 + 0.07 * Math.sin(time * 1.3 + i * 2.1);
      if (Math.sin(time * 17 + i * 31.7) > 0.996) flicker *= 0.6;
      lamp.glow.material.opacity = flicker;
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
    const scale = 0.6;
    frameTarget.setSize(
      Math.max(2, Math.round(width * pixelRatio * scale)),
      Math.max(2, Math.round(height * pixelRatio * scale)),
    );
    water.resize(width, height, pixelRatio);
  }

  function render(toScreen) {
    // 先渲水镜的倒影(内部会临时藏起水面自己)。
    water.renderReflection(scene, camera);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(toScreen ? null : frameTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
  }

  function consumeTouchEvents() {
    return touchEvents.splice(0, touchEvents.length);
  }

  function warmup() {
    render(false);
  }

  function setQuality(level) {
    water.setQuality(level);
  }

  return {
    update,
    render,
    resize,
    setView,
    beginArrival,
    breathPuff,
    consumeTouchEvents,
    warmup,
    setRainDensity,
    setQuality,
    summonLanternPass: () => ruins.summonLanternPass(nav.x, nav.z),
    nav,
    scene,
    camera,
    get frameTexture() {
      return frameTarget.texture;
    },
    get debug() {
      return {
        navMode: nav.mode,
        x: Number(nav.x.toFixed(1)),
        z: Number(nav.z.toFixed(1)),
      };
    },
  };
}
