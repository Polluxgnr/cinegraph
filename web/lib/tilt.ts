"use client";
import type { PointerEvent } from "react";

/** Pointer handlers that lean an element towards the mouse (CSS class "tilt"); touch devices are left alone. */
export const tilt = {
  onPointerMove(e: PointerEvent<HTMLElement>) {
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--ry", `${(x - 0.5) * 10}deg`);
    el.style.setProperty("--rx", `${(0.5 - y) * 10}deg`);
    el.style.setProperty("--gx", `${x * 100}%`);
    el.style.setProperty("--gy", `${y * 100}%`);
    el.style.setProperty("--glare", "1");
  },
  onPointerLeave(e: PointerEvent<HTMLElement>) {
    const el = e.currentTarget;
    for (const k of ["--ry", "--rx"]) el.style.setProperty(k, "0deg");
    el.style.setProperty("--glare", "0");
  },
};
