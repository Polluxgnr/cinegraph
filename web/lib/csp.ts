/**
 * Content-Security-Policy for the static site (GitHub Pages can't send headers, so it ships as a <meta> tag).
 * The point is containment: even if something injected a script, it could only talk to the services listed
 * here, so tokens can't be posted to an arbitrary server. Inline scripts stay allowed because a static Next.js
 * export inlines its boot data (no per-request nonce exists without a server).
 */
const CONNECT = [
  "'self'",
  "https://api.github.com", "https://gist.githubusercontent.com", // memory sync
  "https://api.spotify.com", "https://accounts.spotify.com", // Spotify (your app)
  "https://www.googleapis.com", "https://accounts.google.com", // YouTube (your OAuth client)
  "https://query.wikidata.org", "https://*.wikipedia.org", // scores, spots, summaries
  "https://api.open-meteo.com", "https://archive-api.open-meteo.com", // weather now and typical climate of places
  "https://site.api.espn.com", "https://site.web.api.espn.com", // sports: results, fixtures, tables, news, injuries, teams, athletes
  "https://noembed.com", "https://api.microlink.io", "https://api.rss2json.com", // link previews, Pinterest RSS
  "https://api.anthropic.com", // optional AI
  "http://127.0.0.1:8765", "http://localhost:8765", // Agora, your review reader, when it runs on your PC
];

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://api.deezer.com https://accounts.google.com", // Deezer JSONP, Google sign-in
  `connect-src ${CONNECT.join(" ")}`,
  "img-src 'self' data: blob: https:", // posters, covers, brand previews come from many hosts
  "media-src https:", // 30 s song previews
  "frame-src https://www.youtube-nocookie.com https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "font-src 'self' data:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
