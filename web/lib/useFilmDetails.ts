"use client";
import { useEffect, useState } from "react";
import { filmDetails } from "./data";
import type { Film } from "./types";

/** Loads a film's details (synopsis, full cast...) and re-renders once they're merged in. */
export function useFilmDetails(f?: Film | null): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!f || f.full) return;
    let live = true;
    filmDetails(f).then(() => live && setV((x) => x + 1));
    return () => {
      live = false;
    };
  }, [f]);
  return v;
}
