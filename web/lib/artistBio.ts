/**
 * Short descriptions from Wikipedia (CC BY-SA), in the interface language: the page with the exact name, else the
 * name with a disambiguating suffix ("Name (band)", "Name F.C."...), kept only when the page is about the right kind
 * of thing (a musician, a club, a player).
 */
export interface ArtistBio { title: string; extract: string; description?: string; url: string; image?: string; lang: "en" | "fr" }
export type WikiBio = ArtistBio;

export interface WikiKind { test: RegExp; suffix: { en: string[]; fr: string[] } }

export const MUSIC: WikiKind = {
  test: /\b(singer|songwriter|band|rapper|musician|group|duo|trio|dj|disc jockey|producer|composer|guitarist|pianist|drummer|orchestra|chanteu|chanteur|groupe|rappeu|musicien|compositeu|auteur-compositeur|pianiste|guitariste|producteur)/i,
  suffix: { en: ["", " (band)", " (singer)", " (rapper)", " (musician)", " (group)"], fr: ["", " (groupe)", " (chanteur)", " (chanteuse)", " (rappeur)", " (musicien)"] },
};

export const TEAM: WikiKind = {
  test: /\b(club|team|franchise|football|soccer|basketball|rugby|hockey|baseball|sports|équipe|formule|racing|constructor|écurie)/i,
  suffix: { en: ["", " F.C.", " FC", " (football club)", " (basketball)", " (rugby union)", " (ice hockey)", " (baseball)", " (American football)"], fr: ["", " (football)", " (club de football)", " (basket-ball)", " (rugby à XV)"] },
};

export const ATHLETE: WikiKind = {
  test: /\b(player|footballer|athlete|driver|tennis|golfer|fighter|boxer|martial|cyclist|sprinter|quarterback|pitcher|goalkeeper|forward|defender|midfielder|guard|joueu|footballeu|pilote|sportif|sportive|athlète|combattant|tennisman|golfeu|basketteu|rugbyman)/i,
  suffix: { en: ["", " (footballer)", " (soccer)", " (basketball)", " (tennis)", " (racing driver)", " (fighter)", " (American football)", " (ice hockey)", " (rugby union)", " (golfer)"], fr: ["", " (football)", " (basket-ball)", " (tennis)", " (pilote automobile)", " (rugby à XV)"] },
};

const cache = new Map<string, Promise<ArtistBio | null>>();

async function summary(lang: "en" | "fr", title: string, kind: WikiKind): Promise<ArtistBio | null> {
  const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}?redirect=true`);
  if (!r.ok) return null;
  const j = await r.json();
  if (j.type === "disambiguation" || !j.extract) return null;
  const about = `${j.description ?? ""} ${String(j.extract).slice(0, 300)}`;
  if (!kind.test.test(about)) return null;
  return { title: j.title, extract: j.extract, description: j.description, url: j.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`, image: j.thumbnail?.source, lang };
}

/** Wikipedia's own search, for names that are also something else ("Marseille" the club, not the city). */
async function search(lang: "en" | "fr", q: string): Promise<string[]> {
  const r = await fetch(`https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=3`);
  if (!r.ok) return [];
  return ((await r.json()).pages ?? []).map((p: { title: string }) => p.title).filter((t: string) => !/^(saison|season)\b|\d{4}[–-]\d{2,4}/i.test(t));
}

/**
 * The Wikipedia summary for `name` of the given kind, French first when the interface is French. `hint` (e.g.
 * "football club") is added to a search when no page with the name itself fits.
 */
export function wikiBio(name: string, lang: "en" | "fr", kind: WikiKind, hint?: { en: string; fr: string }): Promise<ArtistBio | null> {
  const k = `${lang}|${kind.test.source.slice(0, 12)}|${name}|${hint?.en ?? ""}`;
  if (!cache.has(k)) {
    cache.set(k, (async () => {
      const langs = lang === "fr" ? (["fr", "en"] as const) : (["en"] as const);
      for (const l of langs) {
        for (const s of kind.suffix[l]) {
          const b = await summary(l, name + s, kind).catch(() => null);
          if (b) return b;
        }
      }
      if (hint) {
        for (const l of langs) {
          for (const t of await search(l, `${name} ${hint[l]}`).catch(() => [] as string[])) {
            const b = await summary(l, t, kind).catch(() => null);
            if (b) return b;
          }
        }
      }
      return null;
    })());
  }
  return cache.get(k)!;
}

export const artistBio = (name: string, lang: "en" | "fr") => wikiBio(name, lang, MUSIC);
