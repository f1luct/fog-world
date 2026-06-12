// 水珠。几十个 CPU 粒子：在呵气过饱和处和擦痕边缘凝出，攒够大小就
// 顺着重力往下淌，途中扫积雾水越淌越大，并往雾场注入细擦痕——
// 这就是它留在玻璃上的亮尾迹。

import * as THREE from "three";

export function createDroplets(cfg, fog) {
  const pool = [];
  const uniformData = Array.from({ length: cfg.max }, () => new THREE.Vector4(0, 0, 0, 0));

  function spawn(x, y, radius) {
    if (pool.length >= cfg.max) {
      // 挤掉最小的那颗。
      let smallest = 0;
      for (let i = 1; i < pool.length; i++) {
        if (pool[i].r < pool[smallest].r) smallest = i;
      }
      pool.splice(smallest, 1);
    }
    pool.push({
      x,
      y,
      r: radius,
      vy: 0,
      wobble: Math.random() * Math.PI * 2,
      stick: 0.5 + Math.random() * 4.0, // 静摩擦：错开各自开始滑的时刻
    });
  }

  // 一口呵气结束：雾团范围里凝出几颗。
  function condense(cx, cy, radius) {
    const n = cfg.spawnPerBreath;
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * radius * 0.8;
      spawn(
        Math.min(Math.max(cx + Math.cos(angle) * dist, 0.03), 0.97),
        Math.min(Math.max(cy + Math.sin(angle) * dist * 0.7, 0.08), 0.95),
        cfg.minRadius + Math.random() * (cfg.maxRadius - cfg.minRadius) * 0.7,
      );
    }
  }

  // 擦拭把雾水推到痕边：偶尔在笔划尾端凝一颗。
  function fromWipe(stroke) {
    if (Math.random() > cfg.spawnFromWipe) return;
    const px = stroke.by - stroke.ay;
    const py = -(stroke.bx - stroke.ax);
    const len = Math.hypot(px, py) || 1;
    const side = Math.random() < 0.5 ? 1 : -1;
    spawn(
      Math.min(Math.max(stroke.bx + (px / len) * 0.02 * side, 0.03), 0.97),
      Math.min(Math.max(stroke.by + (py / len) * 0.02 * side, 0.08), 0.95),
      cfg.minRadius + Math.random() * (cfg.maxRadius - cfg.minRadius) * 0.5,
    );
  }

  function update(dt, time) {
    for (let i = pool.length - 1; i >= 0; i--) {
      const drop = pool[i];
      const prevX = drop.x;
      const prevY = drop.y;

      if (drop.r > cfg.slideThreshold) {
        drop.stick -= dt;
        if (drop.stick <= 0) {
          const speed = cfg.slideSpeed * Math.min(drop.r / cfg.maxRadius, 1.3);
          drop.vy += (speed - drop.vy) * Math.min(dt * 3, 1);
        }
      } else {
        // 太小滑不动，慢慢蒸发掉。
        drop.r -= dt * 0.0004;
        if (drop.r <= cfg.minRadius * 0.5) {
          pool.splice(i, 1);
          continue;
        }
      }

      if (drop.vy > 0.0001) {
        drop.wobble += dt * (6 + drop.vy * 40);
        drop.y -= drop.vy * dt;
        drop.x += Math.sin(drop.wobble) * drop.vy * dt * 0.10;
        drop.r = Math.min(drop.r + cfg.growAlong * drop.vy * dt, cfg.maxRadius * 1.4);
        // 尾迹：细细一道擦痕，越大的珠子擦得越宽。
        fog.addWipe({
          ax: prevX,
          ay: prevY,
          bx: drop.x,
          by: drop.y,
          radius: drop.r * cfg.trailRadiusScale,
          strength: 0.55,
        });
      }

      if (drop.y < -0.04) pool.splice(i, 1);
    }

    // 填充 shader uniform：xy 位置，z 半径，w 滑动量（高光用）。
    for (let i = 0; i < cfg.max; i++) {
      const drop = pool[i];
      if (drop) {
        uniformData[i].set(drop.x, drop.y, drop.r, Math.min(drop.vy / cfg.slideSpeed, 1));
      } else {
        uniformData[i].set(0, 0, 0, 0);
      }
    }
  }

  function clearAll() {
    pool.length = 0;
    for (const v of uniformData) v.set(0, 0, 0, 0);
  }

  return {
    spawn,
    condense,
    fromWipe,
    update,
    clearAll,
    uniformData,
    get count() {
      return pool.length;
    },
  };
}
