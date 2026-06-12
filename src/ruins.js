// 废墟之城。整条街沉在黑色水镜上,两侧楼影残缺却温柔:
// 零星暖窗还亮着,断拱横在街心,几盏不属于任何人的灯笼在雨里慢慢漂,
// 街的尽头悬着一轮大而苍白的满月——废墟不阴森,它只是安静。

import * as THREE from "three";

// ---------------------------------------------------------------- 纹理工厂

function makeGlowTexture(size = 128) {
  // 白色径向渐变,颜色交给 Sprite 自己染——灯笼、月晕共用一张。
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

// ---------------------------------------------------------------- 主体

export function createRuins(opts = {}) {
  const streetHalfWidth = opts.streetHalfWidth ?? 9;
  const length = opts.length ?? 110;

  const group = new THREE.Group();
  const colliders = [];
  const glowTexture = makeGlowTexture();

  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const sign = () => (Math.random() < 0.5 ? -1 : 1);

  // 共享材质与几何:整城的楼都从这两桶涂料里来,窗格全用同一块玻璃。
  const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x232a38, roughness: 0.85 });
  const skylineMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1f2b, roughness: 0.9 });
  const warmWindowMaterial = new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true });
  const coolWindowMaterial = new THREE.MeshBasicMaterial({ color: 0x9fd0e8, transparent: true });
  const windowGeometry = new THREE.PlaneGeometry(0.5, 0.7);

  // ------------------------------------------------ 亮窗
  // 大多数窗是黑的(根本不画),亮着的是少数:在立面网格上稀疏撒几格。
  const flickerWindows = []; // 其中约 1/4 在 update 里极轻地闪

  function addWindows(tower, side, w, d, h, maxCount) {
    const cols = Math.max(1, Math.floor((d - 1) / 1.1));
    const rows = Math.max(1, Math.floor((h - 2) / 1.5));
    const count = Math.min(2 + Math.floor(Math.random() * 7), maxCount, cols * rows);
    const used = new Set();
    for (let i = 0; i < count; i++) {
      const cell = Math.floor(Math.random() * cols * rows);
      if (used.has(cell)) continue; // 撞了格就少亮一扇,废墟不在乎
      used.add(cell);
      const col = cell % cols;
      const row = Math.floor(cell / cols);
      let material = Math.random() < 0.85 ? warmWindowMaterial : coolWindowMaterial;
      if (Math.random() < 0.25) {
        material = material.clone(); // 要闪的窗各自拿一份材质
        flickerWindows.push({
          material,
          phase: Math.random() * Math.PI * 2,
          speed: rand(0.5, 1.3),
        });
      }
      const pane = new THREE.Mesh(windowGeometry, material);
      pane.position.set(
        -side * (w / 2 + 0.03), // 朝街的那面墙,微微浮出避免深度打架
        1.0 + (row + 0.5) * ((h - 2) / rows),
        (col + 0.5) * ((d - 1) / cols) - (d - 1) / 2,
      );
      pane.rotation.y = -side * Math.PI / 2;
      tower.add(pane);
    }
  }

  // ------------------------------------------------ 楼
  // 一栋 = 2~4 块叠放的体量,越往上越窄;顶上那块错位又倾斜,
  // 是断口——像很久以前被什么温柔地推了一下,就停在那里。
  function addTower(x, side, z, material, hLo, hHi, windowMax) {
    const tower = new THREE.Group();
    const levels = 2 + Math.floor(Math.random() * 3);
    let w = rand(4, 9);
    let d = rand(4, 9);
    let remaining = rand(hLo, hHi);
    let y = 0;
    for (let i = 0; i < levels; i++) {
      const isTop = i === levels - 1;
      const h = isTop ? remaining : remaining * rand(0.38, 0.55);
      remaining -= h;
      const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      block.position.y = y + h / 2;
      if (isTop) {
        block.position.x += rand(0.2, 0.9) * sign();
        block.position.z += rand(-0.6, 0.6);
        block.rotation.z = rand(0.05, 0.18) * sign();
      }
      if (i === 0 && windowMax > 0) addWindows(tower, side, w, d, h, windowMax);
      tower.add(block);
      y += h;
      w *= rand(0.68, 0.88);
      d *= rand(0.7, 0.9);
    }
    tower.position.set(x, 0, z);
    group.add(tower);
  }

  for (const side of [-1, 1]) {
    // 近排:贴着街,被半球光照出剪影层次。楼都在街外,不进碰撞表。
    const count = 8 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      addTower(
        side * rand(streetHalfWidth + 2, streetHalfWidth + 9),
        side,
        -6 - ((i + rand(0.1, 0.9)) / count) * (length + 4),
        towerMaterial,
        6, 22, 8,
      );
    }
    // 远排天际线:更高、更暗、窗更少,沉在近排背后垫出纵深。
    const farCount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < farCount; i++) {
      addTower(
        side * rand(streetHalfWidth + 10, streetHalfWidth + 17),
        side,
        -10 - ((i + rand(0.1, 0.9)) / farCount) * length,
        skylineMaterial,
        16, 28, 3,
      );
    }
  }

  // ------------------------------------------------ 断拱
  // 两根方柱横跨街道,断梁一端还架在柱顶,一端坠向街面却停在半空——
  // 连倒塌都倒到一半就睡着了。
  {
    const archZ = -44; // 离两侧路灯(-36/-50)各有半程,不被点光源贴脸打爆
    const columnTops = [];
    for (const side of [-1, 1]) {
      const h = rand(7, 9);
      const column = new THREE.Mesh(new THREE.BoxGeometry(1.2, h, 1.2), towerMaterial);
      column.position.set(side * 5, h / 2, archZ);
      column.rotation.y = rand(-0.06, 0.06);
      group.add(column);
      columnTops.push(h);
      colliders.push({ x: side * 5, z: archZ, r: 1.0 });
    }
    // 断梁:从左柱顶斜向街心,末端悬在 4m 高,不落地。
    const top = new THREE.Vector3(-5, columnTops[0] - 0.3, archZ);
    const tip = new THREE.Vector3(3.2, 4, archZ + 0.4);
    const beamLength = top.distanceTo(tip);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(beamLength, 0.9, 1.1), towerMaterial);
    beam.position.copy(top).add(tip).multiplyScalar(0.5);
    beam.rotation.z = Math.atan2(tip.y - top.y, tip.x - top.x);
    beam.rotation.y = -Math.atan2(tip.z - top.z, tip.x - top.x);
    group.add(beam);
  }

  // ------------------------------------------------ 碎石堆
  // 街面上仅有的三处杂物,每处几块小箱体挤在一起,微微各自歪着。
  for (const [rx, rz] of [[-2.5, -22], [2, -60], [-1.5, -86]]) {
    const n = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const s = rand(0.3, 1);
      const rock = new THREE.Mesh(
        new THREE.BoxGeometry(s, s * rand(0.5, 0.9), s * rand(0.6, 1)),
        towerMaterial,
      );
      const a = (i / n) * Math.PI * 2 + rand(0, 0.8);
      const rr = rand(0, 0.8);
      rock.position.set(rx + Math.cos(a) * rr, s * 0.25, rz + Math.sin(a) * rr);
      rock.rotation.set(rand(-0.3, 0.3), rand(0, Math.PI), rand(-0.3, 0.3));
      group.add(rock);
    }
    colliders.push({ x: rx, z: rz, r: 1.3 });
  }

  // ------------------------------------------------ 漂浮灯笼
  // 纯发光贴片,不用 PointLight:暖壳 + 小亮核,光是画上去的。
  function buildLantern() {
    const lantern = new THREE.Group();
    const shell = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffb070,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.55,
    }));
    shell.scale.setScalar(1.5);
    lantern.add(shell);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xfff0d8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.95,
    }));
    core.scale.setScalar(0.35);
    lantern.add(core);
    return lantern;
  }

  const lanterns = [];
  for (let i = 0; i < 8; i++) {
    const lantern = buildLantern();
    const home = new THREE.Vector3(
      rand(-streetHalfWidth + 1.5, streetHalfWidth - 1.5),
      rand(1.6, 4.5),
      -rand(8, length - 6),
    );
    lantern.position.copy(home);
    group.add(lantern);
    lanterns.push({
      group: lantern,
      home,
      phase: Math.random() * Math.PI * 2,
      orbit: rand(0.5, 1.6),   // 兜圈半径
      speed: rand(0.04, 0.1),  // 角速度,慢到几乎察觉不到
      bob: rand(0.25, 0.6),
    });
  }

  // 常规漂浮的偏移:极慢的水平兜圈 + 上下浮,每盏有自己的相位。
  const tmpOffset = new THREE.Vector3();
  function driftOffset(lantern, time, out) {
    const a = time * lantern.speed * Math.PI * 2 + lantern.phase;
    out.set(
      Math.cos(a) * lantern.orbit,
      Math.sin(time * 0.4 + lantern.phase * 2.3) * lantern.bob,
      Math.sin(a) * lantern.orbit,
    );
    return out;
  }

  // ------------------------------------------------ 灯笼飞越(剧场拍)
  // 第 8 盏兼职信使:被点名时沿一条弧线贴着玩家前方斜穿而过,
  // 飞完就在落点继续装作什么都没发生地漂。
  const passEntry = lanterns[7];
  const lanternPass = {
    active: false,
    startAt: -1, // 下一帧 update 用 time 填充
    duration: 12,
    from: new THREE.Vector3(),
    ctrl: new THREE.Vector3(),
    to: new THREE.Vector3(),
  };

  function summonLanternPass(x, z) {
    if (lanternPass.active) return; // 正在飞越:不打断它
    lanternPass.active = true;
    lanternPass.startAt = -1;
    lanternPass.from.set(x - 10, 3.0, z - 14);
    lanternPass.ctrl.set(x, 4.4, z - 9); // 弧顶略抬,掠过时正好在视线上方
    lanternPass.to.set(x + 10, 2.2, z - 6);
  }

  // ------------------------------------------------ 月亮
  // 画面的灵魂。fog:false——它在雾的另一头,雾管不到它。
  {
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(9, 48),
      new THREE.MeshBasicMaterial({ color: 0xd8e0ee, fog: false }),
    );
    moon.position.set(12, 30, -155);
    group.add(moon);
    const innerHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xcdd8ec,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.28,
      fog: false,
    }));
    innerHalo.position.set(12, 30, -154);
    innerHalo.scale.setScalar(26);
    group.add(innerHalo);
    const outerHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xb8c6e2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.12,
      fog: false,
    }));
    outerHalo.position.set(12, 30, -154);
    outerHalo.scale.setScalar(56);
    group.add(outerHalo);
  }

  // ------------------------------------------------ 主更新
  function update(dt, time) {
    // 亮窗微闪:双正弦叠出 0.75~1 的缓变,不规律但不惊扰。
    for (const pane of flickerWindows) {
      pane.material.opacity = 0.875 + 0.0625 * (
        Math.sin(time * pane.speed + pane.phase) +
        Math.sin(time * pane.speed * 1.7 + pane.phase * 3.1)
      );
    }

    // 灯笼常规漂浮(飞越中的那盏让位给弧线)。
    for (const lantern of lanterns) {
      if (lanternPass.active && lantern === passEntry) continue;
      driftOffset(lantern, time, tmpOffset);
      lantern.group.position.copy(lantern.home).add(tmpOffset);
    }

    // 飞越:二次贝塞尔 + smoothstep 缓入缓出,约 12 秒。
    if (lanternPass.active) {
      if (lanternPass.startAt < 0) lanternPass.startAt = time;
      const t = Math.min((time - lanternPass.startAt) / lanternPass.duration, 1);
      const e = t * t * (3 - 2 * t);
      const k = 1 - e;
      passEntry.group.position.set(
        k * k * lanternPass.from.x + 2 * k * e * lanternPass.ctrl.x + e * e * lanternPass.to.x,
        k * k * lanternPass.from.y + 2 * k * e * lanternPass.ctrl.y + e * e * lanternPass.to.y,
        k * k * lanternPass.from.z + 2 * k * e * lanternPass.ctrl.z + e * e * lanternPass.to.z,
      );
      if (t >= 1) {
        lanternPass.active = false;
        // 把家安在落点,再扣掉此刻的漂浮偏移——下一帧无缝接回常规漂浮。
        driftOffset(passEntry, time, tmpOffset);
        passEntry.home.copy(lanternPass.to).sub(tmpOffset);
      }
    }
  }

  return {
    group,
    colliders,
    update,
    summonLanternPass,
  };
}
