"use client";
import { useEffect, useMemo, useState } from "react";
import { withCustom } from "./custom";
import { DOMAIN } from "./domains";
import { setSpace, useLoaded, useStore } from "./store";
import { type DomainData, type FilmData, loadDomain, loadFilms, manifest } from "./data";
import type { Manifest } from "./types";

type Loadable<T> = { data: T | null; error: string | null };

function useLoad<T>(fn: () => Promise<T>, dep: string): Loadable<T> {
  const [state, setState] = useState<{ dep: string } & Loadable<T>>({ dep, data: null, error: null });
  useEffect(() => {
    let live = true;
    fn()
      .then((data) => live && setState({ dep, data, error: null }))
      .catch((e) => live && setState({ dep, data: null, error: String(e?.message ?? e) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);
  return state.dep === dep ? state : { data: null, error: null };
}

/** A domain's catalogue merged with your custom items (re-merged when you add one). */
export function useDomain(name: string): Loadable<DomainData> {
  const base = useLoad<DomainData>(() => loadDomain(name), name);
  const custom = useStore((s) => s.custom);
  const data = useMemo(() => (base.data ? withCustom(base.data, custom) : null), [base.data, custom]);
  return { data, error: base.error };
}
export const useFilms = () => useLoad<FilmData>(() => loadFilms(), "films");
export const useManifest = () => useLoad<Manifest>(() => manifest(), "manifest");

/** Read a query-string parameter on static pages (no server-side params with `output: export`). */
export function useQueryParam(name: string): [string | null, (v: string | null) => void] {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setValue(new URLSearchParams(window.location.search).get(name));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [name]);
  const set = (v: string | null) => {
    const p = new URLSearchParams(window.location.search);
    if (v == null) p.delete(name);
    else p.set(name, v);
    const q = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    setValue(v);
  };
  return [value, set];
}

/** The space (domain) the whole app is about right now. `?d=music` in a link switches to it. */
export function useSpace(): string {
  const space = useStore((s) => s.settings.space);
  const loaded = useLoaded();
  useEffect(() => {
    if (!loaded) return;
    const d = new URLSearchParams(window.location.search).get("d");
    if (d && DOMAIN[d]) setSpace(d);
  }, [loaded]);
  return DOMAIN[space] ? space : "films";
}
