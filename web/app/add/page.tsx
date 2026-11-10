"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useMemo, useState } from "react";
import EntityImage from "@/components/EntityImage";
import { detailHref } from "@/components/RecCard";
import { hostOf, tokens } from "@/lib/custom";
import { DOMAIN, DOMAINS } from "@/lib/domains";
import { answer } from "@/lib/engine/learn";
import { useDomain, useSpace } from "@/lib/hooks";
import { guessSpace, linkMeta } from "@/lib/meta";
import { type Action, addCustom, removeCustom, setSpace, useStore } from "@/lib/store";
import { normTitle } from "@/lib/text";

const FEEL: [Action, string][] = [
  ["loved", "I love it"],
  ["liked", "I like it"],
  ["want", "Want to try"],
];

/** Add your own things to the current space: any link, or just a name. */
export default function AddPage() {
  const space = useSpace();
  const cfg = DOMAIN[space];
  const { data: d } = useDomain(space);
  const custom = useStore((s) => s.custom.filter((c) => c.domain === space));
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [image, setImage] = useState<string | undefined>();
  const [subtitle, setSubtitle] = useState("");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // in films the catalogue is matched instead (posters, cast... come from TMDB)
  const filmHits = useMemo(() => {
    if (space !== "films" || !d || title.length < 2) return [];
    const q = normTitle(title);
    return d.entities.filter((e) => normTitle(e.title).includes(q) || normTitle(e.film?.ot).includes(q)).slice(0, 12);
  }, [space, d, title]);

  async function preview(u: string) {
    setUrl(u);
    if (!/^https?:\/\//.test(u)) return;
    const g = guessSpace(u);
    if (g && g !== space && DOMAIN[g]) setMsg(`This looks like ${DOMAIN[g].label}. `);
    setBusy(true);
    const m = await linkMeta(u);
    setBusy(false);
    if (m.title) setTitle(m.title);
    if (m.image) setImage(m.image);
    setSubtitle([m.author, m.provider ?? hostOf(u)].filter(Boolean).join(" · "));
    if (m.description) setNote(m.description.slice(0, 280));
    // suggest tags from the catalogue's vocabulary
    if (d && (m.title || m.description)) {
      const vocab = new Map<string, number>();
      for (const e of d.entities) for (const t of e.tags) vocab.set(t.toLowerCase(), (vocab.get(t.toLowerCase()) ?? 0) + 1);
      const words = new Set(tokens(`${m.title} ${m.description ?? ""}`));
      const sugg = [...vocab.keys()].filter((t) => t.split(" ").every((w) => words.has(w))).slice(0, 5);
      if (sugg.length) setTags(sugg.join(", "));
    }
  }

  async function save(feel: Action) {
    if (!title.trim()) return;
    const [id] = addCustom([{ domain: space, title: title.trim(), subtitle: subtitle || undefined, url: url || undefined, image,
      tags: tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean), note: note || undefined, source: "manual" }]);
    // let the merged catalogue include the new item before learning from it
    setTimeout(() => answer(id, space, feel, { source: "added" }), 50);
    setMsg(`Added “${title.trim()}” to ${cfg.label}.`);
    setUrl(""); setTitle(""); setImage(undefined); setSubtitle(""); setTags(""); setNote("");
  }

  return (
    <div key={space} className="rise max-w-3xl space-y-6">
      <header>
        <h1 className="font-display text-4xl md:text-5xl">Add to {cfg.label}</h1>
        <p className="text-sm text-muted">
          {space === "films" ? "Find a film or series and tell us how you feel about it." : "Paste a link (brand site, track, playlist, recipe blog, video, article) or just type a name. It joins your taste profile."}
        </p>
      </header>

      {space !== "films" && (
        <div className="card space-y-3 p-4">
          <input value={url} onChange={(e) => preview(e.target.value.trim())} placeholder="https://…" autoFocus
                 className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 outline-none focus:border-accent" />
          <div className="flex gap-3">
            {image ? <img src={image} alt="" className="h-24 w-24 shrink-0 rounded-xl object-cover" referrerPolicy="no-referrer" /> :
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-panel-2 text-3xl">{busy ? "…" : cfg.emoji}</div>}
            <div className="flex-1 space-y-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name / title"
                     className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags: e.g. techno, minimal, berlin"
                     className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
            </div>
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Why you like it (helps your profile and your second brain)"
                    className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
          {msg?.startsWith("This looks like") && (
            <p className="text-xs text-accent">{msg}<button className="underline" onClick={() => { const g = guessSpace(url); if (g) setSpace(g); setMsg(null); }}>Switch space</button></p>
          )}
          <div className="grid grid-cols-3 gap-2">
            {FEEL.map(([a, l]) => <button key={a} className="btn-ghost" disabled={!title.trim()} onClick={() => save(a)}>{l}</button>)}
          </div>
        </div>
      )}

      {space === "films" && (
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Search a film or series…" autoFocus
                 className="w-full rounded-xl border border-line bg-panel px-4 py-3 outline-none focus:border-accent" />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {filmHits.map((e) => (
              <Link key={e.key} href={detailHref(e.key)} className="card overflow-hidden">
                <EntityImage e={e} aspect="2/3" />
                <p className="line-clamp-2 p-2 text-xs">{e.title} <span className="text-muted">{e.film?.y}</span></p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {msg && !msg.startsWith("This looks like") && <p className="text-sm text-like">{msg}</p>}

      {custom.length > 0 && (
        <section>
          <h2 className="mb-2 font-display text-2xl">Your additions</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {custom.slice().reverse().map((c) => (
              <li key={c.id} className="card flex items-center gap-3 p-2">
                {c.image ? <img src={c.image} alt="" className="h-12 w-12 rounded-lg object-cover" referrerPolicy="no-referrer" /> : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-panel-2">{cfg.emoji}</span>}
                <Link href={detailHref(c.id)} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.title}</p>
                  <p className="truncate text-xs text-muted">{c.tags.join(", ") || c.subtitle}</p>
                </Link>
                <button className="px-2 text-xs text-muted hover:text-nope" onClick={() => removeCustom(c.id)}>✕</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-muted/70">Spaces: {DOMAINS.map((x) => x.short).join(" · ")}. Link previews come from noembed.com / microlink.io.</p>
    </div>
  );
}
