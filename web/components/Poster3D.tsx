"use client";

import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import type { ReactNode } from "react";

/**
 * A poster you can hold: it leans towards the cursor in 3D with a moving glare and a deep shadow, and springs
 * back when the mouse leaves. Touch devices and "reduce motion" get the flat poster.
 */
export default function Poster3D({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const sx = useSpring(mx, { stiffness: 180, damping: 18 });
  const sy = useSpring(my, { stiffness: 180, damping: 18 });
  const rotateY = useTransform(sx, [0, 1], [-14, 14]);
  const rotateX = useTransform(sy, [0, 1], [12, -12]);
  const gx = useTransform(sx, [0, 1], ["0%", "100%"]);
  const gy = useTransform(sy, [0, 1], ["0%", "100%"]);
  const glare = useMotionTemplate`radial-gradient(circle at ${gx} ${gy}, rgba(255,255,255,0.28), transparent 55%)`;
  const shadowX = useTransform(sx, [0, 1], [24, -24]);
  const shadow = useMotionTemplate`${shadowX}px 40px 70px -20px rgba(0,0,0,0.75)`;

  if (reduce) return <div className={className}>{children}</div>;
  return (
    <div className={className} style={{ perspective: 900 }}>
      <motion.div
        className="relative overflow-hidden rounded-2xl ring-1 ring-white/10"
        style={{ rotateX, rotateY, boxShadow: shadow, transformStyle: "preserve-3d" }}
        initial={{ opacity: 0, y: 24, rotateX: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 120, damping: 16 }}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse") return;
          const r = e.currentTarget.getBoundingClientRect();
          mx.set((e.clientX - r.left) / r.width);
          my.set((e.clientY - r.top) / r.height);
        }}
        onPointerLeave={() => {
          mx.set(0.5);
          my.set(0.5);
        }}
      >
        {children}
        <motion.div aria-hidden className="pointer-events-none absolute inset-0 mix-blend-soft-light" style={{ background: glare }} />
      </motion.div>
    </div>
  );
}
