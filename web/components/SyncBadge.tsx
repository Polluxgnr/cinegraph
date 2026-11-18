"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLoaded, useStore } from "@/lib/store";
import { lastSynced } from "@/lib/sync";

/** Always-visible memory status: synced across devices, or kept in this browser only. */
export default function SyncBadge() {
  const on = useStore((s) => !!s.settings.gistToken);
  const loaded = useLoaded();
  const [at, setAt] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const read = () => {
      setAt(lastSynced());
      setNow(Date.now());
    };
    const first = setTimeout(read, 0);
    const t = setInterval(read, 30_000);
    window.addEventListener("cinegraph:synced", read);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener("cinegraph:synced", read);
    };
  }, []);
  if (!loaded) return null;
  const ago = !at ? "not yet" : now - at < 60_000 ? "just now" : now - at < 3.6e6 ? `${Math.round((now - at) / 60_000)} min ago` : `${Math.round((now - at) / 3.6e6)} h ago`;
  return (
    <Link href="/settings/" className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${on ? "text-muted hover:text-ink" : "bg-nope/10 text-nope hover:bg-nope/20"}`}
          title={on ? "Your memory syncs to your private Gist" : "Answers are saved in this browser only"}>
      <span>{on ? "☁" : "⚠"}</span>
      <span>{on ? `Synced · ${ago}` : "This browser only · set up sync"}</span>
    </Link>
  );
}
