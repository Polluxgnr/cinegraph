"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Face } from "@/components/CastStrip";
import RecCard, { detailHref } from "@/components/RecCard";
import { type FilmData, isFilmData } from "@/lib/data";
import { useDomain, useQueryParam } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { type Bio, careerInCatalog, personBio, personIndex, personMeta, type PersonMeta, type Role, rowOfTmdb, wikidataCareer, type Work } from "@/lib/people";
import { setSettings, getState, useStore } from "@/lib/store";
import { crowdRating } from "@/lib/text";
import { useRecs } from "@/lib/useRecs";

/** An actor's or director's page: photo, biography, what of theirs is in the catalogue (ranked for you), whole career. */
export default function PersonPage() {
  const T = useT();
  const [p] = useQueryParam("p");
  const [n] = useQueryParam("n");
  const [from] = useQueryParam("f");
  const { data } = useDomain("films");
  if (!data) return <div className="card h-96 animate-pulse" />;
  if (!isFilmData(data)) return null;
  // the index changes when the catalogue is rebuilt: trust the name when they disagree
  let idx = p != null ? Number(p) : undefined;
  // people beyond the first list (deeper cast) have no name there: the link's name stands in
  if (n && (idx == null || (data.people[idx] != null && data.people[idx] !== n))) idx = personIndex(data, n) ?? (data.people[idx ?? -1] == null ? idx : undefined);
  const name = idx != null ? data.people[idx] ?? n : undefined;
  if (idx == null || !name) return <p className="card p-4">{T("Not found in the catalogue.")}</p>;
  return <Person key={idx} d={data} idx={idx} name={name} from={from ?? undefined} />;
}

type Sort = "match" | "newest" | "rating";

function Person({ d, idx, name, from }: { d: FilmData; idx: number; name: string; from?: string }) {
  const T = useT();
  const [meta, setMeta] = useState<PersonMeta>({});
  const [bio, setBio] = useState<Bio | null | undefined>(undefined);
  const [works, setWorks] = useState<Work[] | null>(null);
  const [role, setRole] = useState<Role | "All">("All");
  const [sort, setSort] = useState<Sort>("match");
  const follow = useStore((s) => s.settings.following?.[name]);

  useEffect(() => {
    let live = true;
    personMeta(idx).then(async (m) => {
      if (!live) return;
      setMeta(m);
      const b = await personBio(m, name).catch(() => null);
      if (!live) return;
      setBio(b);
      if (b) wikidataCareer(b.qid).then((w) => live && setWorks(w)).catch(() => live && setWorks([]));
      else setWorks([]);
    });
    return () => {
      live = false;
    };
  }, [idx, name]);

  const career = useMemo(() => {
    const c = careerInCatalog(d, idx);
    // the catalogue keeps each title's main cast only: the title you came from always counts
    const row = from ? d.index.get(from) : undefined;
    if (row != null && !c.some((x) => x.row === row)) c.unshift({ row, roles: ["Actor"] });
    return c;
  }, [d, idx, from]);
  const roles = [...new Set(career.flatMap((c) => c.roles))];
  const keys = useMemo(() => new Set(career.filter((c) => role === "All" || c.roles.includes(role)).map((c) => d.entities[c.row].key)), [career, role, d]);
  const recs = useRecs(d, { n: 80, filter: (e) => keys.has(e.key), includeAnswered: true, includeListed: true, noCaps: true, diversity: 1, explore: 0 }, `person|${idx}|${role}`);
  const sorted = useMemo(() => {
    const r = [...(recs ?? [])];
    if (sort === "newest") r.sort((a, b) => (b.entity.film?.y ?? 0) - (a.entity.film?.y ?? 0));
    if (sort === "rating") r.sort((a, b) => (crowdRating(b.entity.film)?.v ?? 0) - (crowdRating(a.entity.film)?.v ?? 0));
    return r;
  }, [recs, sort]);

  const setFollow = (v: 1 | -1 | null) => {
    const cur = { ...(getState().settings.following ?? {}) };
    if (v == null) delete cur[name];
    else cur[name] = v;
    setSettings({ following: cur, followAt: { ...(getState().settings.followAt ?? {}), [name]: Date.now() } });
  };

  const others = (works ?? [])
    .filter((w) => !(w.tmdb && rowOfTmdb(d, w.tmdb, w.tv) != null && keys.has(d.entities[rowOfTmdb(d, w.tmdb, w.tv)!].key)))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const photo = meta.img ? meta : bio?.image ? { img: bio.image } : meta;
  const life = [bio?.born && `${T("Born")} ${fmtDate(bio.born)}${bio.birthplace ? `, ${bio.birthplace}` : ""}`, bio?.died && `${T("Died")} ${fmtDate(bio.died)}`].filter(Boolean).join(" · ");

  return (
    <div className="space-y-10">
      <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-6 text-center md:flex-row md:items-end md:text-left">
        <motion.div initial={{ scale: 0.9, rotate: -2 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 140, damping: 14 }}>
          <Face name={name} meta={photo} size={176} />
        </motion.div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{roles.map((r) => T(r)).join(" · ")}</p>
          <h1 className="font-display text-4xl md:text-6xl">{name}</h1>
          {bio?.description && <p className="text-sm text-muted">{bio.description}</p>}
          {life && <p className="text-xs text-muted">{life}</p>}
          <div className="flex flex-wrap justify-center gap-2 pt-1 md:justify-start">
            <button className={follow === 1 ? "btn px-3 py-1.5 text-sm" : "btn-ghost px-3 py-1.5 text-sm"} onClick={() => setFollow(follow === 1 ? null : 1)} data-testid="follow">
              {follow === 1 ? T("★ Following") : T("☆ Follow")}
            </button>
            <button className={`btn-ghost px-3 py-1.5 text-sm ${follow === -1 ? "border-nope text-nope" : ""}`} onClick={() => setFollow(follow === -1 ? null : -1)}>
              {follow === -1 ? T("✓ Avoided") : T("Not for me")}
            </button>
            {bio?.wikipedia && <a className="chip text-xs" href={bio.wikipedia} target="_blank" rel="noreferrer">Wikipedia ↗</a>}
            {meta.tm && <a className="chip text-xs" href={`https://www.themoviedb.org/person/${meta.tm}`} target="_blank" rel="noreferrer">TMDB ↗</a>}
          </div>
          <p className="text-[11px] text-muted">{T("Following someone makes their films count like two you loved; avoiding, like two you disliked.")}</p>
        </div>
      </motion.header>

      {bio === undefined ? <div className="card h-24 animate-pulse" /> : bio?.summary && (
        <section className="card max-w-3xl space-y-2 p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{T("Biography · Wikipedia")}</p>
          <p className="leading-relaxed text-ink/90">{bio.summary}</p>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-display text-2xl md:text-3xl">{T("In the catalogue")} <span className="text-muted">· {keys.size}</span></h2>
          <div className="flex flex-wrap gap-1.5">
            {roles.length > 1 && (["All", ...roles] as const).map((r) => <button key={r} className="chip text-xs" data-on={role === r} onClick={() => setRole(r)}>{T(r)}</button>)}
            <span className="mx-1 hidden w-px bg-line sm:block" />
            {(["match", "newest", "rating"] as Sort[]).map((s) => (
              <button key={s} className="chip text-xs" data-on={sort === s} onClick={() => setSort(s)}>{T(s === "match" ? "Best match" : s === "newest" ? "Newest first" : "Rating")}</button>
            ))}
          </div>
        </div>
        {!recs ? <div className="card h-64 animate-pulse" /> : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {sorted.map((r) => <RecCard key={r.entity.key} r={r} />)}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl md:text-3xl">{T("Whole career")}</h2>
        <p className="text-xs text-muted">{T("As Wikidata records it. Titles in the catalogue open their page; the others open Wikidata.")}</p>
        {works === null ? <div className="card h-40 animate-pulse" /> : !others.length ? <p className="text-sm text-muted">{T("Nothing more on record.")}</p> : (
          <ol className="grid gap-x-6 sm:grid-cols-2">
            {others.map((w) => {
              const row = w.tmdb ? rowOfTmdb(d, w.tmdb, w.tv) : undefined;
              const inner = (
                <>
                  <span className="w-12 shrink-0 tabular-nums text-muted">{w.year ?? "—"}</span>
                  <span className="min-w-0 flex-1 truncate group-hover:text-accent">{row != null ? d.entities[row].title : w.title}</span>
                  <span className="shrink-0 text-[11px] text-muted">{T(w.role)}{w.tv ? ` · ${T("Series")}` : ""}</span>
                </>
              );
              return (
                <li key={`${w.qid}-${w.role}`} className="border-b border-line/60">
                  {row != null
                    ? <Link href={detailHref(d.entities[row].key)} className="group flex items-baseline gap-3 py-2 text-sm">{inner}</Link>
                    : <a href={`https://www.wikidata.org/wiki/${w.qid}`} target="_blank" rel="noreferrer" className="group flex items-baseline gap-3 py-2 text-sm">{inner}</a>}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

function fmtDate(iso: string): string {
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? iso : dt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}
