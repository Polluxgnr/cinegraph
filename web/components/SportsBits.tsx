"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { type WikiBio, type WikiKind, wikiBio } from "@/lib/artistBio";
import { useT } from "@/lib/i18n";
import { athleteHref, type League, matchSummary, type Summary, teamHref } from "@/lib/sports";
import { getState, setSettings } from "@/lib/store";

/** Load once per mount; `null` while loading. */
export function useLoad<V>(fn: () => Promise<V>, deps: unknown[] = []): { data: V | null; err: string | null } {
  const [s, setS] = useState<{ data: V | null; err: string | null }>({ data: null, err: null });
  useEffect(() => {
    let live = true;
    fn().then((data) => live && setS({ data, err: null })).catch((e) => live && setS({ data: null, err: (e as Error).message }));
    return () => {
      live = false;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

export function toggleTeam(name: string) {
  const cur = getState().settings.sportsTeams ?? [];
  setSettings({ sportsTeams: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name] });
}

export function BackToSports() {
  const T = useT();
  return <Link href="/sports/" className="text-sm text-muted hover:text-ink">← {T("Sports")}</Link>;
}

/** A name that leads to its page when there is one. */
export function MaybeLink({ href, children, className = "" }: { href?: string; children: React.ReactNode; className?: string }) {
  return href ? <Link href={href} className={`hover:text-accent hover:underline ${className}`}>{children}</Link> : <span className={className}>{children}</span>;
}

/** What Wikipedia says about a club or an athlete, in the interface language, with the source. */
export function WikiCard({ name, kind, testid }: { name: string; kind: WikiKind; testid?: string }) {
  const T = useT();
  const [bio, setBio] = useState<WikiBio | null | undefined>(undefined);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let live = true;
    wikiBio(name, T.lang, kind).then((b) => live && setBio(b)).catch(() => live && setBio(null));
    return () => {
      live = false;
    };
  }, [name, T.lang, kind]);
  if (bio === undefined) return <div className="card h-28 animate-pulse" />;
  if (!bio) return null;
  return (
    <section className="card flex gap-4 p-4" data-testid={testid}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Wikipedia thumbnail */}
      {bio.image && <img src={bio.image} alt="" className="hidden h-28 w-28 shrink-0 rounded-xl object-cover sm:block" loading="lazy" />}
      <div className="min-w-0 space-y-2">
        {bio.description && <p className="text-[11px] uppercase tracking-[0.16em] text-muted">{bio.description}</p>}
        <p className={`text-sm leading-relaxed text-ink/90 ${more ? "" : "line-clamp-5"}`}>{bio.extract}</p>
        <div className="flex gap-3 text-xs">
          {bio.extract.length > 380 && <button className="text-accent hover:underline" onClick={() => setMore(!more)}>{more ? T("Less") : T("More")}</button>}
          <a className="text-muted hover:text-accent" href={bio.url} target="_blank" rel="noreferrer">{T("Source")}: Wikipedia ↗</a>
        </div>
      </div>
    </section>
  );
}

const EVENT_ICON = { goal: "⚽", yellow: "🟨", red: "🟥", sub: "🔁", other: "•" } as const;

/** One match opened: recent form, then events (goals, cards, changes), team stats with bars, line-ups, leaders. */
export function MatchDetail({ league, id, full = false }: { league: League; id: string; full?: boolean }) {
  const T = useT();
  const { data, err } = useLoad<Summary>(() => matchSummary(league, id), [league.id, id]);
  const [tab, setTab] = useState<"events" | "stats" | "lineups">("events");
  if (err) return <p className="mt-2 text-xs text-muted">{T("No details for this one.")}</p>;
  if (!data) return <div className="mt-2 h-24 animate-pulse rounded-lg bg-panel-2" />;
  const tabs = ([["events", "Events", data.events.length], ["stats", "Stats", data.stats.length], ["lineups", "Line-ups", data.lineups.length]] as const).filter((x) => x[2]);
  const cur = tabs.some((x) => x[0] === tab) ? tab : tabs[0]?.[0];
  const teamLink = (name: string) => {
    const i = data.teams.indexOf(name);
    const tid = i >= 0 ? data.teamIds[i] : undefined;
    return tid ? teamHref(league, tid) : undefined;
  };
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                className={`space-y-3 overflow-hidden ${full ? "text-sm" : "mt-2 border-t border-line pt-3 text-xs"}`} data-testid="match-detail">
      {data.form.length > 0 && (
        <div className="space-y-1">
          {data.form.map((f) => (
            <p key={f.team} className="flex items-center justify-between gap-2">
              <MaybeLink href={teamLink(f.team)} className="truncate text-muted">{f.team}</MaybeLink>
              <span className="flex gap-0.5">
                {f.results.split("").map((r, i) => (
                  <b key={i} className={`grid h-4 w-4 place-items-center rounded text-[9px] text-black ${r === "W" ? "bg-emerald-400" : r === "L" ? "bg-rose-400" : "bg-zinc-400"}`}>{r}</b>
                ))}
              </span>
            </p>
          ))}
        </div>
      )}
      {tabs.length > 1 && (
        <div className="flex gap-1">{tabs.map(([k, l]) => <button key={k} className="chip px-2 py-0.5 text-[11px]" data-on={cur === k} onClick={() => setTab(k)}>{T(l)}</button>)}</div>
      )}
      {cur === "events" && (
        <ol className="space-y-1">
          {data.events.map((e, i) => (
            <li key={i} className={`flex gap-2 ${e.kind === "sub" ? "text-muted" : ""} ${data.teams[1] && e.team === data.teams[1] ? "flex-row-reverse text-right" : ""}`}>
              <span className="w-8 shrink-0 tabular-nums text-muted">{e.minute}</span>
              <span>{EVENT_ICON[e.kind]}</span>
              <span className="min-w-0 truncate">{e.who ?? e.text}</span>
            </li>
          ))}
        </ol>
      )}
      {cur === "stats" && (
        <ul className="space-y-1.5">
          {data.stats.map((s) => (
            <li key={s.label}>
              <div className="flex justify-between tabular-nums"><b>{s.a}</b><span className="text-muted">{T(s.label)}</span><b>{s.b}</b></div>
              {s.share != null && <div className="mt-0.5 flex h-1 overflow-hidden rounded-full bg-panel-2"><div className="bg-accent" style={{ width: `${s.share * 100}%` }} /></div>}
            </li>
          ))}
        </ul>
      )}
      {cur === "lineups" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.lineups.map((l) => (
            <div key={l.team}>
              <p className="mb-1 font-semibold"><MaybeLink href={l.teamId ? teamHref(league, l.teamId) : undefined}>{l.team}</MaybeLink>{l.formation ? <span className="font-normal text-muted"> · {l.formation}</span> : null}</p>
              <ul className="space-y-0.5">
                {l.starters.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-5 text-right tabular-nums text-muted">{p.n}</span>
                    <MaybeLink href={p.id ? athleteHref(league, p.id) : undefined} className="truncate">{p.name}</MaybeLink>
                    <span className="ml-auto text-muted">{p.pos}</span>
                  </li>
                ))}
              </ul>
              {l.bench.length > 0 && (
                <p className="mt-1 text-muted">{T("Bench")}:{" "}
                  {l.bench.map((b, i) => <span key={i}>{i > 0 && ", "}<MaybeLink href={b.id ? athleteHref(league, b.id) : undefined}>{b.name}</MaybeLink></span>)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {data.leaders.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {data.leaders.map((l) => <div key={l.team}><p className="font-semibold">{l.team}</p>{l.lines.map((x) => <p key={x} className="text-muted">{x}</p>)}</div>)}
        </div>
      )}
      {(data.venue || data.attendance) && <p className="text-muted">{data.venue ? `📍 ${data.venue}` : ""}{data.attendance ? ` · ${data.attendance.toLocaleString()} ${T("spectators")}` : ""}</p>}
      {full && data.link && <p className="text-xs text-muted">{T("Source")}: <a className="hover:text-accent" href={data.link} target="_blank" rel="noreferrer">ESPN ↗</a></p>}
    </motion.div>
  );
}
