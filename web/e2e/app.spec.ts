import { expect, type Page, test } from "@playwright/test";

/** Every test starts from an empty memory (fresh browser context) and records CSP violations. */
async function open(page: Page, path: string) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(path);
}
/** Violations the app caused. "script-src eval" with no URL is Playwright evaluating its own helpers in the page
 * (blocked by the CSP as it should be); the build itself contains no eval (checked in CI). */
const cspViolations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp: string[] }).__csp).then((v) => v.filter((x) => x.trim() !== "script-src eval"));

test("home recommends films with a reason, without CSP violations", async ({ page }) => {
  await open(page, "/");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("main article").first()).toBeVisible();
  await expect(page.getByText(/% match/).first()).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
});

test("swipe: card and answers fit the screen, answering moves on", async ({ page }) => {
  await open(page, "/swipe/?d=films");
  const card = page.getByTestId("swipe-card");
  await expect(card).toBeVisible();
  const first = await card.locator("h2").textContent();
  await page.getByRole("button", { name: /^Seen it$/ }).click();
  const answers = page.locator("main button").filter({ hasText: /Liked|Loved/ });
  await expect(answers.first()).toBeVisible();
  // nothing the user needs is hidden below the bottom tabs or the fold
  const viewport = page.viewportSize()!;
  const lowest = await answers.last().boundingBox();
  expect(lowest!.y + lowest!.height).toBeLessThanOrEqual(viewport.height);
  await answers.first().click();
  await expect(card.locator("h2")).not.toHaveText(first ?? "");
});

test("discover search finds a director's films", async ({ page }) => {
  await open(page, "/discover/?d=films");
  await page.getByRole("searchbox").fill("villeneuve");
  await expect(page.locator("main img[alt='Arrival'], main img[alt='Dune'], main img[alt='Prisoners']").first()).toBeVisible();
});

test("film page: synopsis, scores per source, why this match", async ({ page }) => {
  await page.route("https://query.wikidata.org/**", (r) => r.fulfill({ json: { results: { bindings: [
    { score: { value: "73%" }, byLabel: { value: "Rotten Tomatoes" }, methodLabel: { value: "Tomatometer score" }, rt: { value: "m/interstellar_2014" } },
  ] } } }));
  await page.route("https://*.wikipedia.org/**", (r) => r.fulfill({ json: { extract: "A test summary." } }));
  await open(page, "/item/?k=films%3A3472");
  await expect(page.locator("h1")).toHaveText("Interstellar");
  await expect(page.getByText(/wormhole/i).first()).toBeVisible(); // synopsis from the detail shard
  await expect(page.getByText("Rotten Tomatoes").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Why \d+%/ })).toBeVisible();
});

test("profiles keep separate memories", async ({ page, isMobile }) => {
  test.skip(isMobile, "the profile menu lives in the sidebar on desktop");
  await open(page, "/lists/");
  await page.getByRole("button", { name: /profile/ }).first().click();
  await page.getByPlaceholder("New profile (e.g. Léa)").fill("Test");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("2 profiles")).toBeVisible();
});

test("trip planner splits spots into days", async ({ page }) => {
  // Kyoto spots, mocked: two clusters
  const spot = (q: string, name: string, lon: number, lat: number) => ({ a: { value: `http://www.wikidata.org/entity/${q}` }, aLabel: { value: name }, sl: { value: "40" }, dist: { value: "2" }, loc: { value: `Point(${lon} ${lat})` } });
  await page.route("https://query.wikidata.org/**", (r) => {
    const q = decodeURIComponent(r.request().url());
    if (q.includes("VALUES ?a")) return r.fulfill({ json: { results: { bindings: [] } } });
    return r.fulfill({ json: { results: { bindings: [
      spot("Q1", "Temple A", 135.78, 34.99), spot("Q2", "Temple B", 135.781, 34.991), spot("Q3", "Shrine C", 135.70, 35.04), spot("Q4", "Shrine D", 135.701, 35.041),
    ] } } });
  });
  await open(page, "/item/?k=places%3AQ34600");
  const add = page.getByRole("button", { name: "+ Trip" });
  await expect(add.first()).toBeVisible();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "+ Trip" }).first().click();
  await page.getByRole("link", { name: /Plan the trip/ }).click();
  await page.getByRole("button", { name: /−/ }).click(); // 3 days -> 2
  await page.getByRole("button", { name: /Plan my days/ }).click();
  await expect(page.getByRole("heading", { name: /^Day 1/ })).toBeVisible();
  await expect(page.getByText("2 stops").first()).toBeVisible();
});

test("navigation: four destinations, the rest under More", async ({ page, isMobile }) => {
  await open(page, "/");
  const bar = isMobile ? page.locator("nav.fixed") : page.locator("header.fixed");
  for (const name of ["Home", "Swipe", "Search", "My list"]) await expect(bar.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Taste", exact: true })).toHaveCount(0);
  await bar.getByRole("button", { name: /More/ }).click();
  await expect(page.getByRole("link", { name: "My taste" })).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).last().click();
  await expect(page).toHaveURL(/settings/);
  await page.goto("/lists/?tab=sagas");
  await expect(page.getByText("Franchises in viewing order").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tonight" })).toHaveCount(0); // Tonight lives on Home
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();
});

test("language: switching to French translates the interface", async ({ page, isMobile }) => {
  await open(page, "/settings/");
  // the page reloads itself in the new language
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Français" }).click()]);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.goto("/");
  const nav = page.locator(isMobile ? "nav.fixed" : "header.fixed");
  await expect(nav.getByText("Accueil")).toBeVisible();
  await expect(nav.getByText("Plus")).toBeVisible();
  await expect(page.getByText(/% pour vous/).first()).toBeVisible();
});

test.describe("French browser", () => {
  test.use({ locale: "fr-FR" });
  test("language: a French browser gets French by default", async ({ page, isMobile }) => {
    await open(page, "/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator(isMobile ? "nav.fixed" : "header.fixed").getByText("Ma liste")).toBeVisible();
  });
});

test("swipe filters narrow the deck and persist", async ({ page }) => {
  await open(page, "/swipe/?d=films");
  await expect(page.getByTestId("swipe-card")).toBeVisible();
  await page.getByTestId("swipe-filters").click();
  await page.getByRole("button", { name: "Series", exact: true }).click();
  await page.evaluate(() => {
    const w = window as unknown as { __saved: number };
    w.__saved = 0;
    window.addEventListener("cinegraph:saved", () => w.__saved++);
  });
  await page.getByRole("button", { name: "8+", exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("swipe-filters")).toHaveText(/Filters · 2/);
  // the last change is written to this browser's storage (debounced, then sealed)
  await page.waitForFunction(() => (window as unknown as { __saved: number }).__saved > 0);
  await expect(page.getByTestId("swipe-card").getByText(/^Series ·/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("swipe-filters")).toHaveText(/Filters · 2/);
});

test("search finds people; a person's page lists their films and can be followed", async ({ page }) => {
  await page.route("https://query.wikidata.org/**", (r) => r.fulfill({ json: { results: { bindings: [] } } }));
  await open(page, "/discover/?d=films");
  await page.getByRole("searchbox").fill("villeneuve");
  const people = page.getByTestId("people-results");
  await expect(people.getByText("Denis Villeneuve")).toBeVisible();
  await people.getByText("Denis Villeneuve").click();
  await expect(page.locator("h1")).toHaveText("Denis Villeneuve");
  await expect(page.locator("main img[alt='Arrival'], main img[alt='Dune'], main img[alt='Prisoners']").first()).toBeVisible();
  await page.getByTestId("follow").click();
  await expect(page.getByTestId("follow")).toHaveText(/Following/);
});

test("recipes: vegetarian filter and ingredient search", async ({ page }) => {
  await open(page, "/discover/?d=recipes");
  await page.getByRole("button", { name: "🌱 Vegetarian" }).click();
  await expect(page.locator("main article").first()).toBeVisible();
  await page.getByRole("searchbox").fill("lentils");
  await expect(page.locator("main article").first()).toBeVisible();
});

test("a card on a title page opens that title (same-page navigation)", async ({ page }) => {
  await page.route("https://query.wikidata.org/**", (r) => r.fulfill({ json: { results: { bindings: [] } } }));
  await open(page, "/item/?k=films%3A3472");
  await expect(page.locator("h1")).toHaveText("Interstellar");
  const card = page.locator("main section").filter({ hasText: /Similar/ }).locator("article a").first();
  await card.scrollIntoViewIfNeeded();
  const target = (await card.textContent())?.trim();
  await card.click();
  await expect(page.locator("h1")).not.toHaveText("Interstellar");
  if (target) await expect(page.locator("h1")).toContainText(target.slice(0, 6));
});

test("sports: results, standings and following a team", async ({ page }) => {
  const match = { id: "1", name: "PSG at OM", date: new Date(Date.now() - 864e5).toISOString(), competitions: [{ id: "1", date: new Date(Date.now() - 864e5).toISOString(),
    status: { type: { state: "post", shortDetail: "FT" } }, venue: { fullName: "Vélodrome" },
    competitors: [{ homeAway: "home", winner: false, score: "1", team: { displayName: "Marseille" } }, { homeAway: "away", winner: true, score: "3", team: { displayName: "Paris Saint-Germain" } }] }] };
  await page.route("https://site.api.espn.com/apis/site/v2/**/scoreboard*", (r) => r.fulfill({ json: { events: [match] } }));
  await page.route("https://site.api.espn.com/apis/v2/**/standings", (r) => r.fulfill({ json: { children: [{ name: "Ligue 1", standings: { entries: [
    { team: { displayName: "Paris Saint-Germain" }, stats: [{ name: "rank", displayValue: "1" }, { name: "points", displayValue: "26" }] }] } }] } }));
  await open(page, "/sports/");
  await expect(page.getByText("Paris Saint-Germain").first()).toBeVisible();
  await expect(page.getByText("Vélodrome")).toBeVisible();
  await page.getByRole("button", { name: "Follow" }).nth(1).click();
  await expect(page.getByText("★ Paris Saint-Germain")).toBeVisible();
  await page.getByRole("button", { name: "Standings" }).click();
  await expect(page.locator("table")).toContainText("26");
});

test("instagram saves: import a library, filter and search", async ({ page }) => {
  await open(page, "/saves/");
  const lib = { cats: [{ id: "claude", name: "Claude Code", group: "ai", n: 1 }, { id: "places", name: "Places", group: "life", n: 1 }], recs: [], tool_urls: { "Claude Code": "https://claude.com/claude-code" },
    posts: [{ i: 1, order: 1, new: "False", cat: "claude", title: "Setup tips", what: "Skills and MCPs", tools: "['Claude Code']", user: "dev", url: "https://instagram.com/p/1", posted: "2026-08-05", video: "True", place: null },
            { i: 2, order: 2, new: "True", cat: "places", title: "Rooftop bar", what: "Sunset view", tools: "[]", user: "trip", url: "https://instagram.com/p/2", posted: "2026-07-01", video: "False", place: { name: "Paris", lat: 48.85, lng: 2.35 } }] };
  await page.locator("input[type=file]").first().setInputFiles({ name: "data.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(lib)) });
  await expect(page.getByRole("link", { name: /Setup tips/ })).toBeVisible();
  await expect(page.getByText("🧰 Claude Code ↗")).toBeVisible();
  await page.getByPlaceholder(/Search a tool/).fill("rooftop");
  await expect(page.getByRole("link", { name: /Setup tips/ })).toHaveCount(0);
  await expect(page.getByText("Rooftop bar")).toBeVisible();
});

test("search: groups and animation filters", async ({ page }) => {
  await open(page, "/discover/?d=films");
  await page.getByTestId("more-filters").click();
  await page.getByRole("button", { name: "Nolan", exact: true }).click();
  await expect(page.locator("main img[alt='Interstellar'], main img[alt='Inception']").first()).toBeVisible();
  await page.getByRole("button", { name: "Nolan", exact: true }).click();
  await page.getByRole("button", { name: "Animation only" }).click();
  await expect(page.locator("main article").first()).toBeVisible();
});

test("style: save a piece from a shop link", async ({ page }) => {
  await page.route("https://api.microlink.io/**", (r) => r.fulfill({ json: { status: "success", data: {
    title: "Scuffers - Zip Hoodie Black | Scuffers", description: "Heavy cotton", image: { url: "https://cdn.example/hoodie.jpg" }, publisher: "Scuffers", price: "89.00", currency: "EUR" } } }));
  await page.route("https://cdn.example/**", (r) => r.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg'/>" }));
  await open(page, "/discover/?d=brands");
  const form = page.getByTestId("piece-from-link");
  await form.getByPlaceholder(/Paste a product link/).fill("https://scuffers.com/products/zip-hoodie");
  await form.getByRole("button", { name: "Read" }).click();
  await expect(form.getByLabel("Piece")).toHaveValue("Zip Hoodie Black");
  await expect(form.getByLabel("Price (€)")).toHaveValue("89");
  await form.getByRole("button", { name: "+ Save to my style" }).click();
  await expect(form.getByText(/Scuffers Zip Hoodie Black saved to your list/)).toBeVisible();
});

test("taste page: measuring your own accuracy needs enough answers", async ({ page }) => {
  await open(page, "/me/");
  const panel = page.getByTestId("my-score");
  await panel.getByRole("button", { name: "Measure" }).click();
  await expect(panel.getByText(/Like at least 15 films first/)).toBeVisible();
});

test("recipes: fridge mode, free-from filter, portions and cook mode", async ({ page }) => {
  await open(page, "/discover/?d=recipes");
  await page.getByRole("button", { name: /gluten/ }).click();
  await page.getByTestId("fridge").click();
  await page.getByRole("searchbox").fill("chicken, lemon");
  await expect(page.getByTestId("fridge-line").first()).toContainText(/\d\/2/);
  await page.locator("main article a").first().click();
  const recipe = page.getByTestId("recipe");
  await expect(recipe).toBeVisible();
  const first = await recipe.locator("li label span").first().textContent();
  await recipe.getByRole("button", { name: "×2" }).click();
  if (first && /^\d/.test(first)) await expect(recipe.locator("li label span").first()).not.toHaveText(first);
  await page.getByTestId("cook").click();
  await expect(page.getByTestId("cook-mode")).toContainText("Step 1 of");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cook-mode")).toHaveCount(0);
});

test("garage: compare two cars side by side", async ({ page }) => {
  await open(page, "/compare/");
  await page.getByTestId("compare-search").fill("911 GT3");
  await page.locator("ul button").filter({ hasText: "hp" }).first().click();
  await page.getByTestId("compare-search").fill("Zonda");
  await page.locator("ul button").first().click();
  const table = page.getByTestId("compare-table");
  await expect(table).toContainText("Power");
  await expect(table.locator("thead th")).toHaveCount(3);
  await expect(table).toContainText("★");
});

test("destinations: climate, best months and the week's weather", async ({ page }) => {
  const days = Array.from({ length: 730 }, (_, i) => new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString().slice(0, 10));
  const m = (d: string) => Number(d.slice(5, 7));
  await page.route("https://archive-api.open-meteo.com/**", (r) => r.fulfill({ json: { timezone: "Europe/Madrid", daily: {
    time: days, temperature_2m_max: days.map((d) => 12 + 14 * Math.sin(((m(d) - 3) / 12) * Math.PI * 2) ** 2 * (m(d) >= 4 && m(d) <= 9 ? 1 : 0.3)),
    temperature_2m_min: days.map(() => 8), precipitation_sum: days.map((d) => (m(d) >= 10 ? 4 : 0.2)), sunshine_duration: days.map(() => 8 * 3600) } } }));
  await page.route("https://api.open-meteo.com/**", (r) => r.fulfill({ json: { current: { temperature_2m: 18, weather_code: 0, wind_speed_10m: 10 },
    daily: { time: days.slice(0, 7), temperature_2m_max: [20, 21, 19, 18, 22, 23, 21], temperature_2m_min: [10, 11, 9, 8, 12, 13, 11], weather_code: [0, 1, 3, 61, 0, 2, 95], precipitation_probability_max: [0, 10, 20, 80, 0, 5, 60] } } }));
  await page.route("https://query.wikidata.org/**", (r) => r.fulfill({ json: { results: { bindings: [] } } }));
  await open(page, "/item/?k=places%3AQ1492");
  const c = page.getByTestId("climate");
  await expect(c).toContainText("When to go");
  await expect(c).toContainText("Most pleasant");
  await expect(c).toContainText("18°");
  expect(await cspViolations(page)).toEqual([]);
});

test("sports: a match opens its events, stats and line-ups", async ({ page }) => {
  const match = { id: "9", name: "PSG at OM", date: new Date(Date.now() - 864e5).toISOString(), competitions: [{ id: "9", date: new Date(Date.now() - 864e5).toISOString(),
    status: { type: { state: "post", shortDetail: "FT" } },
    competitors: [{ homeAway: "home", score: "1", team: { displayName: "Marseille" } }, { homeAway: "away", winner: true, score: "3", team: { displayName: "Paris Saint-Germain" } }] }] };
  await page.route("https://site.api.espn.com/apis/site/v2/**/scoreboard*", (r) => r.fulfill({ json: { events: [match] } }));
  await page.route("https://site.api.espn.com/apis/site/v2/**/summary*", (r) => r.fulfill({ json: {
    keyEvents: [{ type: { type: "goal" }, scoringPlay: true, clock: { displayValue: "12'" }, team: { displayName: "Paris Saint-Germain" }, participants: [{ athlete: { displayName: "Ousmane Dembélé" } }] }],
    boxscore: { teams: [{ team: { displayName: "Marseille" }, statistics: [{ name: "possessionPct", label: "Possession", displayValue: "45.0" }] },
                        { team: { displayName: "Paris Saint-Germain" }, statistics: [{ name: "possessionPct", label: "Possession", displayValue: "55.0" }] }] },
    rosters: [{ team: { displayName: "Marseille" }, formation: "4-3-3", roster: [{ starter: true, jersey: "1", athlete: { displayName: "Gerónimo Rulli" }, position: { abbreviation: "G" } }] }],
    gameInfo: { attendance: 65000, venue: { fullName: "Vélodrome" } } } }));
  await open(page, "/sports/");
  await page.getByTestId("match-more").first().click();
  const d = page.getByTestId("match-detail");
  await expect(d).toContainText("Ousmane Dembélé");
  await d.getByRole("button", { name: "Stats" }).click();
  await expect(d).toContainText("55%");
  await d.getByRole("button", { name: "Line-ups" }).click();
  await expect(d).toContainText("4-3-3");
});

test("film search: type, genre, more filters with removable chips", async ({ page }) => {
  await open(page, "/discover/?d=films");
  const f = page.getByTestId("film-filters");
  await expect(page.getByRole("button", { name: "Directors", exact: true })).toHaveCount(0); // the search box covers people
  await f.getByRole("radio", { name: "Series" }).click();
  await page.getByTestId("more-filters").click();
  const panel = page.getByTestId("more-panel");
  await panel.getByRole("button", { name: "2010s" }).click();
  const active = page.getByTestId("active-filters");
  await expect(active).toContainText("Series");
  await expect(active).toContainText("2010s");
  await expect(page.getByTestId("more-filters")).toContainText("· 1");
  await active.getByRole("button", { name: /Remove 2010s/ }).click();
  await expect(active).not.toContainText("2010s");
  await f.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByTestId("active-filters")).toHaveCount(0);
});

test("tonight lives on the films Home; the old page leads there", async ({ page }) => {
  await open(page, "/tonight/");
  await expect(page).toHaveURL(/\/#tonight$/);
  await expect(page.getByTestId("tonight")).toBeVisible();
});

test("sports: teams, athletes and matches open their own pages", async ({ page }) => {
  const when = new Date(Date.now() - 864e5).toISOString();
  const match = { id: "7", name: "PSG at OM", date: when, competitions: [{ id: "7", date: when, status: { type: { state: "post", shortDetail: "FT" } },
    competitors: [{ id: "176", homeAway: "home", score: "1", team: { id: "176", displayName: "Marseille" } }, { id: "160", homeAway: "away", winner: true, score: "3", team: { id: "160", displayName: "Paris Saint-Germain" } }] }] };
  await page.route("https://site.api.espn.com/apis/site/v2/**/scoreboard*", (r) => r.fulfill({ json: { events: [match] } }));
  await page.route("https://site.api.espn.com/apis/site/v2/**/teams/160/roster", (r) => r.fulfill({ json: {
    team: { id: "160", displayName: "Paris Saint-Germain", standingSummary: "1st in French Ligue 1", recordSummary: "8-2-1", clubhouse: "https://www.espn.com/soccer/club/_/id/160" },
    coach: [{ firstName: "Luis", lastName: "Enrique" }],
    athletes: [{ id: "231388", displayName: "Ousmane Dembélé", jersey: "10", age: 29, citizenship: "France", position: { displayName: "Forward" } }] } }));
  await page.route("https://site.api.espn.com/apis/site/v2/**/teams/160/schedule", (r) => r.fulfill({ json: { events: [{ id: "7", date: when,
    competitions: [{ status: { type: { completed: true } }, competitors: [{ id: "160", homeAway: "away", score: { displayValue: "3" }, team: { id: "160" } },
      { id: "176", homeAway: "home", score: { displayValue: "1" }, team: { id: "176", displayName: "Marseille" } }] }] }] } }));
  await page.route("https://site.web.api.espn.com/apis/common/v3/**/athletes/231388", (r) => r.fulfill({ json: { athlete: {
    id: "231388", displayName: "Ousmane Dembélé", age: 29, citizenship: "France", position: { displayName: "Forward" }, displayHeight: "1.78 m",
    team: { id: "160", displayName: "Paris Saint-Germain" }, statsSummary: { displayName: "2026-27 Ligue 1", statistics: [{ displayName: "Goals", displayValue: "9" }] } } } }));
  await page.route("https://*.wikipedia.org/api/rest_v1/page/summary/**", (r) => r.fulfill({ json: {
    type: "standard", title: "Paris Saint-Germain F.C.", description: "French association football club", extract: "Paris Saint-Germain is a professional football club based in Paris.",
    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Paris_Saint-Germain_F.C." } } } }));
  await page.route("https://site.api.espn.com/apis/site/v2/**/summary*", (r) => r.fulfill({ json: {
    header: { competitions: [{ date: when, status: { type: { state: "post", shortDetail: "FT" } }, competitors: [
      { homeAway: "home", score: "1", team: { id: "176", displayName: "Marseille" } }, { homeAway: "away", score: "3", winner: true, team: { id: "160", displayName: "Paris Saint-Germain" } }] }] },
    boxscore: { teams: [{ team: { id: "176", displayName: "Marseille" } }, { team: { id: "160", displayName: "Paris Saint-Germain" } }] } } }));

  await open(page, "/sports/");
  await page.getByRole("link", { name: "Paris Saint-Germain" }).first().click();
  const team = page.getByTestId("team-page");
  await expect(team).toContainText("1st in French Ligue 1");
  await expect(team).toContainText("Luis Enrique");
  await expect(page.getByTestId("team-bio")).toContainText("professional football club");
  await expect(team.getByRole("link", { name: "Marseille" })).toBeVisible(); // the season's games lead to the opponent
  await page.getByTestId("squad-player").first().click();
  const ath = page.getByTestId("athlete-page");
  await expect(ath).toContainText("Forward");
  await expect(ath).toContainText("Goals");
  await ath.getByRole("link", { name: "Paris Saint-Germain" }).click();
  await expect(page.getByTestId("team-page")).toBeVisible();
  await page.getByRole("link", { name: "3–1" }).click();
  await expect(page.getByTestId("match-page-view")).toContainText("Marseille");
  expect(await cspViolations(page)).toEqual([]);
});

test("sports is a space of its own in the space list", async ({ page, isMobile }) => {
  await open(page, "/");
  if (isMobile) await page.locator("header").getByRole("button").last().click();
  await page.locator("[data-space='sports']:visible").first().click();
  await expect(page).toHaveURL(/\/sports\/$/);
});

test("destinations: pick a country; style: the brand directory", async ({ page }) => {
  await open(page, "/discover/?d=places");
  const country = page.getByTestId("country");
  await expect(country).toBeVisible();
  const first = await country.locator("option").nth(1).textContent();
  await country.selectOption({ index: 1 });
  await expect(page.locator("main article").first()).toContainText(first!.trim());
  await page.goto("/?d=brands");
  await expect(page.getByTestId("catalogue")).toBeVisible();
});

test("sports: every competition in one list, a month calendar, and a race weekend's page", async ({ page }) => {
  const day = new Date();
  day.setHours(15, 0, 0, 0);
  const iso = day.toISOString();
  const race = { id: "600", name: "Qatar Grand Prix", date: iso, competitions: [
    { id: "601", date: iso, type: { abbreviation: "Qual" }, status: { type: { state: "post", shortDetail: "Final" } },
      competitors: [{ order: 1, athlete: { id: "4665", displayName: "Max Verstappen" } }, { order: 2, athlete: { id: "5498", displayName: "Lando Norris" } }, { order: 3, athlete: { id: "5503", displayName: "Oscar Piastri" } }] },
    { id: "602", date: iso, type: { abbreviation: "Race" }, status: { type: { state: "pre", shortDetail: "Sun 17:00" } },
      competitors: [{ order: 1, athlete: { id: "4665", displayName: "Max Verstappen" } }, { order: 2, athlete: { id: "5498", displayName: "Lando Norris" } }, { order: 3, athlete: { id: "5503", displayName: "Oscar Piastri" } }] }] };
  await page.route("https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard*", (r) => r.fulfill({ json: { events: [race] } }));
  await page.route("https://site.api.espn.com/apis/site/v2/sports/soccer/**/scoreboard*", (r) => r.fulfill({ json: { events: [] } }));
  await open(page, "/sports/");
  const list = page.getByTestId("competitions");
  await expect(list.getByRole("button", { name: "Copa del Rey" })).toBeVisible();
  await list.getByRole("searchbox").fill("formula");
  await list.getByRole("button", { name: "Formula 1" }).click();
  await expect(page).toHaveURL(/c=f1/);
  await page.getByRole("button", { name: "Calendar" }).click();
  const cal = page.getByTestId("calendar");
  await expect(cal).toContainText("Qatar Grand Prix");
  await cal.getByTestId("match-page").first().click();
  const ev = page.getByTestId("event-page-view");
  await expect(ev).toContainText("Qatar Grand Prix");
  await expect(ev.getByTestId("event-part")).toHaveCount(2);
  await expect(ev).toContainText("Lando Norris");
  await page.getByRole("link", { name: /Formula 1/ }).first().click();
  await expect(page).toHaveURL(/sports\/\?c=f1/);
});

test("videos: categories, subscribing to a channel, filters in search", async ({ page, isMobile }) => {
  await open(page, "/?d=youtube");
  await expect(page.getByTestId("video-categories")).toBeVisible();
  await page.getByTestId("channels").getByRole("button", { name: /Manage subscriptions/ }).click();
  await page.getByTestId("subscribe").first().click();
  await expect(page.getByTestId("subscribe").first()).toContainText("Subscribed");
  await page.locator(isMobile ? "nav.fixed" : "header.fixed").getByRole("link", { name: "Search", exact: true }).click(); // in-app navigation, as you'd do
  const f = page.getByTestId("video-filters");
  await f.getByRole("button", { name: /My subscriptions · 1/ }).click();
  await expect(page.locator("main article").first()).toBeVisible();
  await f.getByRole("button", { name: "Over an hour" }).click();
  await expect(f.getByRole("button", { name: "Over an hour" })).toHaveAttribute("data-on", "true");
});

test("films home: out now and coming soon", async ({ page }) => {
  await open(page, "/?d=films");
  const r = page.getByTestId("releases");
  await expect(r).toBeVisible();
  await r.getByRole("tab", { name: /Coming soon/ }).click();
  await expect(r.getByRole("tab", { name: /Coming soon/ })).toHaveAttribute("aria-selected", "true");
});

test("my list: a real title, spaces with counts, comments", async ({ page, isMobile }) => {
  await open(page, "/discover/?d=films");
  await page.locator("main article a").first().click();
  await page.getByRole("button", { name: "+ My list" }).click();
  await page.getByTestId("note-add").click();
  await page.getByRole("textbox", { name: "My comment" }).fill("Seen the trailer with Lea, looks great");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("note")).toContainText("Lea");
  await page.locator(isMobile ? "nav.fixed" : "header.fixed").getByRole("link", { name: "My list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My list" })).toBeVisible();
  await expect(page.getByTestId("list-spaces")).toContainText("Films");
  await expect(page.locator("main")).toContainText("Seen the trailer with Lea", { timeout: 60_000 }); // the films catalogue loads first
  await page.getByTestId("list-seen").first().click();
  await expect(page.locator("main")).not.toContainText("Seen the trailer with Lea");
});

test("style: brands with their shops, searchable", async ({ page }) => {
  await open(page, "/?d=brands");
  const c = page.getByTestId("catalogue");
  await expect(c.getByTestId("brand-row").first()).toBeVisible();
  const name = (await c.getByTestId("brand-row").first().locator("a").nth(1).textContent())!.trim();
  await c.getByRole("searchbox").fill(name);
  await expect(c.getByTestId("brand-row").first()).toContainText(name);
});
