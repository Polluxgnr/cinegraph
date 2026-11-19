"use client";

import { useT } from "@/lib/i18n";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useManifest } from "@/lib/hooks";
import { useLoaded, useStore } from "@/lib/store";
import { lastSynced } from "@/lib/sync";

type Status = "on" | "off" | "public" | "catalogue";
interface Connector { name: string; icon: string; status: Status; brings: string; detail?: string; href?: string; cta?: string }

const PILL: Record<Status, [string, string]> = {
  on: ["Connected", "bg-like/15 text-like"],
  off: ["Not connected", "bg-panel-2 text-muted"],
  public: ["Always on · public", "bg-accent/15 text-accent"],
  catalogue: ["Weekly catalogue", "bg-unseen/15 text-unseen"],
};

const ago = (t?: number) => {
  if (!t) return "";
  const d = (Date.now() - t) / 864e5;
  return d < 1 / 24 ? "just now" : d < 1 ? `${Math.round(d * 24)} h ago` : `${Math.round(d)} d ago`;
};

/**
 * Every source the app talks to, what it brings and whether it's on: the map of where your data comes from.
 * Your accounts (left) are opt-in and read in your browser; public sources need nothing.
 */
export default function Connectors() {
  const T = useT();
  const loaded = useLoaded();
  const m = useManifest().data;
  const s = useStore((x) => ({ settings: x.settings, imports: x.imports, spotify: x.spotify }));
  const [synced, setSynced] = useState(0);
  useEffect(() => {
    const read = () => setSynced(lastSynced());
    const t = setTimeout(read, 0);
    window.addEventListener("cinegraph:synced", read);
    return () => {
      clearTimeout(t);
      window.removeEventListener("cinegraph:synced", read);
    };
  }, []);
  if (!loaded) return <div className="card h-64 animate-pulse" />;
  const imp = s.imports;
  const films = m?.domains.films;
  const mine: Connector[] = [
    { name: "GitHub · memory sync", icon: "☁", status: s.settings.gistToken ? "on" : "off", brings: "Every profile's answers, lists and notes, on all your devices (private Gist)", detail: s.settings.gistToken ? `last sync ${ago(synced) || "pending"}` : "", href: "/settings/#sync", cta: s.settings.gistToken ? "Manage" : "Set up" },
    { name: "Spotify", icon: "🎧", status: s.spotify || imp.spotify ? "on" : "off", brings: "Top artists, liked songs, playlists → your music taste", detail: s.spotify ? `${s.spotify.topArtists.length} artists · ${ago(s.spotify.connectedAt)}` : imp.spotify?.summary, href: "/import/#connect-spotify", cta: s.spotify ? "Refresh" : "Connect" },
    { name: "YouTube", icon: "▶", status: imp["youtube-live"] || imp.youtube ? "on" : "off", brings: "Liked videos, subscriptions (account) · history & Watch later (Takeout)", detail: imp["youtube-live"]?.summary ?? imp.youtube?.summary, href: "/import/#connect-youtube", cta: imp["youtube-live"] ? "Refresh" : "Connect" },
    { name: "Netflix", icon: "🎬", status: imp.netflix ? "on" : "off", brings: "Everything you watched → films & series answers", detail: imp.netflix?.summary, href: "/import/", cta: "Import" },
    { name: "Letterboxd", icon: "📒", status: Object.keys(imp).some((k) => k.startsWith("letterboxd")) ? "on" : "off", brings: "Ratings, diary, watchlist (official export)", href: "/import/", cta: "Import" },
    { name: "Pinterest", icon: "📌", status: imp.pinterest ? "on" : "off", brings: "Public boards → pins in any space", detail: imp.pinterest?.summary, href: "/import/", cta: imp.pinterest ? "Sync" : "Add boards" },
    { name: "Instagram saves", icon: "📸", status: Object.keys(imp).some((k) => k.startsWith("pack:")) ? "on" : "off", brings: "Sorted saves (pack file) → brands, places, recipes, notes", href: "/import/", cta: "Import pack" },
    { name: "Claude (AI)", icon: "✦", status: s.settings.anthropicKey ? "on" : "off", brings: "Free-text search and a written taste portrait (your key, this device only)", href: "/settings/#ai", cta: s.settings.anthropicKey ? "Manage" : "Add key" },
  ];
  const open: Connector[] = [
    { name: "TMDB", icon: "🎞", status: "catalogue", brings: "Titles, posters, cast & crew, keywords, trailers, French streaming offers", detail: films ? `${films.count.toLocaleString("fr-FR")} titles` : "" },
    { name: "MovieLens", icon: "👥", status: "catalogue", brings: "32 million individual ratings by 200,000 people → “people with your taste” and crowd averages", detail: films?.cf_items ? `${films.cf_items.toLocaleString("fr-FR")} films modelled` : "" },
    { name: "Wikidata", icon: "🧠", status: "public", brings: "Awards, sagas, sources, review scores (Rotten Tomatoes, Metacritic, IMDb), places, cars, best spots" },
    { name: "Wikipedia", icon: "📖", status: "public", brings: "Summaries, images" },
    { name: "Deezer", icon: "🎵", status: "public", brings: "Artists, related artists, top songs, 30 s previews, new releases, playlists" },
    { name: "YouTube feeds", icon: "📺", status: "catalogue", brings: "Latest documentaries & videos from curated channels, with views and likes" },
    { name: "TheMealDB", icon: "🍳", status: "catalogue", brings: "Recipes with ingredients and steps" },
    { name: "Curated lists", icon: "🧥", status: "catalogue", brings: "Style brands & pieces, dream-garage prices (in the repo, editable)" },
  ];
  const card = (c: Connector, i: number) => {
    const [label, cls] = PILL[c.status];
    const body = (
      <>
        <div className="flex items-start justify-between gap-2">
          <span className="flex items-center gap-2 font-medium"><span className="text-lg">{c.icon}</span>{c.name}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}>{label}</span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">{c.brings}</p>
        {c.detail && <p className="mt-1 truncate text-[11px] text-ink/70">{c.detail}</p>}
        {c.cta && <span className="mt-2 inline-block text-xs text-accent">{c.cta} →</span>}
      </>
    );
    return (
      <motion.div key={c.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
        {c.href ? <Link href={c.href} className="card block h-full p-3 transition hover:-translate-y-0.5 hover:border-accent">{body}</Link> : <div className="card h-full p-3">{body}</div>}
      </motion.div>
    );
  };
  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-display text-2xl">{T("Connections")}</h2>
        <p className="text-sm text-muted">{T("Where everything comes from. Your accounts are opt-in and read in your browser; public sources need nothing.")}{m ? ` Catalogue built ${new Date(m.built_at).toLocaleDateString("fr-FR")}.` : ""}</p>
      </div>
      <div>
        <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted">{T("Your accounts & files")}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{mine.map(card)}</div>
      </div>
      <div>
        <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted">{T("Open sources")}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{open.map((c, i) => card(c, i + mine.length))}</div>
      </div>
    </section>
  );
}
