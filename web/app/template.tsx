"use client";

import { motion, useReducedMotion } from "motion/react";

/** Every page arrives with a short fade and rise (a template re-mounts on each navigation). */
export default function Template({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: [0.2, 0.7, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}
