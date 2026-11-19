"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

const KEY = "cinegraph:welcomed";

/** First visit on a device: three steps to get value fast. Disappears once done or dismissed. */
export default function Welcome() {
  const answers = useStore((s) => Object.keys(s.feedback).length);
  const synced = useStore((s) => !!s.settings.gistToken);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    let v = false;
    try {
      v = localStorage.getItem(KEY) === "1";
    } catch {
      /* private mode */
    }
    const t = setTimeout(() => setHidden(v), 0);
    return () => clearTimeout(t);
  }, []);
  if (hidden || answers >= 20) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode */
    }
    setHidden(true);
  };
  const steps: [string, string, string, boolean][] = [
    ["Swipe 20 cards", "Seen it or not, loved it or not: every answer sharpens everything.", "/swipe/", answers >= 20],
    ["Turn on sync", "Keep your memory on your phone, tablet and laptop.", "/settings/#sync", synced],
    ["Bring your history", "Spotify, YouTube, Netflix, Letterboxd, Pinterest: minutes, not weeks.", "/import/", false],
  ];
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card relative space-y-3 p-5">
      <button onClick={close} aria-label="Dismiss" className="absolute right-3 top-3 text-muted hover:text-ink">✕</button>
      <h2 className="font-display text-3xl">Three steps to a taste engine that knows you</h2>
      <ol className="grid gap-2 md:grid-cols-3">
        {steps.map(([title, hint, href, done], i) => (
          <li key={title}>
            <Link href={href} className={`card block h-full p-3 hover:border-accent ${done ? "opacity-60" : ""}`}>
              <p className="font-medium"><span className="mr-2 text-accent">{done ? "✓" : i + 1}</span>{title}</p>
              <p className="mt-1 text-xs text-muted">{hint}</p>
            </Link>
          </li>
        ))}
      </ol>
    </motion.section>
  );
}
