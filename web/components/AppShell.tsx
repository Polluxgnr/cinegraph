"use client";

import { useEffect, useState } from "react";
import { asset } from "@/lib/data";
import { getState, loadState } from "@/lib/store";
import { pullGist, scheduleSync } from "@/lib/sync";

/** Restores your memory, pulls it from your Gist once per visit, and pushes changes back. */
export default function AppShell() {
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadState();
      if (getState().settings.gistToken) {
        try {
          if ((await pullGist()) && !cancelled) setSyncMsg("Memory synced");
        } catch (e) {
          if (!cancelled) setSyncMsg(`Sync failed: ${(e as Error).message}`);
        }
        setTimeout(() => {
          if (!cancelled) setSyncMsg(null);
        }, 2500);
      }
    })();
    const onSave = () => scheduleSync();
    window.addEventListener("cinegraph:saved", onSave);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register(asset("/sw.js"), { scope: asset("/") }).catch(() => {});
    }
    return () => {
      cancelled = true;
      window.removeEventListener("cinegraph:saved", onSave);
    };
  }, []);

  return syncMsg ? (
    <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-panel-2 px-4 py-1.5 text-xs text-muted shadow-xl md:bottom-6">
      {syncMsg}
    </div>
  ) : null;
}
