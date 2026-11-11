"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import EntityImage from "@/components/EntityImage";
import { detailHref } from "@/components/RecCard";
import { DOMAIN } from "@/lib/domains";
import { recommend, type Rec } from "@/lib/engine/recommend";
import { useDomain, useSpace } from "@/lib/hooks";
import { getState, readProfileState, recordFeedback, type State, updateProfileState, useLoaded, useProfiles, useStore } from "@/lib/store";

interface Pair {
  key: string;
  a: Rec;
  b: Rec;
  together: number;
}

/** What two profiles will both enjoy: ranked by the weaker of the two matches, plus swipe-to-agree. */
export default function Together() {
  const space = useSpace();
  const cfg = DOMAIN[space];
  const loaded = useLoaded();
  const profiles = useProfiles();
  const version = useStore((s) => s.updatedAt);
  const { data: d } = useDomain(space);
  const others = profiles.list.filter((p) => p.id !== profiles.active);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const partner = others.find((p) => p.id === partnerId) ?? others[0];
  const me = profiles.list.find((p) => p.id === profiles.active)!;
  const [partnerState, setPartnerState] = useState<{ id: string; s: State } | null>(null);
  const [mode, setMode] = useState<"list" | "swipe">("list");
  const [votes, setVotes] = useState<Record<string, { a?: boolean; b?: boolean }>>({});
  const [matches, setMatches] = useState<string[]>([]);

  useEffect(() => {
    if (!partner) return;
    let live = true;
    readProfileState(partner.id).then((s) => live && setPartnerState({ id: partner.id, s }));
    return () => {
      live = false;
    };
  }, [partner, version]);

  const pairs: Pair[] = useMemo(() => {
    if (!d || !loaded || !partnerState || partnerState.id !== partner?.id) return [];
    const mine = recommend(d, getState(), { n: 250, explore: 0, diversity: 1, includeListed: true });
    const theirs = new Map(recommend(d, partnerState.s, { n: 250, explore: 0, diversity: 1, includeListed: true }).map((r) => [r.entity.key, r]));
    return mine
      .filter((r) => theirs.has(r.entity.key))
      .map((r) => {
        const b = theirs.get(r.entity.key)!;
        return { key: r.entity.key, a: r, b, together: Math.min(r.p, b.p) * 0.7 + Math.sqrt(r.p * b.p) * 0.3 };
      })
      .sort((x, y) => y.together - x.together)
      .slice(0, 40);
  }, [d, loaded, partnerState, partner, version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return null;
  if (!others.length) {
    return (
      <div className="max-w-xl space-y-3">
        <h1 className="font-display text-4xl">Pick together</h1>
        <p className="text-muted">Add a second profile first (top of the sidebar → New profile), let each person swipe a bit, then come back here to find what you&apos;ll both enjoy.</p>
      </div>
    );
  }

  const queue = pairs.filter((p) => !votes[p.key] || votes[p.key].a == null || votes[p.key].b == null);
  const current = queue[0];
  async function vote(who: "a" | "b", yes: boolean) {
    if (!current) return;
    const v = { ...votes[current.key], [who]: yes };
    setVotes({ ...votes, [current.key]: v });
    if (v.a != null && v.b != null) {
      const action = v.a && v.b ? "want" : null;
      if (action) {
        setMatches((m) => [current.key, ...m]);
        recordFeedback({ key: current.key, domain: space, action, source: "together" });
        await updateProfileState(partner.id, (s) => {
          s.feedback[current.key] = { key: current.key, domain: space, action, at: Date.now(), source: "together" };
          s.history.push(s.feedback[current.key]);
          s.lists[current.key] = { key: current.key, domain: space, added: Date.now(), status: "want", note: `with ${me.name}` };
        });
      }
    }
  }

  return (
    <div key={space} className="rise space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl md:text-5xl">Pick together</h1>
          <p className="text-sm text-muted">{cfg.label} that {me.emoji} {me.name} and {partner.emoji} {partner.name} will both like.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {others.length > 1 && (
            <select value={partner.id} onChange={(e) => setPartnerId(e.target.value)} className="chip bg-transparent">
              {others.map((o) => <option key={o.id} value={o.id}>{o.emoji} {o.name}</option>)}
            </select>
          )}
          <button className="chip" data-on={mode === "list"} onClick={() => setMode("list")}>Best matches</button>
          <button className="chip" data-on={mode === "swipe"} onClick={() => setMode("swipe")}>Swipe to agree</button>
        </div>
      </header>

      {!pairs.length && <div className="card h-64 animate-pulse" />}

      {mode === "list" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {pairs.slice(0, 20).map((p) => (
            <Link key={p.key} href={detailHref(p.key)} className="card overflow-hidden">
              <EntityImage e={p.a.entity} aspect={cfg.aspect} />
              <div className="space-y-1 p-3">
                <p className="line-clamp-2 font-semibold leading-snug">{p.a.entity.title}</p>
                <p className="text-xs text-muted">{p.a.entity.subtitle}</p>
                <p className="text-xs"><span className="text-like">{me.emoji} {Math.round(p.a.p * 100)}%</span> · <span className="text-unseen">{partner.emoji} {Math.round(p.b.p * 100)}%</span></p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {mode === "swipe" && current && (
        <div className="mx-auto max-w-sm space-y-3">
          <div className="card overflow-hidden">
            <EntityImage e={current.a.entity} aspect={cfg.aspect} big />
            <div className="p-4">
              <p className="font-display text-2xl">{current.a.entity.title}</p>
              <p className="text-xs text-muted">{current.a.entity.subtitle}</p>
            </div>
          </div>
          {(["a", "b"] as const).map((who) => {
            const prof = who === "a" ? me : partner;
            const voted = votes[current.key]?.[who];
            return (
              <div key={who} className="flex items-center gap-2">
                <span className="w-28 truncate text-sm">{prof.emoji} {prof.name}</span>
                <button className="btn-ghost flex-1 text-nope disabled:opacity-40" disabled={voted != null} onClick={() => vote(who, false)}>Nope</button>
                <button className="btn-ghost flex-1 text-like disabled:opacity-40" disabled={voted != null} onClick={() => vote(who, true)}>Yes</button>
              </div>
            );
          })}
          <p className="text-center text-xs text-muted">Both say yes → it goes on both lists.</p>
        </div>
      )}

      {matches.length > 0 && (
        <section>
          <h2 className="mb-2 font-display text-2xl">It&apos;s a match ({matches.length})</h2>
          <div className="flex flex-wrap gap-2">
            {matches.map((k) => {
              const p = pairs.find((x) => x.key === k);
              return p ? <Link key={k} href={detailHref(k)} className="chip">{p.a.entity.title}</Link> : null;
            })}
          </div>
        </section>
      )}
    </div>
  );
}
