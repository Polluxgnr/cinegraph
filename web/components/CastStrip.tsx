"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { FilmData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { personHref, personMeta, photoUrl, type PersonMeta } from "@/lib/people";
import { useStore } from "@/lib/store";
import type { Film } from "@/lib/types";

/** Portrait (TMDB photo, else initials). */
export function Face({ name, meta, size = 96 }: { name: string; meta?: PersonMeta; size?: number }) {
  const src = photoUrl(meta?.img);
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="relative shrink-0 overflow-hidden rounded-full bg-panel-2 ring-1 ring-line" style={{ width: size, height: size }}>
      {src
        // eslint-disable-next-line @next/next/no-img-element -- TMDB profile photo
        ? <img src={src} alt={name} loading="lazy" className="h-full w-full object-cover" />
        : <span className="absolute inset-0 grid place-items-center font-display text-xl text-muted">{initials}</span>}
    </div>
  );
}

/**
 * Who made it and who is in it: directors / creators / writers / composer, then the cast in billing order with
 * their character, each opening the person's page (photo, biography, whole career).
 */
export default function CastStrip({ d, f }: { d: FilmData; f: Film }) {
  const T = useT();
  const following = useStore((s) => s.settings.following ?? {});
  const crew: [number, string][] = [
    ...(f.dir ?? []).map((i) => [i, T("Director")] as [number, string]),
    ...(f.cre ?? []).map((i) => [i, T("Creator")] as [number, string]),
    ...(f.wri ?? []).slice(0, 3).map((i) => [i, T("Writer")] as [number, string]),
    ...(f.mus ?? []).slice(0, 1).map((i) => [i, T("Music")] as [number, string]),
  ];
  const cast: [number, string][] = (f.cast ?? []).map((i, k) => [i, f.chr?.[k] ?? ""]);
  const all = [...crew, ...cast].filter(([i], k, a) => a.findIndex(([j]) => j === i) === k || k >= crew.length);
  const [metas, setMetas] = useState<Record<number, PersonMeta>>({});
  useEffect(() => {
    let live = true;
    Promise.all(all.map(([i]) => personMeta(i).then((m) => [i, m] as const))).then((xs) => live && setMetas(Object.fromEntries(xs)));
    return () => {
      live = false;
    };
  }, [f.id, f.cast?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!all.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="font-display text-2xl">{T("Cast & crew")}</h2>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        {all.map(([i, role], k) => {
          const name = d.people[i];
          const fol = following[name];
          return (
            <motion.div key={`${i}-${k}`} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: Math.min(k, 10) * 0.03 }}
                        className="w-28 shrink-0 snap-start">
              <Link href={personHref(i, name)} className="group block text-center">
                <div className="mx-auto w-fit transition duration-300 group-hover:-translate-y-1 group-hover:drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)]">
                  <Face name={name} meta={metas[i]} />
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-medium leading-tight group-hover:text-accent">{name}{fol === 1 ? " ★" : ""}</p>
                {role && <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-muted">{role}</p>}
              </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
