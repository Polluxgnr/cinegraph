/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import type { Entity } from "@/lib/types";

function hue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** Real image when there is one; otherwise a typographic cover so nothing looks broken. */
export default function EntityImage({
  e,
  aspect = "2/3",
  className = "",
  big = false,
  bare = false,
}: {
  e: Pick<Entity, "title" | "subtitle" | "image">;
  aspect?: string;
  className?: string;
  big?: boolean;
  bare?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (e.image && !failed) {
    return (
      <img
        src={e.image}
        alt={e.title}
        loading="lazy"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`w-full select-none object-cover ${className}`}
        style={{ aspectRatio: aspect }}
      />
    );
  }
  const h = hue(e.title);
  return (
    <div
      className={`relative flex w-full select-none flex-col justify-end overflow-hidden p-4 ${className}`}
      style={{ aspectRatio: aspect, background: `linear-gradient(160deg, hsl(${h} 45% 24%), hsl(${(h + 40) % 360} 35% 10%) 75%)` }}
    >
      <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full opacity-20" style={{ background: `hsl(${(h + 180) % 360} 70% 60%)`, filter: "blur(30px)" }} />
      {!bare && (
        <>
          <span className={`font-display leading-[0.95] text-white ${big ? "text-5xl" : "text-2xl"}`}>{e.title}</span>
          <span className="mt-2 line-clamp-1 text-xs text-white/60">{e.subtitle}</span>
        </>
      )}
    </div>
  );
}
