"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BackToSports, useLoad, toggleTeam, WikiCard } from "@/components/SportsBits";
import { TEAM } from "@/lib/artistBio";
import AskPeople from "@/components/AskPeople";
import { useQueryParam } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { wikiHint, athleteHref, type Game, type League, leagueById, matchHref, sportOf, type Team, team, teamHref } from "@/lib/sports";
import { useStore } from "@/lib/store";

/** A club or franchise: who they are (Wikipedia), where they stand, their season's results and fixtures, the squad. */
export default function TeamPage() {
  const T = useT();
  const [l] = useQueryParam("l");
  const [id] = useQueryParam("id");
  const league = leagueById(l);
  if (!league || !id) return <p className="card p-4">{T("Not found.")}</p>;
  return <TeamView key={`${league.id}-${id}`} league={league} id={id} />;
}

function TeamView({ league, id }: { league: League; id: string }) {
  const T = useT();
  const { data: t, err } = useLoad<Team>(() => team(league, id), [league.id, id]);
  const mine = useStore((s) => s.settings.sportsTeams ?? []);
  if (err) return <p className="card p-4 text-sm text-nope">{T("Couldn't load")}: {err}</p>;
  if (!t) return <div className="space-y-4"><div className="card h-40 animate-pulse" /><div className="card h-64 animate-pulse" /></div>;
  const followed = mine.includes(t.name);
  const sport = sportOf(league);
  return (
    <div className="space-y-8" data-testid="team-page">
      <BackToSports />
      <header className="card relative overflow-hidden p-5" style={t.color ? { background: `linear-gradient(120deg, ${t.color}55, transparent 70%)` } : undefined}>
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- team crest */}
          {t.logo && <img src={t.logo} alt="" className="h-20 w-20 shrink-0 object-contain drop-shadow md:h-28 md:w-28" />}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{sport.icon} {league.label}{t.season ? ` · ${t.season}` : ""}</p>
            <h1 className="font-display text-4xl leading-tight md:text-5xl">{t.name}</h1>
            <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-ink/80">
              {t.standing && <span>🏆 {t.standing}</span>}
              {t.record && <span>{T("Record")}: <b className="tabular-nums">{t.record}</b></span>}
              {t.coach[0] && <span>{T("Coach")}: {t.coach[0]}</span>}
            </p>
          </div>
          <button className={followed ? "btn" : "btn-ghost"} onClick={() => toggleTeam(t.name)}>{followed ? `★ ${T("Following")}` : `☆ ${T("Follow")}`}</button>
        </div>
      </header>

      <WikiCard name={t.name} kind={TEAM} testid="team-bio" hint={wikiHint(league, "team")} />
      <Season league={league} games={t.games} />
      <Squad league={league} t={t} />
      <AskPeople key={t.id} title={T("What fans say")} suggestions={[T("{t}: what fans think of this season", { t: t.name }), T("{t}: best and worst signings", { t: t.name }), T("{t}: who should start?", { t: t.name })]} />

      <p className="text-[11px] text-muted">
        {T("Sources")}: {t.link && <a className="hover:text-accent" href={t.link} target="_blank" rel="noreferrer">ESPN ↗</a>} · Wikipedia (CC BY-SA)
      </p>
    </div>
  );
}

function Season({ league, games }: { league: League; games: Game[] }) {
  const T = useT();
  const done = games.filter((g) => g.done).reverse();
  const next = games.filter((g) => !g.done);
  const form = done.slice(0, 5).map((g) => g.result).filter(Boolean).join("");
  const w = done.filter((g) => g.result === "W").length, d = done.filter((g) => g.result === "D").length, lo = done.filter((g) => g.result === "L").length;
  if (!games.length) return null;
  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-2xl">{T("Results")}</h2>
          {done.length > 0 && (
            <span className="flex items-center gap-2 text-xs text-muted">
              <span className="tabular-nums">{w}{T("W")} {d}{T("D")} {lo}{T("L")}</span>
              <span className="flex gap-0.5">{form.split("").map((r, i) => <b key={i} className={`grid h-4 w-4 place-items-center rounded text-[9px] text-black ${r === "W" ? "bg-emerald-400" : r === "L" ? "bg-rose-400" : "bg-zinc-400"}`}>{r}</b>)}</span>
            </span>
          )}
        </div>
        {done.length ? <GameList league={league} games={done.slice(0, 12)} /> : <p className="text-sm text-muted">{T("No results yet this season.")}</p>}
      </div>
      <div>
        <h2 className="mb-2 font-display text-2xl">{T("Fixtures")}</h2>
        {next.length ? <GameList league={league} games={next.slice(0, 12)} /> : <p className="text-sm text-muted">{T("No fixtures announced.")}</p>}
      </div>
    </section>
  );
}

function GameList({ league, games }: { league: League; games: Game[] }) {
  return (
    <ul className="divide-y divide-line/50">
      {games.map((g) => (
        <li key={g.id} className="flex items-center gap-3 py-2 text-sm">
          <span className="w-16 shrink-0 text-xs text-muted">{new Date(g.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
          <span className="w-4 text-xs text-muted">{g.home ? "H" : "A"}</span>
          {/* eslint-disable-next-line @next/next/no-img-element -- crest */}
          {g.opponentLogo ? <img src={g.opponentLogo} alt="" className="h-5 w-5 object-contain" loading="lazy" /> : <span className="h-5 w-5" />}
          {g.opponentId ? <Link href={teamHref(league, g.opponentId)} className="min-w-0 flex-1 truncate hover:text-accent">{g.opponent}</Link> : <span className="min-w-0 flex-1 truncate">{g.opponent}</span>}
          <Link href={matchHref(league, g.id)} className={`shrink-0 rounded-md px-2 py-0.5 text-xs tabular-nums hover:ring-1 hover:ring-accent ${g.result === "W" ? "bg-emerald-400/20 text-emerald-300" : g.result === "L" ? "bg-rose-400/20 text-rose-300" : "bg-panel-2"}`}>
            {g.score ?? new Date(g.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Squad({ league, t }: { league: League; t: Team }) {
  const T = useT();
  const groups = useMemo(() => {
    const g = new Map<string, Team["players"]>();
    for (const p of t.players) g.set(p.pos ?? "", [...(g.get(p.pos ?? "") ?? []), p]);
    return [...g];
  }, [t.players]);
  const [q, setQ] = useState("");
  if (!t.players.length) return null;
  const match = (n: string) => !q || n.toLowerCase().includes(q.toLowerCase());
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl">{T("Squad")} <span className="text-base text-muted">({t.players.length})</span></h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={T("Find a player")} className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent" />
      </div>
      <div className="space-y-5">
        {groups.map(([pos, ps]) => {
          const shown = ps.filter((p) => match(p.name));
          if (!shown.length) return null;
          return (
            <div key={pos}>
              {pos && <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted">{pos}</p>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {shown.map((p) => (
                  <Link key={p.id} href={athleteHref(league, p.id)} className="card flex items-center gap-3 p-2.5 hover:border-accent" data-testid="squad-player">
                    {/* eslint-disable-next-line @next/next/no-img-element -- headshot */}
                    {p.photo ? <img src={p.photo} alt="" className="h-11 w-11 shrink-0 rounded-full bg-panel-2 object-cover" loading="lazy" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-panel-2 font-display text-lg text-muted">{p.jersey ?? "·"}</span>}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block truncate text-[11px] text-muted">{[p.jersey && `#${p.jersey}`, p.age && `${p.age} ${T("yrs")}`, p.nat].filter(Boolean).join(" · ")}</span>
                      {p.injured && <span className="block text-[11px] text-nope">✚ {p.injured}</span>}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
