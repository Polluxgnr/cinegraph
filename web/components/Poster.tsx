/* eslint-disable @next/next/no-img-element */
import { poster, type Title } from "@/lib/api";

function hue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** TMDB poster, or a typographic placeholder when there is none (before the TMDB crawl). */
export default function Poster({
  t,
  size = "w500",
  className = "",
  big = false,
  bare = false,
}: {
  t: Pick<Title, "title" | "year" | "poster_path" | "kind" | "genres">;
  size?: string;
  className?: string;
  big?: boolean;
  bare?: boolean;
}) {
  const src = poster(t.poster_path, size);
  if (src) {
    return (
      <img
        src={src}
        alt={t.title}
        loading="lazy"
        draggable={false}
        className={`aspect-[2/3] w-full select-none object-cover ${className}`}
      />
    );
  }
  const h = hue(t.title);
  return (
    <div
      className={`relative flex aspect-[2/3] w-full select-none flex-col justify-end overflow-hidden p-4 ${className}`}
      style={{
        background: `linear-gradient(160deg, hsl(${h} 45% 22%), hsl(${(h + 40) % 360} 35% 10%) 70%)`,
      }}
    >
      <div
        className="absolute -right-6 -top-6 h-32 w-32 rounded-full opacity-20"
        style={{ background: `hsl(${(h + 180) % 360} 70% 60%)`, filter: "blur(30px)" }}
      />
      {!bare && (
        <>
      <span className="mb-auto text-[10px] uppercase tracking-[0.2em] text-white/50">
        {t.kind === "tv" ? "Series" : "Film"}
      </span>
      <span className={`font-display leading-[0.95] text-white ${big ? "text-5xl" : "text-2xl"}`}>{t.title}</span>
      <span className="mt-2 text-xs text-white/60">
        {[t.year, t.genres?.slice(0, 2).join(" / ")].filter(Boolean).join(" · ")}
      </span>
        </>
      )}
    </div>
  );
}
