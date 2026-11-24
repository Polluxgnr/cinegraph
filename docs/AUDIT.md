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

## Your own score (added November 23)

The Taste page now measures the engine on *your* answers: one liked film in five is hidden, the model is rebuilt
from the rest in the order you answered, and the hidden ones are looked for in your top 50. On the owner's 408
answers (68 liked): **0 of 13 back in the top 50** of 16k titles; against 1,000 random unanswered titles the hidden
favourites rank around **57th (top 6%)**, and 16% make that top 10. Five weight variants (less community rating and
popularity, more similarity and genre, less collaborative filtering) all land within noise (median rank 57–70,
16–19% in the top 10), so the defaults stay. What fills the very top is widely loved classics not answered yet
(Blade Runner, The Godfather…), a fair suggestion but one that crowds out the owner's animation favourites.
Tried next (November 24, five rotations of the hidden fifth, 68 hidden favourites in all): a "probably seen it
elsewhere" discount on the most famous titles *lowered* the score (5/68 found → 3/68 and 1/68 as it grew), because
the owner's favourites are famous too, so it was dropped. A favourite-genre slot (your most over-liked genre keeps
two of the first ten places) left the score unchanged at 5/68 and stays, since it only changes which titles lead.
The remaining lever is more answers on the titles the model is unsure about (the swipe deck already asks those).

## Engine tuning (November 24)

Replayed against what the app really runs (starting weights tuned by the weekly evaluation), on 150 MovieLens
users with a fifth of their favourites hidden, the same users cut to 10 ratings, and the owner's own answers:

| Collaborative-filtering cap | HR@10 (warm) | HR@10 (10 ratings) | Owner: hidden favourites in top 50 |
|---|---|---|---|
| 2.5 (before) | 0.567 | 0.427 | 6 / 68 |
| 3.5 | 0.613 | 0.420 | 7 / 68 |
| 4 | 0.633 | 0.427 | 7 / 68 |
| **5 (now)** | **0.660** | **0.440** | **8 / 68** |

The MovieLens figures flatter collaborative filtering a little (its matrix was trained on those users); the owner's
answers are not in it and move the same way. Adding the collaborative score to the first-stage shortlist did not
help (kept off). Re-run: `lib/engine/tune.eval.ts` and `lib/engine/myscore.eval.ts`.

## Cross-cutting

1. ~~Personal score~~ (done, above).
2. **First visit is heavy on phones** (~9.4 MB compressed: catalogue 4.6 MB, embeddings 2.9 MB, people 1.3 MB).
   November 24: the catalogue also ships by column (`catalog.cols.json`, 3.8 → 2.8 MB compressed), loaded first.
   This round: people.json ships only the 89k people on catalogue cards (half), the rest come with their person
   shard; outside-site link ids moved from the catalogue to the details. Next: split the catalogue itself into a
   light list and the rest on demand. *Medium.*
3. **Wikidata live queries are slow** (10–45 s for "best spots", 2–5 s for careers). Precompute the best spots of
   each destination and careers of the 5,000 most credited people in the weekly build; keep live queries as a
   fallback. *Medium; removes the longest waits in the app.*
4. **Hydration.** Pages are pre-rendered in English and switch language right after loading (fixed this round:
   no more React hydration errors). A French pre-render per page would remove the one-frame switch. *Medium.*
5. **Accessibility.** Swipe gestures have keyboard and button equivalents; still to check: focus order in the
   filter panel and the More sheet, colour contrast of muted text in light mode. Run axe in the Playwright suite.
   *Small.*
6. **Sync conflicts** are resolved per item (latest answer wins). Device settings (theme, language, tokens) stay on
   each device; follows now merge per person (each change dated), swipe filters and followed teams as one block
   where the latest change wins.

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
3. ~~Fridge, allergens, cooking~~: done. "What's in my fridge" ranks recipes by how many of your ingredients
   they use and lists what's left to buy, there are "free from" filters for nine allergens, effort and hands-on time
   (with resting time apart), portions that rescale every quantity, a shopping list to copy, step timers and a
   full-screen cook mode that keeps the screen awake.

## Destinations

1. **Best spots load live** (see cross-cutting 3). They now show a clear loading state, a retry on error, and names
   in the interface language.
2. ~~Places named in English~~: French names and descriptions from Wikidata now show in the French interface.
3. ~~When to go~~: each destination now shows its typical year (two years of Open-Meteo records), the best months,
   today's weather, the week ahead and the local time.
4. **Trips**: add opening hours (OpenStreetMap `opening_hours`) and travel time between days.
5. ~~Big cities missing~~ (Paris, Madrid: Wikidata files them as "commune", "municipality", not "city"): every city
   of 100,000 people or more and every capital now come from GeoNames (CC BY 4.0, cached two months in `data/geonames`,
   the server sends ~10 KB/s), matched to Wikidata by GeoNames id for the photo and Wikivoyage guide, or by name when
   that id points to a district. Plus all ~210 countries. ~7,600 places; Search has a country picker.

## Dream garage and Style

0. ~~Compare~~: up to four cars side by side (power, torque, 0–100, top speed, displacement, price, € per hp), best
   of each row lit, curb weight and power-to-weight. Next: specs for more models.

1. **Prices** are approximate and curated in YAML. A yearly refresh is enough for cars; for style pieces, link the
   brand's own product page where it exists.
2. **Style discovery** relies on curated brands plus your Pinterest boards. Instagram saves come through packs;
   there is no legal live access to Instagram saves.
3. ~~Brands without pictures, pieces without photos~~: the brands' shops refuse or time out from GitHub's servers
   (0 pieces in the November 24 build; not worked around). Wikidata now gives a photo or logo to curated brands whose
   site has no preview, ~230 more labels, and their famous pieces with a Commons photo (Levi's 501, Birkin, Air Max...);
   curated pieces get a Commons photo only when the file is plainly of that piece. Style Home has a photo catalogue by
   category. Still thin: photos for most curated pieces (no open source has them).
4. A kept car export (Wikidata timed out) still gets the curated specs.

## Sports

1. ~~Match details~~: a match opens its recent form, goals, cards and substitutions, team stats with bars,
   line-ups with formation, leaders (US sports) and attendance, from ESPN's summary feed.
2. ~~Teams and athletes~~: Sports is a space of its own. Every team, player, driver and fighter opens a page:
   Wikipedia description, standing, record, coach, the season's results and fixtures, the squad (photos, age,
   nationality, injuries); an athlete's profile and season numbers; each match has a page. Sources linked (ESPN,
   Wikipedia). ESPN's team endpoint refuses browsers, so identity comes from the roster endpoint, which allows them.

## Films: search filters

Type and genre (with its subgenres underneath) stay in view; length, decade, original language, collections and
animation wait in "More filters". Whatever is on shows as a removable chip with a Reset. The People / Directors /
Actors switch is gone: the box searches everything and matching people show as their own row. Tonight moved into
the films Home (`/tonight/` leads there).

## Agora

The review reader now lives in this repository (`agora/`, its own `config.toml` and `data/` stay out of git). The app
has an "Ask people" page and asks it from film, place, recipe, brand, team and athlete pages.

## Design

Done this round: 3D poster on title pages (leans towards the cursor, glare, spring back; off with "reduce
motion"), cast strip with photos, person pages with spring-in header, spot cards with hover zoom and even rows,
skeletons that say what they wait for. Next ideas, by impact:

- A slow Ken Burns pan on the Home hero backdrop (CSS only, off with reduce motion).
- Shared-element transition from a card's poster to the title page (View Transitions API, supported in Chromium
  and Safari 18).
- A 3D "shelf" for sagas (posters in perspective, scroll to rotate) on the Sagas tab.
- The taste graph in WebGL (force layout with three.js) once it shows more than ~300 nodes.
