"use client";

import Link from "next/link";
import { BackToSports, useLoad, WikiCard } from "@/components/SportsBits";
import { ATHLETE } from "@/lib/artistBio";
import AskPeople from "@/components/AskPeople";
import { useQueryParam } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { wikiHint, type Athlete, athlete, type League, leagueById, sportOf, teamHref } from "@/lib/sports";

/** A player, driver or fighter: who they are (Wikipedia), their profile and this season's numbers (ESPN). */
export default function AthletePage() {
  const T = useT();
  const [l] = useQueryParam("l");
  const [id] = useQueryParam("id");
  const league = leagueById(l);
  if (!league || !id) return <p className="card p-4">{T("Not found.")}</p>;
  return <AthleteView key={`${league.id}-${id}`} league={league} id={id} />;
}

function AthleteView({ league, id }: { league: League; id: string }) {
  const T = useT();
  const { data: a, err } = useLoad<Athlete>(() => athlete(league, id), [league.id, id]);
  if (err) return <p className="card p-4 text-sm text-nope">{T("Couldn't load")}: {err}</p>;
  if (!a) return <div className="space-y-4"><div className="card h-48 animate-pulse" /><div className="card h-40 animate-pulse" /></div>;
  const facts: [string, string | undefined][] = [
    ["Position", a.pos], ["Age", a.age ? `${a.age}` : undefined], ["Born", a.born], ["Birthplace", a.birthPlace],
    ["Nationality", a.nat], ["Height", a.height], ["Weight", a.weight], ["Number", a.jersey], ["Status", a.status],
  ];
  return (
    <div className="space-y-8" data-testid="athlete-page">
      <BackToSports league={league} />
      <header className="flex flex-wrap items-end gap-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- headshot */}
        {a.photo ? <img src={a.photo} alt="" className="h-36 w-36 rounded-2xl bg-panel object-cover md:h-44 md:w-44" />
          : <span className="grid h-36 w-36 place-items-center rounded-2xl bg-panel font-display text-6xl text-muted">{a.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span>}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{sportOf(league).icon} {league.label}</p>
          <h1 className="font-display text-4xl leading-tight md:text-6xl">{a.name}</h1>
          {a.team && (
            <p className="mt-2 flex items-center gap-2 text-sm">
              {/* eslint-disable-next-line @next/next/no-img-element -- crest */}
              {a.team.logo && <img src={a.team.logo} alt="" className="h-5 w-5 object-contain" />}
              {a.team.id ? <Link href={teamHref(league, a.team.id)} className="hover:text-accent hover:underline">{a.team.name}</Link> : a.team.name}
            </p>
          )}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {facts.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="card p-3">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">{T(k)}</dt>
            <dd className="mt-0.5 font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      <WikiCard name={a.name} kind={ATHLETE} testid="athlete-bio" hint={wikiHint(league, "athlete")} />

      {a.stats.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl">{a.statsTitle ?? T("This season")}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {a.stats.map((s) => (
              <div key={s.label} className="card p-3" title={s.hint}>
                <p className="font-display text-3xl tabular-nums">{s.value}</p>
                <p className="text-xs text-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <AskPeople key={a.id} title={T("What fans say")} suggestions={[T("{t}: what fans think of their form", { t: a.name }), T("{t}: strengths and weaknesses", { t: a.name })]} />
      <p className="text-[11px] text-muted">
        {T("Sources")}: {a.link && <a className="hover:text-accent" href={a.link} target="_blank" rel="noreferrer">ESPN ↗</a>} · Wikipedia (CC BY-SA)
      </p>
    </div>
  );
}
