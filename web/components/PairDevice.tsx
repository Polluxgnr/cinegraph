"use client";

import { useT } from "@/lib/i18n";

import { useEffect, useRef, useState } from "react";
import { deviceLink } from "@/lib/sync";

/**
 * Pair another device by scanning a QR code with its camera: the sync token never sits in a chat or an
 * e-mail. The code disappears after two minutes. A copyable link remains as a fallback.
 */
export default function PairDevice() {
  const T = useT();
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(120);
  const [copied, setCopied] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const link = deviceLink();
    if (!link || !canvas.current) return;
    import("qrcode").then((QR) => QR.toCanvas(canvas.current!, link, { width: 240, margin: 1, color: { dark: "#0b0b10", light: "#f4f4f5" } }));
    const t = setInterval(() => setLeft((s) => {
      if (s <= 1) {
        setOpen(false);
        return 120;
      }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [open]);

  return (
    <>
      <button className="btn text-sm" onClick={() => { setLeft(120); setCopied(false); setOpen(true); }}>{T("Link another device")}</button>
      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4" onClick={() => setOpen(false)}>
          <div className="card w-full max-w-sm space-y-3 p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-2xl">{T("Scan with your phone")}</h2>
            <canvas ref={canvas} className="mx-auto rounded-xl" />
            <p className="text-xs text-muted">{T("Open your phone's camera and point it at the code; the link opens CineGraph already synced. It carries your sync token, so don't screenshot or share it. Closes in")}{" "}{left} {T("s.")}</p>
            <div className="flex justify-center gap-2">
              <button className="btn-ghost text-xs" onClick={async () => { await navigator.clipboard.writeText(deviceLink() ?? ""); setCopied(true); }}>{copied ? T("✓ Copied: send it to yourself only") : T("Copy the link instead")}</button>
              <button className="btn-ghost text-xs" onClick={() => setOpen(false)}>{T("Done")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
