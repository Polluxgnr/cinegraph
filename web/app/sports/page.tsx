"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { MatchDetail, MaybeLink, toggleTeam, useLoad } from "@/components/SportsBits";
import { useT } from "@/lib/i18n";
import { dayKey, ELSEWHERE, hasSummary, type Injury, injuries, type League, leagueById, type Match, matchHref, monthBoard, type News, news, scoreboard, sideHref, sportOf, SPORTS, standings, type Table } from "@/lib/sports";
import { useQueryParam } from "@/lib/hooks";
import { useStore } from "@/lib/store";

type Tab = "results" | "fixtures" | "calendar" | "table" | "news" | "injuries";

/**
 * Sports: pick a sport and a competition; see recent results, upcoming fixtures (with odds when the bookmakers
 * publish them), the table, news and injuries. Star your teams: they come first everywhere and on "My teams".
 */
export default function SportsPage() {
  const T = useT();
  const [c, setC] = useQueryParam("c"); // the competition, in the URL so back links and shares land on it
  const league = leagueById(c) ?? SPORTS[0].leagues[0];
  const sport = sportOf(league);
  const [tab, setTab] = useState<Tab>("results");
  const mine = useStore((s) => s.settings.sportsTeams ?? []);

  const tabs: [Tab, string][] = [["results", "Results"], ["fixtures", "Fixtures"], ["calendar", "Calendar"], ["table", "Standings"], ["news", "News"], ...(league.injuries ? [["injuries", "Injuries"] as [Tab, string]] : [])];
  const pick = (id: string) => {
    setC(id);
    setTab("results");
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-4xl md:text-5xl">{T("Sports")}</h1>
          <p className="text-sm text-muted">{sport.icon} {T(sport.label)} · <b className="text-ink">{league.label}</b></p>
        </div>
        {mine.length > 0 && <p className="max-w-md truncate text-xs text-muted">★ {mine.join(" · ")}</p>}
      </header>

      <Competitions current={league.id} onPick={pick} />

      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition ${tab === k ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>{T(l)}</button>
        ))}
      </div>

      {(tab === "results" || tab === "fixtures") && <Matches key={`${league.id}-${tab}`} league={league} past={tab === "results"} mine={mine} />}
      {tab === "calendar" && <Calendar key={league.id} league={league} mine={mine} />}
      {tab === "table" && <Standings key={league.id} league={league} mine={mine} />}
      {tab === "news" && <NewsList key={league.id} league={league} />}
      {tab === "injuries" && <Injuries key={league.id} league={league} mine={mine} />}

      <section className="space-y-2 pt-6">
        <h2 className="font-display text-2xl">{T("Other sports")}</h2>
        <p className="text-xs text-muted">{T("No open live feed exists for these: their official sites have results, rankings and calendars.")}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ELSEWHERE.map((s) => (
            <div key={s.label} className="card p-3">
              <p className="font-medium">{s.icon} {T(s.label)}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">{s.links.map(([l, u]) => <a key={u} className="chip text-xs" href={u} target="_blank" rel="noreferrer">{l} ↗</a>)}</div>
            </div>
          ))}
        </div>
      </section>
      <p className="text-[11px] text-muted/80">{T("Data: ESPN's public scores feed. Odds are shown for information only, when bookmakers publish them for a fixture.")}</p>
    </div>
  );
}

/** Every sport and competition in one scrollable panel, with a search, so nothing is two taps away. */
function Competitions({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  const T = useT();
  const [q, setQ] = useState("");
  const n = q.trim().toLowerCase();
  const groups = SPORTS.map((s) => ({ s, ls: s.leagues.filter((l) => !n || `${l.label} ${T(s.label)} ${s.label}`.toLowerCase().includes(n)) })).filter((g) => g.ls.length);
  return (
    <section className="card p-3" data-testid="competitions">
      <div className="mb-2 flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder={T("Find a competition: Copa del Rey, NBA, F1…")}
               className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm outline-none focus:border-accent" />
        <span className="shrink-0 text-[11px] text-muted">{SPORTS.reduce((k, s) => k + s.leagues.length, 0)} {T("competitions")}</span>
      </div>
      <div className="max-h-56 space-y-2 overflow-y-auto pr-1 md:max-h-64">
        {groups.map(({ s, ls }) => (
          <div key={s.id} className="flex gap-2">
            <span className="w-28 shrink-0 pt-1 text-xs text-muted">{s.icon} {T(s.label)}</span>
            <div className="flex flex-wrap gap-1.5">
              {ls.map((l) => <button key={l.id} className="chip text-xs" data-on={l.id === current} onClick={() => onPick(l.id)}>{l.label}</button>)}
            </div>
          </div>
        ))}
        {!groups.length && <p className="text-sm text-muted">{T("No competition by that name.")}</p>}
      </div>
    </section>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A month of the competition: each day with its matches, tap a day to see them. */
function Calendar({ league, mine }: { league: League; mine: string[] }) {
  const T = useT();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const key = `${month.getFullYear()}${String(month.getMonth() + 1).padStart(2, "0")}`;
  const { data, err } = useLoad(() => monthBoard(league, key), [league.id, key]);
  const today = dayKey(new Date().toISOString());
  const [day, setDay] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const g = new Map<string, Match[]>();
    for (const m of data ?? []) g.set(dayKey(m.date), [...(g.get(dayKey(m.date)) ?? []), m]);
    return g;
  }, [data]);
  const first = (month.getDay() + 6) % 7; // Monday first
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const sel = day ?? (byDay.has(today) ? today : [...byDay.keys()].find((k) => k >= today) ?? null);
  const shift = (n: number) => { setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1)); setDay(null); };
  return (
    <div className="space-y-4" data-testid="calendar">
      <div className="flex items-center justify-between">
        <button className="btn-ghost px-3 py-1" onClick={() => shift(-1)} aria-label={T("Previous month")}>←</button>
        <p className="font-display text-2xl capitalize">{month.toLocaleDateString(T.lang, { month: "long", year: "numeric" })}</p>
        <button className="btn-ghost px-3 py-1" onClick={() => shift(1)} aria-label={T("Next month")}>→</button>
      </div>
      {err && <p className="card p-3 text-sm text-nope">{T("Couldn't load")}: {err}</p>}
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">{WEEKDAYS.map((w) => <span key={w}>{T(w)}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} />;
          const k = `${key}${String(d).padStart(2, "0")}`;
          const ms = byDay.get(k) ?? [];
          const fav = ms.some((m) => m.sides.some((s) => mine.includes(s.name)));
          return (
            <button key={k} onClick={() => setDay(k)} disabled={!ms.length} data-on={sel === k}
                    className={`min-h-14 rounded-lg border p-1 text-left text-[11px] transition disabled:opacity-40 ${sel === k ? "border-accent bg-accent/10" : "border-line/60 hover:border-accent"} ${k === today ? "ring-1 ring-accent/60" : ""}`}>
              <span className="block font-medium tabular-nums">{d}</span>
              {ms.length > 0 && <span className={`mt-0.5 block truncate ${fav ? "text-accent" : "text-muted"}`}>{fav ? "★ " : ""}{ms.length} {ms.length > 1 ? T("events") : T("event")}</span>}
            </button>
          );
        })}
      </div>
      {!data && !err && <div className="card h-24 animate-pulse" />}
      {data && !data.length && <p className="text-sm text-muted">{T("Nothing scheduled this month.")}</p>}
      {sel && byDay.get(sel) && (
        <section className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-[0.18em] text-muted">{new Date(byDay.get(sel)![0].date).toLocaleDateString(T.lang, { weekday: "long", day: "numeric", month: "long" })}</h3>
          {byDay.get(sel)!.map((m, i) => <MatchCard key={m.id} m={m} mine={mine} delay={i} league={league} />)}
        </section>
      )}
    </div>
  );
}

function Matches({ league, past, mine }: { league: League; past: boolean; mine: string[] }) {
  const T = useT();
  const { data, err } = useLoad(() => (past ? scoreboard(league, -7, 0) : scoreboard(league, 0, 14)));
  const [onlyMine, setOnlyMine] = useState(false);
  const list = useMemo(() => {
    let m = (data ?? []).filter((x) => (past ? x.state !== "pre" : x.state !== "post"));
    if (onlyMine) m = m.filter((x) => x.sides.some((s) => mine.includes(s.name)));
    return past ? m.reverse() : m;
  }, [data, past, onlyMine, mine]);
  const byDay = useMemo(() => {
    const g = new Map<string, Match[]>();
    for (const m of list) {
      const k = new Date(m.date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
      g.set(k, [...(g.get(k) ?? []), m]);
    }
    return [...g];
  }, [list]);

  if (err) return <p className="card p-4 text-sm text-nope">{T("Couldn't load")}: {err}</p>;
  if (!data) return <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="card h-20 animate-pulse" />)}</div>;
  return (
    <div className="space-y-4">
      {mine.length > 0 && <button className="chip text-xs" data-on={onlyMine} onClick={() => setOnlyMine(!onlyMine)}>★ {T("My teams")}</button>}
      {!byDay.length && <p className="text-sm text-muted">{past ? T("No results in the last 7 days.") : T("No fixtures in the next 2 weeks.")}</p>}
      {byDay.map(([day, ms]) => (
        <section key={day} className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-[0.18em] text-muted">{day}</h3>
          {ms.map((m, i) => <MatchCard key={m.id} m={m} mine={mine} delay={i} league={league} />)}
        </section>
      ))}
    </div>
  );
}

function MatchCard({ m, mine, delay, league }: { m: Match; mine: string[]; delay: number; league: League }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const many = m.sides.length > 2;
  const time = new Date(m.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <motion.article initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(delay, 10) * 0.025 }}
                    className={`card p-3 ${m.sides.some((s) => mine.includes(s.name)) ? "border-accent/60" : ""}`}>
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span className="truncate">{many ? m.name : m.note ?? ""}</span>
        <span className={`shrink-0 ${m.state === "in" ? "font-semibold text-nope" : ""}`}>{m.state === "pre" ? time : m.state === "in" ? `● ${m.status}` : m.status}</span>
      </div>
      <ul className={many ? "grid gap-x-6 sm:grid-cols-2" : "space-y-1"}>
        {m.sides.map((s, k) => (
          <li key={`${s.name}-${k}`} className={`flex items-center gap-2 text-sm ${s.winner ? "font-semibold" : m.state === "post" ? "text-ink/70" : ""}`}>
            {many && <span className="w-5 text-right tabular-nums text-muted">{s.rank ?? k + 1}</span>}
            {/* eslint-disable-next-line @next/next/no-img-element -- team logo / flag */}
            {s.logo ? <img src={s.logo} alt="" className="h-5 w-5 object-contain" loading="lazy" /> : <span className="h-5 w-5" />}
            <MaybeLink href={sideHref(league, s)} className="min-w-0 flex-1 truncate">{s.name}</MaybeLink>
            <button className={`text-xs ${mine.includes(s.name) ? "text-accent" : "text-muted/50 hover:text-accent"}`} onClick={() => toggleTeam(s.name)}
                    aria-label={mine.includes(s.name) ? T("Unfollow") : T("Follow")} title={mine.includes(s.name) ? T("Unfollow") : T("Follow")}>★</button>
            {s.score && m.state !== "pre" && <span className="w-16 text-right font-display text-lg tabular-nums">{s.score}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-muted">
        {m.venue && <span>📍 {m.venue}</span>}
        {m.odds && <span>📊 {T("Odds")}: {m.odds}</span>}
        {m.link && <a className="hover:text-accent" href={m.link} target="_blank" rel="noreferrer">ESPN ↗</a>}
        <Link className="ml-auto text-accent hover:underline" href={matchHref(league, m.id, { date: m.date, eventId: m.eventId })} data-testid="match-page">{many || !hasSummary(league) ? T("Full results →") : T("Full match page →")}</Link>
      </p>
      {!many && (
        <button className="mt-2 w-full rounded-lg py-1 text-[11px] text-muted hover:bg-panel-2 hover:text-ink" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="match-more">
          {open ? T("Hide details ▴") : m.state === "pre" ? T("Form and preview ▾") : T("Events, stats and line-ups ▾")}
        </button>
      )}
      {open && <MatchDetail league={league} id={m.id} />}
    </motion.article>
  );
}

function Standings({ league, mine }: { league: League; mine: string[] }) {
  const T = useT();
  const { data, err } = useLoad<Table[]>(() => standings(league));
  if (err) return <p className="card p-4 text-sm text-muted">{T("No table for this competition (cups, tournaments and races are listed under Results).")}</p>;
  if (!data) return <div className="card h-96 animate-pulse" />;
  if (!data.length) return <p className="text-sm text-muted">{T("No table for this competition (cups, tournaments and races are listed under Results).")}</p>;
  return (
    <div className="space-y-6">
      {data.map((t) => (
        <section key={t.name} className="card overflow-x-auto p-3">
          {data.length > 1 && <h3 className="mb-2 font-medium">{t.name}</h3>}
          <table className="w-full text-sm tabular-nums">
            <thead className="text-[11px] uppercase tracking-wider text-muted">
              <tr><th className="w-8 text-left">#</th><th className="text-left">{T("Team")}</th><th>{T("P")}</th><th>{T("W")}</th><th>{T("D")}</th><th>{T("L")}</th><th>±</th><th className="text-right">{T("Pts")}</th></tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.team} className={`border-t border-line/50 ${mine.includes(r.team) ? "text-accent" : ""}`} title={r.note}>
                  <td className="py-1.5">{r.rank}</td>
                  <td className="flex items-center gap-2 py-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- team logo */}
                    {r.logo && <img src={r.logo} alt="" className="h-4 w-4 object-contain" loading="lazy" />}
                    <MaybeLink href={sideHref(league, r)} className="truncate">{r.team}</MaybeLink>{r.note && <span className="hidden text-[10px] text-muted md:inline">· {r.note}</span>}
                  </td>
                  <td className="text-center">{r.played}</td><td className="text-center">{r.won}</td><td className="text-center">{r.drawn}</td><td className="text-center">{r.lost}</td>
                  <td className="text-center">{r.diff}</td><td className="text-right font-semibold">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function NewsList({ league }: { league: League }) {
  const T = useT();
  const { data, err } = useLoad<News[]>(() => news(league));
  if (err) return <p className="card p-4 text-sm text-nope">{T("Couldn't load")}: {err}</p>;
  if (!data) return <div className="card h-64 animate-pulse" />;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((n) => (
        <a key={n.title} href={n.url} target="_blank" rel="noreferrer" className="group card overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- news photo */}
          {n.image && <img src={n.image} alt="" loading="lazy" className="aspect-video w-full object-cover transition duration-500 group-hover:scale-105" />}
          <div className="space-y-1 p-3">
            <p className="font-medium leading-snug group-hover:text-accent">{n.title}</p>
            {n.text && <p className="line-clamp-3 text-xs text-muted">{n.text}</p>}
            {n.date && <p className="text-[11px] text-muted">{new Date(n.date).toLocaleDateString()}</p>}
          </div>
        </a>
      ))}
    </div>
  );
}

function Injuries({ league, mine }: { league: League; mine: string[] }) {
  const T = useT();
  const { data, err } = useLoad<Injury[]>(() => injuries(league));
  const [team, setTeam] = useState<string | null>(null);
  if (err) return <p className="card p-4 text-sm text-nope">{T("Couldn't load")}: {err}</p>;
  if (!data) return <div className="card h-64 animate-pulse" />;
  const teams = [...new Set(data.map((x) => x.team))].sort((a, b) => Number(mine.includes(b)) - Number(mine.includes(a)) || a.localeCompare(b));
  const shown = data.filter((x) => !team || x.team === team);
  return (
    <div className="space-y-3">
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
        <button className="chip shrink-0 text-xs" data-on={!team} onClick={() => setTeam(null)}>{T("All")}</button>
        {teams.map((x) => <button key={x} className="chip shrink-0 text-xs" data-on={team === x} onClick={() => setTeam(team === x ? null : x)}>{mine.includes(x) ? "★ " : ""}{x}</button>)}
      </div>
      <ul className="divide-y divide-line/50">
        {shown.map((x, i) => (
          <li key={`${x.player}-${i}`} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
            <span className="font-medium">{x.player}</span>
            <span className={`text-xs ${/out/i.test(x.status) ? "text-nope" : "text-accent"}`}>{x.status}</span>
            <span className="text-xs text-muted">{x.team}</span>
            <span className="w-full text-xs text-ink/80">{x.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
