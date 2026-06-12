// 避障与空气墙转向。纯数学,不 import three——给走在水镜街面上的人
// 一个半径 radius 的圆身体:撞上废墟残柱会沿边滑开而不是卡死,
// 快撞上时提前把头转开,走到街沿时被一只看不见的手慢慢拨回街心。
//
// 使用示例:
//   import { createSteering } from "./steering.js";
//   const steering = createSteering(
//     [{ x: -3.2, z: -40, r: 1.1 }],                     // 圆形障碍(世界坐标,米)
//     { minX: -6.5, maxX: 6.5, minZ: -120, maxZ: 5.5 },  // 空气墙
//   );
//   // 每帧(moveX/moveZ 是期望速度 米/秒):
//   const out = steering.step({ x: nav.x, z: nav.z, yaw: nav.yaw, moveX, moveZ, dt });
//   nav.x = out.x;
//   nav.z = out.z;
//   nav.yaw += out.yawNudge;   // 直接加,内部已按 dt 缩放并限幅
//   // 场景换幕时:steering.setColliders(newList);
//
// 朝向约定:yaw = 0 朝 -z,正 yaw 向左转,前向向量 = (-sin(yaw), -cos(yaw))。

export function createSteering(colliders, bounds, opts = {}) {
  const radius = opts.radius ?? 0.45;
  const feelerDist = opts.feelerDist ?? 3.4;
  const turnRate = opts.turnRate ?? 1.7;
  const FEELER_MARGIN = 0.4; // 触须检测时障碍额外膨胀的余量(米)

  let list = colliders ?? [];

  // 绕行方向粘滞:正对障碍时左右两侧几乎等价,不锁定会逐帧左右抖动。
  let committedOb = null;   // 正在绕的那个障碍(对象引用)
  let committedSide = 0;    // +1 = 它在左边(绕右), -1 = 它在右边(绕左)

  // 包角差:任意角差归一化到 (-PI, PI],转头永远走短弧。
  function wrapAngle(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
  }

  // 线段-圆相交:从 (px,pz) 沿单位向量 (dirX,dirZ) 伸 feelerDist,
  // 返回最先命中的障碍 { ob, t, side },没有则 null。
  function castFeeler(px, pz, dirX, dirZ) {
    let best = null;
    for (const c of list) {
      const R = c.r + radius + FEELER_MARGIN;
      const relX = c.x - px;
      const relZ = c.z - pz;
      const along = relX * dirX + relZ * dirZ; // 圆心在触须上的投影
      if (along < -R) continue;                // 整个在背后
      const perpSq = relX * relX + relZ * relZ - along * along;
      const disc = R * R - perpSq;
      if (disc < 0) continue;
      let tHit = along - Math.sqrt(disc);
      if (tHit > feelerDist) continue;
      if (tHit < 0) tHit = 0;                  // 起点已贴着膨胀圆,最急
      if (!best || tHit < best.t) {
        // 叉积判侧:+1 = 圆心在触须左侧(面朝 -z 时即 -x 侧)
        const cross = dirZ * relX - dirX * relZ;
        best = { ob: c, t: tHit, side: cross >= 0 ? 1 : -1 };
      }
    }
    return best;
  }

  function step({ x, z, yaw, moveX, moveZ, dt }) {
    // —— 1. 位置积分 ——
    const stepX = moveX * dt;
    const stepZ = moveZ * dt;
    let nx = x + stepX;
    let nz = z + stepZ;

    // —— 2. 圆障碍解算:沿法线推出到边界。只修正法向,本帧位移的
    // 切向分量原样保留——这正是"投影到切线滑动",贴着柱子也走得动。
    // 迭代 2 次:从一个障碍推出可能撞进相邻障碍。
    for (let iter = 0; iter < 2; iter++) {
      for (const c of list) {
        const R = c.r + radius;
        let dx = nx - c.x;
        let dz = nz - c.z;
        let d = Math.hypot(dx, dz);
        if (d >= R) continue;
        if (d < 1e-5) {
          // 正踩在圆心上:取垂直于来路的方向推出,没有来路就随便挑一边
          dx = -stepZ;
          dz = stepX;
          d = Math.hypot(dx, dz);
          if (d < 1e-5) { dx = 1; dz = 0; d = 1; }
        }
        nx = c.x + (dx / d) * R;
        nz = c.z + (dz / d) * R;
      }
    }

    // —— 3. 空气墙:逐轴 clamp(含身体半径缩进)。只压被顶住的那一轴,
    // 另一轴照常前进 = 贴墙时保留切向分量,沿墙滑。
    nx = Math.min(Math.max(nx, bounds.minX + radius), bounds.maxX - radius);
    nz = Math.min(Math.max(nz, bounds.minZ + radius), bounds.maxZ - radius);

    // —— 触须方向:速度显著时用速度方向,几乎静止时用面朝方向 ——
    const speed = Math.hypot(moveX, moveZ);
    let dirX;
    let dirZ;
    if (speed > 0.1) {
      dirX = moveX / speed;
      dirZ = moveZ / speed;
    } else {
      dirX = -Math.sin(yaw);
      dirZ = -Math.cos(yaw);
    }

    let yawNudge = 0;

    // —— 4. 预判避障:越近转得越急,urgency^1.5 让远处的只轻轻带一下 ——
    const hit = castFeeler(nx, nz, dirX, dirZ);
    if (hit) {
      let side = hit.side;
      if (committedOb === hit.ob) {
        side = committedSide; // 粘滞:对同一障碍坚持已选的绕行侧
      } else {
        committedOb = hit.ob;
        committedSide = side;
      }
      const urgency = 1 - hit.t / feelerDist;
      // side = +1 障碍在左 → 负 yawNudge 向右转开(正 yaw 是左转)
      yawNudge -= side * turnRate * Math.pow(urgency, 1.5) * dt;
    } else if (committedOb) {
      // 触须不再碰它、人也离开了它身边——解除承诺,下个障碍重新选边
      const clearDist = committedOb.r + radius + FEELER_MARGIN + 0.5;
      if (Math.hypot(nx - committedOb.x, nz - committedOb.z) > clearDist) {
        committedOb = null;
        committedSide = 0;
      }
    }

    // —— 5. 空气墙预判:触须尖出界,把朝向慢慢掰回街心 ——
    const tipX = nx + dirX * feelerDist;
    const tipZ = nz + dirZ * feelerDist;
    if (
      tipX < bounds.minX + radius || tipX > bounds.maxX - radius ||
      tipZ < bounds.minZ + radius || tipZ > bounds.maxZ - radius
    ) {
      // 期望朝向:指向街心线 (x=0) 上前方一点,目标点也别放到界外
      const aheadZ = nz + (dirZ <= 0 ? -6 : 6);
      const toX = 0 - nx;
      const toZ = Math.min(Math.max(aheadZ, bounds.minZ + radius), bounds.maxZ - radius) - nz;
      const desiredYaw = Math.atan2(-toX, -toZ); // 前向 = (-sin, -cos) 的反解
      const diff = wrapAngle(desiredYaw - yaw);
      let maxStep = turnRate * 0.9 * dt;
      // 顶着墙了(实际位移远小于期望):力度翻倍,慢慢把人转回来
      const wanted = Math.hypot(stepX, stepZ);
      const actual = Math.hypot(nx - x, nz - z);
      if (wanted > 1e-6 && actual < wanted * 0.15) maxStep *= 2;
      yawNudge += Math.min(Math.max(diff, -maxStep), maxStep);
    }

    // —— 7. 总限幅:无论几路修正叠加,每帧最多转这么多,帧率无关 ——
    const cap = turnRate * dt * 1.6;
    yawNudge = Math.min(Math.max(yawNudge, -cap), cap);

    return { x: nx, z: nz, yawNudge };
  }

  // 替换障碍列表。旧的对象引用全部作废,绕行承诺一并清掉。
  function setColliders(next) {
    list = next ?? [];
    committedOb = null;
    committedSide = 0;
  }

  return {
    step,
    setColliders,
  };
}
