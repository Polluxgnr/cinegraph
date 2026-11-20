import { describe, expect, it } from "vitest";
import { crowdRating } from "../text";
import type { Entity, Film } from "../types";
import { activeFilters, swipeMatcher } from "./swipeFilter";

const film = (f: Partial<Film>): Entity => ({ key: `f${f.id ?? 1}`, domain: "films", title: f.t ?? "x", tags: [], pop: 1, film: { id: 1, k: "movie", t: "x", ...f } as Film }) as unknown as Entity;

describe("swipe filters", () => {
  it("nothing selected means no filter", () => {
    expect(activeFilters({})).toBe(0);
    expect(swipeMatcher({}, [])).toBeUndefined();
  });

  it("combines type, decade, length, rating, language and genres", () => {
    const m = swipeMatcher({ kind: "movie", decades: [1990], maxRt: 120, minRating: 7.5, lang: "other", genres: ["Crime"] }, [])!;
    const ok = film({ k: "movie", y: 1997, rt: 110, ir: 8.1, ic: 900, lang: "ko", g: ["Crime", "Drama"] });
    expect(m(ok)).toBe(true);
    expect(m(film({ ...ok.film, k: "tv" }))).toBe(false);
    expect(m(film({ ...ok.film, y: 2004 }))).toBe(false);
    expect(m(film({ ...ok.film, rt: 140 }))).toBe(false);
    expect(m(film({ ...ok.film, ir: 6.9 }))).toBe(false);
    expect(m(film({ ...ok.film, lang: "en" }))).toBe(false);
    expect(m(film({ ...ok.film, g: ["Comedy"] }))).toBe(false);
  });

  it("before 1980 is one bucket", () => {
    const m = swipeMatcher({ decades: [1970] }, [])!;
    expect(m(film({ y: 1954 }))).toBe(true);
    expect(m(film({ y: 1981 }))).toBe(false);
  });

  it("my platforms counts free French services", () => {
    const m = swipeMatcher({ mine: true }, ["Netflix"])!;
    expect(m(film({ prov: ["Netflix"] }))).toBe(true);
    expect(m(film({ prov: ["Arte"] }))).toBe(true);
    expect(m(film({ prov: ["Disney Plus"] }))).toBe(false);
  });
});

describe("crowd rating", () => {
  it("prefers IMDb when it has votes, else TMDB", () => {
    expect(crowdRating({ ir: 3.3, ic: 110924, va: 7.0, vc: 2000 })).toEqual({ v: 3.3, n: 110924, src: "IMDb" });
    expect(crowdRating({ ir: 9, ic: 10, va: 7.2, vc: 300 })).toEqual({ v: 7.2, n: 300, src: "TMDB" });
    expect(crowdRating({})).toBeNull();
  });
});
