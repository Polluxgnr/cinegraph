"use client";

import { useMemo } from "react";
import { BackToSports, MatchDetail, MaybeLink, useLoad } from "@/components/SportsBits";
import { useQueryParam } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { type EventDetail, eventDetail, hasSummary, type League, leagueById, type Match, matchSummary, sideHref, sportOf, type Summary } from "@/lib/sports";

/**
 * One event on its own page. A match (football, rugby, basketball...): the score, both sides, then events, stats and
 * line-ups. A race weekend, tennis tournament, fight card or golf event: every session, match or fight, in full.
 */
export default function MatchPage() {
  const T = useT();
  const [l] = useQueryParam("l");
  const [id] = useQueryParam("id");
  const [e] = useQueryParam("e");
  const [d] = useQueryParam("d");
  const league = leagueById(l);
  if (!league || !id) return <p className="card p-4">{T("Not found.")}</p>;
  return hasSummary(league)
    ? <MatchView key={`${league.id}-${id}`} league={league} id={id} />
    : <EventView key={`${league.id}-${e ?? id}`} league={league} eventId={e ?? id} focus={id} date={d ?? undefined} />;
}

function MatchView({ league, id }: { league: League; id: string }) {
  const T = useT();
  const { data, err } = useLoad<Summary>(() => matchSummary(league, id), [league.id, id]);
  if (err) return <p className="card p-4 text-sm text-nope">{T("Couldn't load")}: {err}</p>;
  if (!data) return <div className="card h-60 animate-pulse" />;
  const [a, b] = data.sides;
  const live = data.state === "in";
  return (
    <div className="space-y-6" data-testid="match-page-view">
      <BackToSports league={league} />
      <header className="card p-5">
        <p className="mb-4 text-center text-[11px] uppercase tracking-[0.18em] text-muted">
          {sportOf(league).icon} {data.competition ?? league.label}{data.date ? ` · ${new Date(data.date).toLocaleDateString(T.lang, { weekday: "long", day: "numeric", month: "long" })}` : ""}
        </p>
        {a && b ? (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <Side league={league} s={a} />
            <div className="text-center">
              {data.state === "pre" ? (
                <p className="font-display text-3xl">{data.date ? new Date(data.date).toLocaleTimeString(T.lang, { hour: "2-digit", minute: "2-digit" }) : "–"}</p>
              ) : (
                <p className="font-display text-5xl tabular-nums md:text-6xl">{a.score ?? "–"}<span className="mx-2 text-muted">–</span>{b.score ?? "–"}</p>
              )}
              <p className={`text-xs ${live ? "font-semibold text-nope" : "text-muted"}`}>{live ? "● " : ""}{data.status}</p>
            </div>
            <Side league={league} s={b} />
          </div>
        ) : <p className="text-center text-muted">{data.headline}</p>}
        {data.headline && a && <p className="mt-4 text-center text-sm text-ink/80">{data.headline}</p>}
      </header>
      <div className="card p-4"><MatchDetail league={league} id={id} full /></div>
    </div>
  );
}

function Side({ league, s }: { league: League; s: Summary["sides"][number] }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- crest */}
      {s.logo ? <img src={s.logo} alt="" className="h-14 w-14 object-contain md:h-20 md:w-20" /> : <span className="h-14 w-14" />}
      <MaybeLink href={sideHref(league, s)} className={`font-medium leading-tight ${s.winner ? "text-ink" : ""}`}>{s.name}</MaybeLink>
      {s.record && <span className="text-[11px] text-muted">{s.record}</span>}
    </div>
  );
}

/** A multi-part event: sessions (F1), rounds (tennis), fights (UFC) or the leaderboard (golf), grouped by round. */
function EventView({ league, eventId, focus, date }: { league: League; eventId: string; focus: string; date?: string }) {
  const T = useT();
  const { data, err } = useLoad<EventDetail>(() => eventDetail(league, eventId, date), [league.id, eventId, date]);
  const groups = useMemo(() => {
    const g = new Map<string, Match[]>();
    for (const m of data?.parts ?? []) g.set(m.kind ?? "", [...(g.get(m.kind ?? "") ?? []), m]);
    return [...g];
  }, [data]);
  if (err) return <p className="card p-4 text-sm text-nope">{T("Couldn't load")}: {err}</p>;
  if (!data) return <div className="card h-60 animate-pulse" />;
  const last = data.parts[data.parts.length - 1];
  return (
    <div className="space-y-6" data-testid="event-page-view">
      <BackToSports league={league} />
      <header className="card p-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{sportOf(league).icon} {league.label}</p>
        <h1 className="font-display text-3xl leading-tight md:text-5xl">{data.name}</h1>
        <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted">
          <span>{new Date(data.date).toLocaleDateString(T.lang, { day: "numeric", month: "long" })}{last && dayOf(last.date) !== dayOf(data.date) ? ` – ${new Date(last.date).toLocaleDateString(T.lang, { day: "numeric", month: "long", year: "numeric" })}` : ""}</span>
          {data.venue && <span>📍 {data.venue}</span>}
          <span>{data.parts.length} {data.parts.length > 1 ? T("parts") : T("part")}</span>
        </p>
      </header>
      {groups.map(([kind, parts]) => (
        <section key={kind || "all"} className="space-y-2">
          {kind && <h2 className="font-display text-2xl">{T(SESSION[kind] ?? kind)}</h2>}
          <div className={parts[0]?.sides.length > 2 ? "space-y-3" : "grid gap-2 sm:grid-cols-2"}>
            {parts.map((m) => <Part key={m.id} league={league} m={m} focus={m.id === focus && data.parts.length > 1} />)}
          </div>
        </section>
      ))}
      <p className="text-[11px] text-muted">{T("Source")}: {data.link ? <a className="hover:text-accent" href={data.link} target="_blank" rel="noreferrer">ESPN ↗</a> : "ESPN"}</p>
    </div>
  );
}

const dayOf = (iso: string) => new Date(iso).toDateString();
/** ESPN's session codes, in words. */
const SESSION: Record<string, string> = { FP1: "Practice 1", FP2: "Practice 2", FP3: "Practice 3", Qual: "Qualifying", Race: "Race", SR: "Sprint", SS: "Sprint qualifying", SQ: "Sprint qualifying" };

/** One session, match or fight: two sides face to face, or the full order with times, points or scores. */
function Part({ league, m, focus }: { league: League; m: Match; focus: boolean }) {
  const T = useT();
  const many = m.sides.length > 2;
  const when = new Date(m.date);
  return (
    <article className={`card p-3 ${focus ? "border-accent" : ""}`} data-testid="event-part">
      <p className="mb-2 flex justify-between gap-2 text-[11px] text-muted">
        <span>{m.note ?? when.toLocaleDateString(T.lang, { weekday: "short", day: "numeric", month: "short" })} · {when.toLocaleTimeString(T.lang, { hour: "2-digit", minute: "2-digit" })}</span>
        {m.state !== "pre" && <span className={m.state === "in" ? "font-semibold text-nope" : ""}>{m.state === "in" ? "● " : ""}{m.status}</span>}
      </p>
      {many ? (
        <ol className="max-h-[28rem] divide-y divide-line/40 overflow-y-auto text-sm">
          {m.sides.map((s, i) => (
            <li key={`${s.name}-${i}`} className={`flex items-center gap-2 py-1 ${i < 3 && m.state === "post" ? "font-medium" : ""}`}>
              <span className="w-7 text-right tabular-nums text-muted">{s.rank ?? i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element -- flag or crest */}
              {s.logo ? <img src={s.logo} alt="" className="h-4 w-5 object-contain" loading="lazy" /> : <span className="w-5" />}
              <MaybeLink href={sideHref(league, s)} className="min-w-0 flex-1 truncate">{s.name}</MaybeLink>
              {s.score && <span className="tabular-nums text-muted">{s.score}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <ul className="space-y-1">
          {m.sides.map((s, i) => (
            <li key={`${s.name}-${i}`} className={`flex items-center gap-2 text-sm ${s.winner ? "font-semibold" : m.state === "post" ? "text-ink/70" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- flag */}
              {s.logo ? <img src={s.logo} alt="" className="h-4 w-5 object-contain" loading="lazy" /> : <span className="w-5" />}
              <MaybeLink href={sideHref(league, s)} className="min-w-0 flex-1 truncate">{s.name}</MaybeLink>
              {s.winner && <span className="text-xs text-accent">✓</span>}
              {s.score && m.state !== "pre" && <span className="font-display tabular-nums">{s.score}</span>}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
