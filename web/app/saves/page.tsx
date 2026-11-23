"use client";

import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import AskPeople from "@/components/AskPeople";
import { useT } from "@/lib/i18n";
import { GROUP_LABEL, parseSaves, type SavedPost } from "@/lib/saves";
import { update, useStore } from "@/lib/store";
import { normTitle } from "@/lib/text";

const SpotMap = dynamic(() => import("@/components/SpotMap"), { ssr: false, loading: () => <div className="h-72 animate-pulse rounded-2xl bg-panel" /> });

type Sort = "saved" | "posted";

/**
 * Your Instagram saves, sorted and summarised (from the insta-saved analysis): categories grouped by theme,
 * a summary of each post, the tools it mentions with their links, the places on a map, and playbooks that
 * turn many saves into a plan.
 */
export default function SavesPage() {
  const T = useT();
  const lib = useStore((s) => s.saves);
  const [group, setGroup] = useState<string | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"tools" | "places" | "new" | null>(null);
  const [sort, setSort] = useState<Sort>("saved");
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(60);

  async function load(file: File) {
    try {
      const lib = parseSaves(JSON.parse(await file.text()));
      update((s) => {
        s.saves = lib;
      });
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const words = useMemo(() => normTitle(q).split(" ").filter((w) => w.length > 1), [q]);
  const posts = useMemo(() => {
    if (!lib) return [];
    const catGroup = new Map(lib.cats.map((c) => [c.id, c.group]));
    const out = lib.posts.filter((p) => {
      if (group && catGroup.get(p.cat) !== group) return false;
      if (cat && p.cat !== cat) return false;
      if (only === "tools" && !p.tools.length) return false;
      if (only === "places" && !p.place) return false;
      if (only === "new" && !p.isNew) return false;
      if (words.length) {
        const h = normTitle(`${p.title} ${p.what} ${p.tools.join(" ")} ${p.user} ${p.place?.name ?? ""}`);
        if (!words.every((w) => h.includes(w))) return false;
      }
      return true;
    });
    return sort === "posted" ? out.sort((a, b) => (b.posted ?? "").localeCompare(a.posted ?? "")) : out.sort((a, b) => a.order - b.order);
  }, [lib, group, cat, only, words, sort]);

  const groups = useMemo(() => [...new Set(lib?.cats.map((c) => c.group) ?? [])], [lib]);
  const cats = useMemo(() => (lib?.cats ?? []).filter((c) => !group || c.group === group).map((c) => ({ ...c, n: lib!.posts.filter((p) => p.cat === c.id).length })).filter((c) => c.n), [lib, group]);
  const points = useMemo(() => posts.filter((p) => p.place?.lat && p.place?.lng).map((p) => ({ id: String(p.i), lat: p.place!.lat!, lon: p.place!.lng!, label: `${p.place!.name} · ${p.title}`, color: "#fb7185" })), [posts]);

  if (!lib) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <h1 className="font-display text-4xl md:text-5xl">{T("Instagram saves")}</h1>
        <p className="text-muted">{T("Your saved posts, sorted into categories with a summary of each, the tools they mention and the places on a map. Import the library your insta-saved analysis produced (data.json): it stays in your memory and your private Gist, never online.")}</p>
        <label className="card flex cursor-pointer flex-col items-center gap-2 border-dashed p-8 text-center hover:border-accent"
               onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) load(f); }}>
          <span className="text-3xl">🔖</span>
          <span className="font-medium">{T("Drop data.json here, or click to choose it")}</span>
          <span className="text-xs text-muted">Documents/insta-saved/data.json</span>
          <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
        {err && <p className="card p-3 text-sm text-nope">{err}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{T("{n} posts · {c} categories", { n: lib.posts.length, c: lib.cats.length })}</p>
          <h1 className="font-display text-4xl md:text-5xl">{T("Instagram saves")}</h1>
        </div>
        <label className="btn-ghost cursor-pointer px-3 py-1.5 text-xs">
          {T("Update the library")}
          <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
      </header>

      <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder={T("Search a tool, a place, a creator, a topic…")}
             className="w-full rounded-xl border border-line bg-panel px-4 py-3 outline-none placeholder:text-muted/70 focus:border-accent" />

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <button className="chip" data-on={!group} onClick={() => { setGroup(null); setCat(null); }}>{T("All")} · {lib.posts.length}</button>
          {groups.map((g) => <button key={g} className="chip" data-on={group === g} onClick={() => { setGroup(group === g ? null : g); setCat(null); }}>{T(GROUP_LABEL[g] ?? g)}</button>)}
          <span className="mx-1 w-px bg-line" />
          {([["tools", "🧰 With tools"], ["places", "📍 With a place"], ["new", "✨ Saved recently"]] as const).map(([k, l]) => (
            <button key={k} className="chip" data-on={only === k} onClick={() => setOnly(only === k ? null : k)}>{T(l)}</button>
          ))}
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="chip bg-transparent" aria-label={T("Sort")}>
            <option value="saved">{T("Order saved")}</option>
            <option value="posted">{T("Newest posts first")}</option>
          </select>
        </div>
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {cats.map((c) => <button key={c.id} className="chip shrink-0 text-xs" data-on={cat === c.id} onClick={() => setCat(cat === c.id ? null : c.id)}>{c.name} · {c.n}</button>)}
        </div>
      </div>

      {!q && !cat && !only && lib.recs.length > 0 && (!group || group === "ai") && (
        <section className="space-y-3">
          <h2 className="font-display text-2xl md:text-3xl">{T("Playbooks from your saves")}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {lib.recs.map((r) => (
              <details key={r.title} className="card group p-4">
                <summary className="cursor-pointer list-none font-medium group-open:text-accent">{r.title}</summary>
                <p className="mt-2 text-sm leading-relaxed text-ink/85">{r.what}</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {r.posts.map((p) => <li key={p.url}><a className="text-muted hover:text-accent" href={p.url} target="_blank" rel="noreferrer">▸ {p.title} ↗</a></li>)}
                </ul>
              </details>
            ))}
          </div>
        </section>
      )}

      {points.length > 0 && (only === "places" || cat === "places" || group === "life") && <SpotMap points={points} className="h-72 md:h-96" />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {posts.slice(0, showAll).map((p, k) => <Post key={p.i} p={p} toolUrls={lib.toolUrls} catName={lib.cats.find((c) => c.id === p.cat)?.name ?? p.cat} delay={k} />)}
      </div>
      {posts.length > showAll && <button className="btn-ghost mx-auto block px-4 py-2 text-sm" onClick={() => setShowAll(showAll + 60)}>{T("Show more")} · {posts.length - showAll}</button>}
      {!posts.length && <p className="text-muted">{T("Nothing matches these filters.")}</p>}

      <AskPeople suggestions={[T("Best Claude Code setup tips"), T("Is this AI tool worth it?"), q || T("Best hidden spots in Paris")]} />
    </div>
  );
}

function Post({ p, toolUrls, catName, delay }: { p: SavedPost; toolUrls: Record<string, string>; catName: string; delay: number }) {
  const T = useT();
  return (
    <motion.article initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: Math.min(delay % 12, 8) * 0.03 }}
                    className="card flex flex-col gap-2 p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{catName}{p.isNew ? ` · ${T("new")}` : ""}</p>
      <a href={p.url} target="_blank" rel="noreferrer" className="font-medium leading-snug hover:text-accent">{p.title || `@${p.user}`} ↗</a>
      {p.what && <p className="text-sm leading-relaxed text-ink/85">{p.what}</p>}
      {p.tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.tools.map((tl) => toolUrls[tl]
            ? <a key={tl} href={toolUrls[tl]} target="_blank" rel="noreferrer" className="chip text-[11px]">🧰 {tl} ↗</a>
            : <span key={tl} className="chip text-[11px]">🧰 {tl}</span>)}
        </div>
      )}
      <p className="mt-auto pt-1 text-xs text-muted">
        @{p.user}{p.posted ? ` · ${p.posted}` : ""}{p.video ? " · 🎬" : ""}
        {p.place && <> · <a className="hover:text-accent" target="_blank" rel="noreferrer" href={p.place.lat ? `https://www.google.com/maps/search/?api=1&query=${p.place.lat},${p.place.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.place.name)}`}>📍 {p.place.name}</a></>}
      </p>
    </motion.article>
  );
}
