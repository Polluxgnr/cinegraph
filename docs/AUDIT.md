# Audit and what to build next

State as of November 2026, after the "people, search, ratings" round. Each item says what is true now, why it
matters, and what to do. Ordered by value for the effort, per space.

## Measured quality (from the weekly pipeline)

| What is measured | HR@10 | NDCG@10 |
|---|---|---|
| The blend the app uses, 1,000 MovieLens users, hidden favourites | 0.873 | 0.368 |
| Most popular (baseline) | 0.606 | 0.158 |
| The app's own in-browser engine, 300 held-out users, before the last tuning | 0.603 | 0.156 |
| The same engine after the last tuning | 0.600 | 0.156 |

**Reading it.** Collaborative filtering (people with your taste) carries most of the quality. The in-browser
engine is far below the blend on this test because the test users are cold (a few answers each) and the engine
starts from the crowd. The last tuning changed nothing measurable here; it was aimed at your real answers (the
"known title" model went from AUC 0.731 to 0.745, the taste model from 0.623 to 0.641).

## Cross-cutting

1. **The app's engine is measured on MovieLens users, not on you.** Add a *personal* weekly score: hide 20% of
   your own loved titles, re-rank, report HR@10 on the Taste page. It's the only number that says whether the app
   gets better for you. *Effort: small (the replay harness exists).*
2. **First visit is heavy on phones.** The film catalogue is ~11 MB of JSON before compression. Split `catalog.json`
   into a light list (id, title, year, poster, genres, ratings) and the rest on demand, like the details. *Medium.*
3. **Wikidata live queries are slow** (10–45 s for "best spots", 2–5 s for careers). Precompute the best spots of
   each destination and careers of the 5,000 most credited people in the weekly build; keep live queries as a
   fallback. *Medium; removes the longest waits in the app.*
4. **Hydration.** Pages are pre-rendered in English and switch language right after loading (fixed this round:
   no more React hydration errors). A French pre-render per page would remove the one-frame switch. *Medium.*
5. **Accessibility.** Swipe gestures have keyboard and button equivalents; still to check: focus order in the
   filter panel and the More sheet, colour contrast of muted text in light mode. Run axe in the Playwright suite.
   *Small.*
6. **Sync conflicts** are resolved per item (latest answer wins). Device settings (theme, language, tokens) stay on
   each device; follows and swipe filters sync (fixed this round: they used to stay on the device), as one block
   where the latest change wins, so following someone on the phone while changing filters on the laptop keeps
   only the later of the two. Merge them per person / per filter. *Small.*

## Films & series

1. **Cast beyond 15.** Titles ingested before this round keep TMDB's top-15 cast; new ones keep 30. A one-off
   re-crawl of credits for the 16k titles (~16k TMDB calls, about 10 minutes) would make every cast list complete.
2. **People in the ranker.** Followed people now count like two loved titles. Next: learn per-person affinity for
   cinematographers and composers too (TMDB has them), and show "Because you follow X" rows on Home.
3. **Letterboxd and SensCritique scores** cannot be read legally (no API, no open dataset). Your own Letterboxd
   ratings already import from its official export. Keep the links.
4. **Same-title collisions** (three *The Odyssey*): search ranks the real one first by votes, but a "year" hint
   in cards with identical titles would avoid confusion.
5. **TV episodes.** Series progress is per season; TMDB has episode titles and air dates. "New episode out"
   notifications for series in progress would make Home more useful week to week.

## Videos & docs

1. **History and Watch later** can't be read through YouTube's API (Google removed access in 2016). Google
   Takeout (already supported) is the only legal route; a monthly reminder to re-import would keep it fresh.
   Liked videos, subscriptions and playlists already come live with *Connect YouTube*.
2. **Themes** are inferred from channel tags. Add the YouTube Data API `topicDetails` (free quota) in the weekly
   build for per-video topics, and let you pin themes on Home.
3. **More sources**: ARTE and BBC Earth stay; add Arte.tv's own catalogue (public RSS per programme) and France.tv
   documentaries, both free and legal.
4. **Viewer score** compares likes per view across the catalogue; channels with comments disabled or very young
   videos get no score. Recompute daily rather than weekly for new uploads.

## Music

1. **Spotify's recommendation, related-artist and audio-feature endpoints are closed to new apps** since November
   2024. Suggestions therefore come from Deezer (related artists, fans also play) weighted by your taste. Works
   well for artists; for moods (tempo, energy) there is no open source left.
2. **Playlist assistant**: today it analyses one playlist at a time and lists new releases. Next: a "tidy" view
   across all your playlists (duplicates, songs you skip, artists you stopped liking) and one-click "save as new
   playlist" back to Spotify (needs the `playlist-modify-private` scope).
3. **New releases** are checked live for your top 24 artists. Move it to the weekly build for all artists you
   loved, so the row is instant.

## Recipes

1. **Catalogue size**: TheMealDB has ~800 recipes in 30+ cuisines. For more variety, add Wikidata dishes (P31 dish,
   with country of origin and main ingredients) as "dishes to try" with links to recipes, and Wikibooks Cookbook
   (CC BY-SA) for full recipes.
2. **Diet detection** reads the ingredient list (vegetarian/vegan) and is right on the obvious cases; edge cases
   (gelatine in desserts, fish sauce, Worcestershire) are covered for the common ones. Add allergen flags (nuts,
   gluten, lactose) the same way.
3. **"From what's in my fridge"**: search already matches any ingredient; a multi-ingredient mode ("chicken +
   lemon + rice", ranked by how many you have) is a small step from here.

## Destinations

1. **Best spots load live** (see cross-cutting 3). They now show a clear loading state, a retry on error, and names
   in the interface language.
2. **Places are named in English** in the catalogue (London, not Londres). Export Wikidata French labels like the
   French film titles.
3. **Trips**: add opening hours (OpenStreetMap `opening_hours`) and travel time between days.

## Dream garage and Style

1. **Prices** are approximate and curated in YAML. A yearly refresh is enough for cars; for style pieces, link the
   brand's own product page where it exists.
2. **Style discovery** relies on curated brands plus your Pinterest boards. Instagram saves come through packs;
   there is no legal live access to Instagram saves.

## Design

Done this round: 3D poster on title pages (leans towards the cursor, glare, spring back; off with "reduce
motion"), cast strip with photos, person pages with spring-in header, spot cards with hover zoom and even rows,
skeletons that say what they wait for. Next ideas, by impact:

- A slow Ken Burns pan on the Home hero backdrop (CSS only, off with reduce motion).
- Shared-element transition from a card's poster to the title page (View Transitions API, supported in Chromium
  and Safari 18).
- A 3D "shelf" for sagas (posters in perspective, scroll to rotate) on the Sagas tab.
- The taste graph in WebGL (force layout with three.js) once it shows more than ~300 nodes.
