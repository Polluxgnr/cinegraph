"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Face } from "@/components/CastStrip";
import type { FilmData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { careerInCatalog, personHref, personMeta, type PersonMeta, type Role, searchPeople } from "@/lib/people";

/** Actors and directors matching the search, most prolific first; each opens their page. */
export default function PeopleRow({ d, q, only }: { d: FilmData; q: string; only?: Role }) {
  const T = useT();
  const people = useMemo(() => {
    const ids = searchPeople(d, q, 30);
    return ids
      .map((i) => {
        const c = careerInCatalog(d, i);
        const count = (r: Role) => c.filter((x) => x.roles.includes(r)).length;
        const main: Role = count("Director") + count("Creator") >= Math.max(1, count("Actor") / 3) ? (count("Director") ? "Director" : "Creator") : "Actor";
        return { i, n: c.length, main, has: (r: Role) => count(r) > 0 };
      })
      .filter((p) => !only || p.has(only) || (only === "Director" && p.has("Creator")))
      .slice(0, 12);
  }, [d, q, only]);
  const [metas, setMetas] = useState<Record<number, PersonMeta>>({});
  useEffect(() => {
    let live = true;
    Promise.all(people.map((p) => personMeta(p.i).then((m) => [p.i, m] as const))).then((xs) => live && setMetas(Object.fromEntries(xs)));
    return () => {
      live = false;
    };
  }, [people]);

  if (!people.length) return null;
  return (
    <section className="space-y-2" data-testid="people-results">
      <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted">{T("People")}</h2>
      <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-1">
        {people.map((p) => (
          <Link key={p.i} href={personHref(p.i, d.people[p.i])} className="group w-24 shrink-0 text-center">
            <div className="mx-auto w-fit transition duration-300 group-hover:-translate-y-1"><Face name={d.people[p.i]} meta={metas[p.i]} size={80} /></div>
            <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-tight group-hover:text-accent">{d.people[p.i]}</p>
            <p className="text-[10px] text-muted">{T(p.main)} · {p.n}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
