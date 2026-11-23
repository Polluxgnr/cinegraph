/**
 * Link previews from a static site: browsers can't read other sites (CORS), so we ask two public,
 * CORS-enabled preview services, only for links you add yourself:
 *   noembed.com   oEmbed for YouTube, Spotify, SoundCloud, Vimeo, Deezer, Bandcamp…
 *   microlink.io  Open Graph for any page (free tier: 50 previews/day)
 */
export interface LinkMeta {
  title?: string;
  description?: string;
  image?: string;
  author?: string;
  provider?: string;
}

export async function linkMeta(url: string): Promise<LinkMeta> {
  try {
    const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
    const j = await r.json();
    if (j && !j.error && j.title) {
      return { title: j.title, image: j.thumbnail_url, author: j.author_name, provider: j.provider_name };
    }
  } catch {
    /* fall through */
  }
  try {
    const r = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
    const j = await r.json();
    if (j.status === "success") {
      const d = j.data;
      return { title: d.title, description: d.description, image: d.image?.url ?? d.logo?.url, author: d.author, provider: d.publisher };
    }
  } catch {
    /* no preview available */
  }
  return {};
}

/** Which space a link most likely belongs to. */
export function guessSpace(url: string): string | null {
  const u = url.toLowerCase();
  if (/youtube\.com|youtu\.be|vimeo\.com|arte\.tv|france\.tv|dailymotion/.test(u)) return "youtube";
  if (/spotify\.com|deezer\.com|soundcloud\.com|bandcamp\.com|music\.apple|qobuz/.test(u)) return "music";
  if (/marmiton|750g|cuisineaz|recette|recipe|cuisine|allrecipes|bonappetit|seriouseats/.test(u)) return "recipes";
  if (/booking|airbnb|wikivoyage|tripadvisor|lonelyplanet|maps\.google|routard/.test(u)) return "places";
  if (/imdb|letterboxd|senscritique|allocine|themoviedb|netflix|primevideo/.test(u)) return "films";
  if (/porsche|ferrari|bmw|mercedes|renault|peugeot|tesla|autoplus|caradisiac|carwow/.test(u)) return "cars";
  return null;
}

export interface PieceMeta extends LinkMeta { price?: number; currency?: string }

/**
 * A product page's preview plus its price, when the shop publishes one in its page metadata
 * (Open Graph product:price, or schema.org Product). Only for links you paste.
 */
export async function pieceMeta(url: string): Promise<PieceMeta> {
  const rules: [string, string, string][] = [
    ["price", 'meta[property="product:price:amount"],meta[property="og:price:amount"],meta[itemprop="price"]', "content"],
    ["currency", 'meta[property="product:price:currency"],meta[property="og:price:currency"],meta[itemprop="priceCurrency"]', "content"],
  ];
  const q = new URLSearchParams({ url });
  for (const [k, sel, attr] of rules) {
    q.set(`data.${k}.selector`, sel);
    q.set(`data.${k}.attr`, attr);
  }
  try {
    const r = await fetch(`https://api.microlink.io/?${q}`, { signal: AbortSignal.timeout(20_000) });
    const j = await r.json();
    if (j.status === "success") {
      const d = j.data;
      const price = Number(String(d.price ?? "").replace(",", ".").replace(/[^\d.]/g, ""));
      const img = d.image?.url && !/\.svg($|\?)/i.test(d.image.url) ? d.image.url : undefined;
      return { title: d.title, description: d.description, image: img, provider: d.publisher, price: price > 0 ? price : undefined, currency: d.currency || undefined };
    }
  } catch {
    /* no preview: the form stays editable */
  }
  return {};
}
