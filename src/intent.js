// 输入意图层。原始指针事件在这里变成语义信号：擦拭笔划、手掌按贴、
// 拖动视线、能量。下游（雾场、各幕、音频）只读这些信号，不碰事件。

export function createIntent(canvas, cfg) {
  const wipes = [];
  const pointers = new Map();

  const state = {
    focusX: 0.5,
    focusY: 0.5,
    energy: 0,
    lastContactAt: -Infinity,
    hold: null,      // { x, y, startedAt, pointerId }——可能长成手掌
    palm: {
      active: false,   // 手掌正贴在玻璃上
      planted: false,  // 本次按住是否已盖下掌印
      x: 0.5,
      y: 0.5,
      charge: 0,
      fired: false,
      cooldownUntil: -Infinity,
    },
    dragLast: null,
    dragX: 0,
    dragY: 0,
    lastWipeAt: 0,
    time: 0,
  };

  function uvFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / Math.max(rect.width, 1),
      y: 1 - (event.clientY - rect.top) / Math.max(rect.height, 1),
    };
  }

  function handlePointerDown(event) {
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // 合成事件没有真实指针可捕获。
    }
    const uv = uvFromEvent(event);
    pointers.set(event.pointerId, uv);
    state.hold = { x: uv.x, y: uv.y, startedAt: state.time, pointerId: event.pointerId };
    state.dragLast = { id: event.pointerId, x: uv.x, y: uv.y };
    state.lastContactAt = state.time;
    state.focusX = uv.x;
    state.focusY = uv.y;
    // 指尖落在玻璃上：一个小圆点的擦痕。
    wipes.push({ ax: uv.x, ay: uv.y, bx: uv.x, by: uv.y, speed: 0, tap: true });
  }

  function handlePointerMove(event) {
    const uv = uvFromEvent(event);
    const previous = pointers.get(event.pointerId);
    const pressed = event.buttons > 0 || event.pointerType === "touch";
    if (!pressed || !previous) return;

    const distance = Math.hypot(uv.x - previous.x, uv.y - previous.y);
    pointers.set(event.pointerId, uv);

    if (state.dragLast && state.dragLast.id === event.pointerId) {
      state.dragX += uv.x - state.dragLast.x;
      state.dragY += uv.y - state.dragLast.y;
      state.dragLast.x = uv.x;
      state.dragLast.y = uv.y;
    }

    if (distance > cfg.pointer.minStrokeDistance &&
        distance <= cfg.pointer.maxStrokeDistance) {
      wipes.push({
        ax: previous.x, ay: previous.y,
        bx: uv.x, by: uv.y,
        speed: distance,
      });
      state.lastContactAt = state.time;
      state.energy = Math.min(state.energy + distance * 9, 1.6);
      state.focusX += (uv.x - state.focusX) * 0.35;
      state.focusY += (uv.y - state.focusY) * 0.35;
      state.lastWipeAt = state.time;
    }

    if (state.hold) {
      const drift = Math.hypot(uv.x - state.hold.x, uv.y - state.hold.y);
      if (drift > cfg.pointer.holdMoveCancel) {
        // 手动了——这不是按贴，是擦拭。掌印（若已盖）留在原处慢慢回雾。
        state.hold = null;
        state.palm.active = false;
        state.palm.planted = false;
      }
    }
  }

  function handlePointerEnd(event) {
    pointers.delete(event.pointerId);
    if (state.hold && state.hold.pointerId === event.pointerId) {
      state.hold = null;
    }
    if (state.dragLast && state.dragLast.id === event.pointerId) {
      state.dragLast = null;
    }
    state.palm.active = false;
    state.palm.planted = false;
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerEnd);
  canvas.addEventListener("pointercancel", handlePointerEnd);
  canvas.addEventListener("pointerleave", handlePointerEnd);

  // 每帧由 main 调用。fogAt(x, y) 取按点附近的雾密度（CPU 近似格网），
  // 决定手掌是真的在融玻璃，还是只在干玻璃上留个印子。
  function frame(dt, time, fogAt) {
    state.time = time;
    const palm = state.palm;
    palm.fired = false;
    palm.justPlanted = false;
    const coolingDown = time < palm.cooldownUntil;

    if (state.hold && !coolingDown &&
        time - state.hold.startedAt > cfg.pointer.holdPalmDelay) {
      palm.x = state.hold.x;
      palm.y = state.hold.y;
      if (!palm.planted) {
        palm.planted = true;
        palm.justPlanted = true;
        // 雾厚不厚,在手掌落下的这一刻定:之后掌印自己会把雾压掉,
        // 但手底下的玻璃已经被捂住了——继续按它原来的厚度融。
        const fog = fogAt ? fogAt(palm.x, palm.y) : 1;
        palm.fogThick = fog > cfg.palm.fogGate;
      }
      palm.active = true;
      const rate = (palm.fogThick ? 1 : cfg.palm.thinChargeScale) / cfg.palm.chargeTime;
      palm.charge = Math.min(palm.charge + rate * dt, 1);
      if (palm.charge >= 1) {
        palm.fired = true;
        palm.charge = 0;
        palm.active = false;
        palm.planted = false;
        palm.cooldownUntil = time + cfg.palm.cooldown;
        state.hold = null;
      }
    } else if (!state.hold) {
      palm.active = false;
      palm.charge = Math.max(palm.charge - cfg.palm.releaseRate * dt, 0);
    }

    state.energy = Math.max(state.energy - dt * 1.7, 0);

    const drainedWipes = wipes.splice(0, wipes.length);
    const drag = { x: state.dragX, y: state.dragY };
    state.dragX = 0;
    state.dragY = 0;

    return {
      wipes: drainedWipes,
      drag,
      focus: { x: state.focusX, y: state.focusY },
      energy: Math.min(state.energy, 1),
      presence: Math.max(0, 1 - (time - state.lastContactAt) / 3.5),
      palm: { ...palm },
      wiping: time - state.lastWipeAt < 0.15,
    };
  }

  function settle() {
    state.energy *= 0.3;
  }

  return {
    frame,
    settle,
    get debug() {
      return {
        palmCharge: Number(state.palm.charge.toFixed(3)),
        palmActive: state.palm.active,
        energy: Number(state.energy.toFixed(3)),
      };
    },
  };
}
