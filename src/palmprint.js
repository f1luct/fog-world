// 程序化掌印：canvas 2D 画一只手掌的剪影（掌心椭圆 + 五指胶囊），
// 模糊出软边。雾场拿它当擦除蒙版，穿越拿它当融穿的种子形状。

import * as THREE from "three";

export function createPalmPrint(size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);

  const s = size / 256; // 以 256 为基准的坐标
  ctx.save();
  ctx.translate(size / 2, size / 2 + 14 * s);
  ctx.rotate(-0.06);
  ctx.fillStyle = "#fff";
  ctx.filter = `blur(${6 * s}px)`;

  // 掌心
  ctx.beginPath();
  ctx.ellipse(0, 26 * s, 52 * s, 62 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // 四根手指：x 偏移、根部 y、长度、粗细、倾角
  const fingers = [
    [-40, -22, 64, 15, -0.18],
    [-14, -34, 80, 16, -0.05],
    [13, -34, 74, 15.5, 0.04],
    [38, -24, 58, 14, 0.16],
  ];
  for (const [fx, fy, len, w, tilt] of fingers) {
    ctx.save();
    ctx.translate(fx * s, fy * s);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.roundRect(-w * s / 2, -len * s, w * s, len * s + 18 * s, w * s / 2);
    ctx.fill();
    ctx.restore();
  }

  // 拇指：斜着探出去
  ctx.save();
  ctx.translate(-58 * s, 30 * s);
  ctx.rotate(-0.85);
  ctx.beginPath();
  ctx.roundRect(-9 * s, -56 * s, 19 * s, 64 * s, 9 * s);
  ctx.fill();
  ctx.restore();

  ctx.restore();

  // 掌心压得最实、边缘虚——再叠一层径向衰减
  const fade = ctx.createRadialGradient(
    size / 2, size / 2, size * 0.18,
    size / 2, size / 2, size * 0.52,
  );
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
