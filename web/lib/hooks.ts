"use client";
import { useEffect, useState } from "react";
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

export const useDomain = (name: string) => useLoad<DomainData>(() => loadDomain(name), name);
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
