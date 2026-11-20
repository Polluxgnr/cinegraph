import { useT } from "@/lib/i18n";
import { crowdRating } from "@/lib/text";
import type { Film } from "@/lib/types";

/** "84% match · IMDb 8.4" badge: your predicted fit, then the crowd's rating out of 10 (IMDb, else TMDB). */
export default function Match({ p, film, compact = false }: { p: number; film?: Film; compact?: boolean }) {
  const T = useT();
  const pct = Math.round(p * 100);
  const color = pct >= 70 ? "text-like" : pct >= 45 ? "text-accent" : "text-muted";
  const cr = crowdRating(film);
  return (
    <span className={`inline-flex items-center gap-1.5 ${compact ? "text-[11px]" : "text-xs"}`}>
      <span className={`font-semibold ${color}`} title={T("Predicted from your answers so far")}>{pct}{T("% match")}</span>
      {cr && (
        <span className="text-muted tabular-nums" title={T("{src} rating out of 10, {n} votes", { src: cr.src, n: cr.n.toLocaleString() })}>
          · {cr.src} <b className="font-semibold text-ink/90">{cr.v.toFixed(1)}</b>
        </span>
      )}
    </span>
  );
}
