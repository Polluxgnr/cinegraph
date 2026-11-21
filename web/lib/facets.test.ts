import { describe, expect, it } from "vitest";
import { cuisineOf, dietOf, mainsOf, variations, videoScore, videoThemes } from "./facets";
import type { Entity } from "./types";

const recipe = (title: string, ingredients: string[], category = "Miscellaneous", area = "British"): Entity =>
  ({ key: `recipes:${title}`, domain: "recipes", title, subtitle: `${area} · ${category}`, tags: [], pop: 0, item: { meta: { ingredients, category, area } } }) as unknown as Entity;
const video = (id: string, views: number, likes: number, tags: string[] = []): Entity =>
  ({ key: `youtube:${id}`, domain: "youtube", title: id, subtitle: "ARTE", tags, pop: views, item: { meta: { views, likes } } }) as unknown as Entity;

describe("recipes", () => {
  const curry = recipe("Chicken curry", ["500g Chicken thighs", "1 Onion", "2 tbsp Curry powder", "400ml Coconut milk"], "Chicken", "India");
  const dal = recipe("Red lentil dal", ["200g Red lentils", "1 Onion", "1 tsp Turmeric", "400ml Coconut milk"], "Vegetarian", "India");
  const omelette = recipe("Cheese omelette", ["3 Eggs", "30g Cheddar", "Butter"], "Breakfast", "France");
  const prawn = recipe("Prawn curry", ["300g Prawns", "1 Onion", "2 tbsp Curry powder", "400ml Coconut milk"], "Seafood", "Thai");

  it("reads the cuisine", () => expect(cuisineOf(curry)).toBe("India"));
  it("finds vegetarian and vegan dishes from the ingredients", () => {
    expect(dietOf(dal)).toBe("vegan");
    expect(dietOf(omelette)).toBe("vegetarian");
    expect(dietOf(curry)).toBeUndefined();
    expect(dietOf(prawn)).toBeUndefined();
  });
  it("names the main ingredient", () => {
    expect(mainsOf(curry)).toContain("Chicken");
    expect(mainsOf(prawn)).toContain("Fish & seafood");
    expect(mainsOf(omelette)).toContain("Eggs");
  });
  it("variations share the dish or most ingredients", () => {
    const v = variations(curry, [curry, dal, omelette, prawn]).map((x) => x.title);
    expect(v[0]).toBe("Prawn curry");
    expect(v).not.toContain("Cheese omelette");
  });
});

describe("videos", () => {
  it("themes come from the topic tags", () => {
    expect(videoThemes(video("a", 1, 1, ["nature", "documentary"]))).toContain("Nature & animals");
    expect(videoThemes(video("b", 1, 1, ["geopolitics"]))).toContain("Geopolitics");
  });
  it("viewer score ranks like rate, damped for small audiences", () => {
    const all = [video("lo", 100_000, 1_000), video("mid", 100_000, 3_000), video("hi", 100_000, 8_000), video("big20", 100_000, 20_000), video("tiny", 400, 80)];
    const s = (id: string) => videoScore(all.find((x) => x.key.endsWith(id))!, all)!;
    expect(s("hi")).toBeGreaterThan(s("mid"));
    expect(s("mid")).toBeGreaterThan(s("lo"));
    expect(s("tiny")).toBeLessThan(s("big20")); // the same 20% like rate on 400 views is pulled towards the median
    expect(videoScore(video("x", 100, 50), all)).toBeUndefined();
  });
});
