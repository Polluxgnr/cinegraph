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
