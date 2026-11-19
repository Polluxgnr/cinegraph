"use client";

import { useT } from "@/lib/i18n";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import EntityImage from "@/components/EntityImage";
import Match from "@/components/Match";
import { detailHref } from "@/components/RecCard";
import { loadSpace as loadDomain } from "@/lib/custom";
import type { DomainData } from "@/lib/data";
import { actionLabel, DOMAIN } from "@/lib/domains";
import { useSpace } from "@/lib/hooks";
import { scoreOne } from "@/lib/engine/recommend";
import { type Feedback, getState, type ListEntry, setList, useLoaded, useStore } from "@/lib/store";
import SagasPanel from "@/components/SagasPanel";
import { fmtRuntime } from "@/lib/text";

type Tab = "want" | "watching" | "loved" | "history" | "sagas";
type Sort = "added" | "release" | "match" | "title" | "length";

export default function Lists() {
  const T = useT();
  const [tab, setTab] = useState<Tab>("want");
  // /lists/?tab=sagas (old /sagas/ links land here too)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t) Promise.resolve().then(() => setTab(t));
  }, []);
  const space = useSpace();
  const [allSpaces, setAllSpaces] = useState(false);
  const dom = allSpaces ? "all" : space;
  const [sort, setSort] = useState<Sort>("added");
  const lists = useStore((s) => s.lists);
  const feedback = useStore((s) => s.feedback);
  const loaded = useLoaded();
  const [data, setData] = useState<Record<string, DomainData>>({});

  const rows: (ListEntry | Feedback)[] = useMemo(() => {
    if (tab === "sagas") return [];
    if (tab === "want" || tab === "watching") return Object.values(lists).filter((l) => l.status === tab);
    if (tab === "loved") return Object.values(feedback).filter((f) => f.action === "fav" || f.action === "loved" || (f.rating ?? 0) >= 4.5);
    return Object.values(feedback);
  }, [tab, lists, feedback]);
  const domains = useMemo(() => [...new Set(rows.map((r) => r.domain))], [rows]);

  useEffect(() => {
    domains.filter((d) => !data[d]).forEach((d) => loadDomain(d).then((dd) => setData((x) => ({ ...x, [d]: dd }))).catch(() => {}));
  }, [domains, data]);

  const items = useMemo(() => {
    if (!loaded) return [];
    return rows
      .filter((r) => dom === "all" || r.domain === dom)
      .map((r) => {
        const d = data[r.domain];
        const row = d?.index.get(r.key);
        if (!d || row == null) return null;
        const rec = sort === "match" ? scoreOne(d, getState(), row) : null;
        return { r, e: d.entities[row], rec, at: "added" in r ? r.added : r.at };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => {
        const pr = Number("priority" in b.r && !!b.r.priority) - Number("priority" in a.r && !!a.r.priority);
        if (pr) return pr; // "must watch soon" first
        switch (sort) {
          case "release": return Date.parse(b.e.date ?? "0") - Date.parse(a.e.date ?? "0");
          case "match": return (b.rec?.p ?? 0) - (a.rec?.p ?? 0);
          case "title": return a.e.title.localeCompare(b.e.title);
          case "length": return (a.e.film?.rt ?? 999) - (b.e.film?.rt ?? 999);
          default: return b.at - a.at;
        }
      });
  }, [rows, dom, data, sort, loaded]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-4xl md:text-5xl">{T("My")}{" "}{allSpaces ? "lists" : `${DOMAIN[space]?.short.toLowerCase()} list`}</h1>
        <label className="flex items-center gap-2 text-sm text-muted">{T("Sort")}<select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border border-line bg-panel px-2 py-1 text-ink">
            <option value="added">{T("Date added")}</option>
            <option value="release">{T("Release date")}</option>
            <option value="match">{T("Best match")}</option>
            <option value="title">{T("A–Z")}</option>
            <option value="length">{T("Shortest first")}</option>
          </select>
        </label>
      </header>
      <div className="flex flex-wrap gap-1.5">
        {([["want", "Watchlist"], ["watching", "In progress"], ["loved", "Loved"], ["history", "Diary"], ...(space === "films" ? [["sagas", "Sagas"]] : [])] as [Tab, string][]).map(([t, l]) => (
          <button key={t} className="chip" data-on={tab === t} onClick={() => setTab(t)}>{T(l)}</button>
        ))}
      </div>
      {tab === "sagas" && <SagasPanel embedded />}
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={allSpaces} onChange={(e) => setAllSpaces(e.target.checked)} /> {T("show every space (")}{rows.length})
      </label>
      {loaded && !rows.length && tab !== "sagas" && <p className="card p-4 text-sm text-muted">{T("Nothing here yet. Swipe, or tap “+ My list” on any card.")}</p>}
      <ul className="grid gap-2 md:grid-cols-2">
        {items.map(({ r, e, rec, at }) => (
          <li key={e.key} className="card flex gap-3 overflow-hidden p-2">
            <Link href={detailHref(e.key)} className="w-20 shrink-0 overflow-hidden rounded-lg">
              <EntityImage e={e} aspect={DOMAIN[e.domain]?.aspect === "2/3" ? "2/3" : "1/1"} />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col py-1">
              <Link href={detailHref(e.key)} className="truncate font-semibold hover:text-accent">
                {"priority" in r && r.priority && <span className="mr-1.5 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">{T("soon")}</span>}
                {e.title}
              </Link>
              <p className="truncate text-xs text-muted">
                {e.film ? [e.film.k === "tv" ? T("Series") : T("Film"), e.film.y, e.film.k === "tv" ? (e.film.ns ? T(e.film.ns === 1 ? "{n} season" : "{n} seasons", { n: e.film.ns }) : "") : fmtRuntime(e.film.rt)].filter(Boolean).join(" · ") : e.subtitle}
              </p>
              {rec && <Match p={rec.p} stars={rec.stars} compact />}
              <p className="mt-auto pt-1 text-[11px] text-muted">
                {"action" in r ? actionLabel(r.domain, r.action) : r.status === "watching" ? T("In progress") : T("On my list")} · {new Date(at).toLocaleDateString("fr-FR")}
              </p>
            </div>
            {"status" in r && (
              <button className="self-start px-2 text-xs text-muted hover:text-nope" onClick={() => setList(r.key, r.domain, null)}>{T("Remove")}</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
