/**
 * An artist's biography from Wikipedia (CC BY-SA), in the interface language: the page with the artist's name,
 * else "Name (band)", "(singer)", "(rapper)", "(musician)", kept only when its description is about music.
 */
export interface ArtistBio { title: string; extract: string; description?: string; url: string; image?: string; lang: "en" | "fr" }

const MUSIC = /\b(singer|songwriter|band|rapper|musician|group|duo|trio|dj|disc jockey|producer|composer|guitarist|pianist|drummer|orchestra|chanteu|chanteur|groupe|rappeu|musicien|compositeu|auteur-compositeur|duo|pianiste|guitariste|producteur)/i;
const SUFFIX = { en: ["", " (band)", " (singer)", " (rapper)", " (musician)", " (group)"], fr: ["", " (groupe)", " (chanteur)", " (chanteuse)", " (rappeur)", " (musicien)"] };

const cache = new Map<string, Promise<ArtistBio | null>>();

async function summary(lang: "en" | "fr", title: string): Promise<ArtistBio | null> {
  const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}?redirect=true`);
  if (!r.ok) return null;
  const j = await r.json();
  if (j.type === "disambiguation" || !j.extract) return null;
  const about = `${j.description ?? ""} ${String(j.extract).slice(0, 300)}`;
  if (!MUSIC.test(about)) return null;
  return { title: j.title, extract: j.extract, description: j.description, url: j.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`, image: j.thumbnail?.source, lang };
}

export function artistBio(name: string, lang: "en" | "fr"): Promise<ArtistBio | null> {
  const k = `${lang}|${name}`;
  if (!cache.has(k)) {
    cache.set(k, (async () => {
      for (const l of lang === "fr" ? (["fr", "en"] as const) : (["en"] as const)) {
        for (const s of SUFFIX[l]) {
          const b = await summary(l, name + s).catch(() => null);
          if (b) return b;
        }
      }
      return null;
    })());
  }
  return cache.get(k)!;
}
