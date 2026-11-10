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
