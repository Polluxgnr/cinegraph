"use client";

import { useT } from "@/lib/i18n";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLoaded, useStore } from "@/lib/store";
import { lastSynced } from "@/lib/sync";

/** Always-visible memory status: synced across devices, or kept in this browser only. */
export default function SyncBadge() {
  const on = useStore((s) => !!s.settings.gistToken);
  const loaded = useLoaded();
  const t = useT();
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
  const ago = !at ? t("not yet") : now - at < 60_000 ? t("just now") : now - at < 3.6e6 ? t("{n} min ago", { n: Math.round((now - at) / 60_000) }) : t("{n} h ago", { n: Math.round((now - at) / 3.6e6) });
  return (
    <Link href="/settings/" className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${on ? "text-muted hover:text-ink" : "bg-nope/10 text-nope hover:bg-nope/20"}`}
          title={on ? t("Your memory syncs to your private Gist") : t("Answers are saved in this browser only")}>
      <span>{on ? "☁" : "⚠"}</span>
      <span>{on ? `${t("Synced")} · ${ago}` : t("This browser only · set up sync")}</span>
    </Link>
  );
}
