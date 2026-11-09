/** "84% match · ★ 4.0 predicted" badge. */
export default function Match({ p, stars, compact = false }: { p: number; stars: number; compact?: boolean }) {
  const pct = Math.round(p * 100);
  const color = pct >= 70 ? "text-like" : pct >= 45 ? "text-accent" : "text-muted";
  return (
    <span className={`inline-flex items-center gap-1.5 ${compact ? "text-[11px]" : "text-xs"}`} title="Predicted from your answers so far">
      <span className={`font-semibold ${color}`}>{pct}% match</span>
      <span className="text-muted">· ★ {stars.toFixed(1)}</span>
    </span>
  );
}
