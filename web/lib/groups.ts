/**
 * Film groups you can browse or filter by: studios and auteurs (by their directors), plus "new releases".
 * Defined on the people the catalogue already has, so they work offline and stay current every week.
 */
import type { FilmData } from "./data";
import type { Film } from "./types";

export interface Group { id: string; label: string; directors?: string[]; test?: (f: Film) => boolean }

const recent = (days: number) => (f: Film) => !!f.d && Date.now() - Date.parse(f.d) < days * 864e5 && Date.parse(f.d) <= Date.now();

export const GROUPS: Group[] = [
  { id: "new", label: "New releases", test: recent(120) },
  { id: "ghibli", label: "Studio Ghibli", directors: ["Hayao Miyazaki", "Isao Takahata", "Hiromasa Yonebayashi", "Gorō Miyazaki", "Goro Miyazaki", "Yoshifumi Kondō", "Hiroyuki Morita", "Tomomi Mochizuki"] },
  { id: "pixar", label: "Pixar", directors: ["John Lasseter", "Pete Docter", "Andrew Stanton", "Brad Bird", "Lee Unkrich", "Dan Scanlon", "Domee Shi", "Enrico Casarosa", "Angus MacLane", "Peter Sohn", "Mark Andrews", "Brenda Chapman", "Kelsey Mann"] },
  { id: "tarantino", label: "Tarantino", directors: ["Quentin Tarantino"] },
  { id: "nolan", label: "Nolan", directors: ["Christopher Nolan"] },
  { id: "villeneuve", label: "Villeneuve", directors: ["Denis Villeneuve"] },
  { id: "fincher", label: "Fincher", directors: ["David Fincher"] },
  { id: "kubrick", label: "Kubrick", directors: ["Stanley Kubrick"] },
  { id: "scorsese", label: "Scorsese", directors: ["Martin Scorsese"] },
  { id: "wes", label: "Wes Anderson", directors: ["Wes Anderson"] },
  { id: "coen", label: "Coen brothers", directors: ["Joel Coen", "Ethan Coen"] },
  { id: "ritchie", label: "Guy Ritchie", directors: ["Guy Ritchie"] },
  { id: "spielberg", label: "Spielberg", directors: ["Steven Spielberg"] },
  { id: "bong", label: "Bong Joon-ho", directors: ["Bong Joon-ho"] },
  { id: "park", label: "Park Chan-wook", directors: ["Park Chan-wook"] },
];

const dirSets = new WeakMap<FilmData, Map<string, Set<number>>>();
/** A predicate for one group on this catalogue. */
export function groupTest(d: FilmData, id: string): (f: Film) => boolean {
  const g = GROUPS.find((x) => x.id === id);
  if (!g) return () => true;
  if (g.test) return g.test;
  let m = dirSets.get(d);
  if (!m) dirSets.set(d, (m = new Map()));
  if (!m.has(id)) {
    const names = new Set(g.directors!.map((n) => n.toLowerCase()));
    const ids = new Set<number>();
    d.people.forEach((n, i) => names.has(n.toLowerCase()) && ids.add(i));
    m.set(id, ids);
  }
  const ids = m.get(id)!;
  return (f) => [...(f.dir ?? []), ...(f.cre ?? [])].some((i) => ids.has(i));
}

export const isAnimation = (f: Film) => (f.g ?? []).includes("Animation");
/** Japanese animation (anime), and series adapted from manga. */
export const isAnime = (f: Film) =>
  (isAnimation(f) && (f.lang === "ja" || (f.c ?? []).includes("JP"))) || (f.kw ?? []).some((k) => /\b(anime|manga|based on manga)\b/i.test(k));

/** Subgenres of a genre: the keywords that most often come with it (minus the generic ones). */
const GENERIC = /^(based on (novel or book|true story|comic)|sequel|remake|duringcreditsstinger|aftercreditsstinger|woman director|biography|murder|friendship|love|family|death|revenge|new york city|london, england|los angeles, california|paris, france)$/i;
export function subgenres(d: FilmData, genre: string, n = 14): string[] {
  const c = new Map<string, number>();
  for (const f of d.films) if ((f.g ?? []).includes(genre)) for (const k of f.kw ?? []) if (!GENERIC.test(k)) c.set(k, (c.get(k) ?? 0) + 1);
  return [...c].filter(([, v]) => v >= 8).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}
