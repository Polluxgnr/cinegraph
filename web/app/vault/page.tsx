"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { DOMAINS } from "@/lib/domains";
import { exportObsidian } from "@/lib/io";
import { addVault, removeVault, useLoaded, useStore } from "@/lib/store";

const GUESS: [RegExp, string][] = [
  [/youtube\.com|youtu\.be/, "youtube"], [/marmiton|750g|cuisine|recipe|recette/, "recipes"], [/spotify|deezer|soundcloud|bandcamp/, "music"],
  [/senscritique|allocine|letterboxd|imdb|netflix|primevideo/, "films"], [/pinterest/, "brands"], [/booking|airbnb|wikivoyage|tripadvisor/, "places"],
];

/** Your second brain inbox: links, ideas, notes. Share from your phone (PWA share target) or paste. */
export default function Vault() {
  const vault = useStore((s) => s.vault);
  const loaded = useLoaded();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string | null>(null);

  // PWA share target: /vault/?url=…&title=…&text=…
  useEffect(() => {
    if (!loaded) return;
    const p = new URLSearchParams(window.location.search);
    const shared = p.get("url") || p.get("text")?.match(/https?:\/\/\S+/)?.[0];
    if (shared || p.get("title")) {
      // one-off sync from the share-target URL into the form
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(shared ?? "");
      setTitle(p.get("title") ?? "");
      setNote(p.get("text") && p.get("text") !== shared ? p.get("text")! : "");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [loaded]);

  const domainGuess = GUESS.find(([re]) => re.test(url.toLowerCase()))?.[1];
  function save() {
    if (!url && !title && !note) return;
    let host = "";
    try { host = url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch {}
    addVault({ url: url || undefined, title: title || host || note.slice(0, 60), note: note || undefined,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean), domain: domainGuess });
    setUrl(""); setTitle(""); setNote(""); setTags("");
  }

  const shown = useMemo(() => vault.filter((v) => (!filter || v.domain === filter || v.tags.includes(filter)) &&
    `${v.title} ${v.note ?? ""} ${v.tags.join(" ")} ${v.url ?? ""}`.toLowerCase().includes(q.toLowerCase())), [vault, q, filter]);
  const allTags = useMemo(() => [...new Set(vault.flatMap((v) => v.tags))].slice(0, 30), [vault]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl md:text-5xl">Vault</h1>
          <p className="text-sm text-muted">Links, ideas and things to keep. On your phone: Share → CineGraph adds it here.</p>
        </div>
        <button className="btn-ghost text-sm" onClick={() => exportObsidian()}>Export to Obsidian (.zip)</button>
      </header>
      <form className="card grid gap-2 p-4 md:grid-cols-[2fr_1.5fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (Marmiton recipe, Pinterest pin, video, article…)" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma, separated" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
        <button className="btn">Save</button>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Idea / note (Markdown welcome)" rows={2} className="rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent md:col-span-4" />
        {domainGuess && <p className="text-xs text-muted md:col-span-4">Filed under {DOMAINS.find((d) => d.name === domainGuess)?.label}</p>}
      </form>
      <div className="flex flex-wrap items-center gap-1.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="mr-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent" />
        <button className="chip" data-on={!filter} onClick={() => setFilter(null)}>All ({vault.length})</button>
        {DOMAINS.filter((d) => vault.some((v) => v.domain === d.name)).map((d) => <button key={d.name} className="chip" data-on={filter === d.name} onClick={() => setFilter(d.name)}>{d.emoji} {d.short}</button>)}
        {allTags.map((t) => <button key={t} className="chip text-xs" data-on={filter === t} onClick={() => setFilter(filter === t ? null : t)}>#{t}</button>)}
      </div>
      {loaded && !vault.length && <p className="text-sm text-muted">Empty. Paste a link above, or use “Save to vault” on any card.</p>}
      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((v) => (
          <li key={v.id} className="card flex gap-3 p-3">
            {v.image && <img src={v.image} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" referrerPolicy="no-referrer" />}
            <div className="min-w-0 flex-1">
              {v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="line-clamp-2 font-semibold hover:text-accent">{v.title}</a> : <p className="font-semibold">{v.title}</p>}
              {v.note && <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm text-ink/80">{v.note}</p>}
              <p className="mt-1 text-[11px] text-muted">{v.tags.map((t) => `#${t}`).join(" ")} · {new Date(v.created).toLocaleDateString("fr-FR")}</p>
            </div>
            <button onClick={() => removeVault(v.id)} className="self-start text-xs text-muted hover:text-nope" aria-label="Delete">✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
