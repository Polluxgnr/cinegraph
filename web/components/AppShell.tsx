"use client";

import { useEffect, useState } from "react";
import { asset } from "@/lib/data";
import { getState, loadState } from "@/lib/store";
import { acceptDeviceLink, flushSync, pullGist, pushGist, scheduleSync } from "@/lib/sync";

/**
 * Restores your memory and keeps it in step with your other devices: pull when the app opens or comes
 * back to the foreground, push a few seconds after a change and right away when you leave it.
 */
export default function AppShell() {
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastPull = 0;
    const flash = (m: string) => {
      if (cancelled) return;
      setSyncMsg(m);
      setTimeout(() => !cancelled && setSyncMsg(null), 2500);
    };
    const pull = async (announce: boolean) => {
      if (!getState().settings.gistToken || Date.now() - lastPull < 30_000) return;
      lastPull = Date.now();
      try {
        if ((await pullGist()) && announce) flash("Memory synced");
      } catch (e) {
        flash(`Sync failed: ${(e as Error).message}`);
      }
    };
    (async () => {
      await loadState();
      if (acceptDeviceLink()) {
        flash("This device is now linked");
        await pull(false);
        await pushGist().catch(() => {}); // what this device already had goes up too
        flash("Linked: memory synced with your other devices");
        return;
      }
      await pull(true);
    })();
    const onSave = () => scheduleSync();
    const onVisible = () => (document.visibilityState === "visible" ? pull(false) : flushSync());
    window.addEventListener("cinegraph:saved", onSave);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", flushSync);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register(asset("/sw.js"), { scope: asset("/") }).catch(() => {});
    }
    return () => {
      cancelled = true;
      window.removeEventListener("cinegraph:saved", onSave);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", flushSync);
    };
  }, []);

  return syncMsg ? (
    <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-panel-2 px-4 py-1.5 text-xs text-muted shadow-xl md:bottom-6">
      {syncMsg}
    </div>
  ) : null;
}
