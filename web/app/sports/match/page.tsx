"use client";

import { BackToSports, MatchDetail, MaybeLink, useLoad } from "@/components/SportsBits";
import { useQueryParam } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { type League, leagueById, matchSummary, sideHref, sportOf, type Summary } from "@/lib/sports";

/** One match on its own page: the score, both sides (each leading to its page), then events, stats and line-ups. */
export default function MatchPage() {
  const T = useT();
  const [l] = useQueryParam("l");
  const [id] = useQueryParam("id");
  const league = leagueById(l);
  if (!league || !id) return <p className="card p-4">{T("Not found.")}</p>;
  return <MatchView key={`${league.id}-${id}`} league={league} id={id} />;
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
      <BackToSports />
      <header className="card p-5">
        <p className="mb-4 text-center text-[11px] uppercase tracking-[0.18em] text-muted">
          {sportOf(league).icon} {data.competition ?? league.label}{data.date ? ` · ${new Date(data.date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}` : ""}
        </p>
        {a && b ? (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <Side league={league} s={a} />
            <div className="text-center">
              {data.state === "pre" ? (
                <p className="font-display text-3xl">{data.date ? new Date(data.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "–"}</p>
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
