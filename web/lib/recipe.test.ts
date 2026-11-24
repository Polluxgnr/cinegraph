import { describe, expect, it } from "vitest";
import type { Entity } from "./types";
import { allergensOf, durationsIn, fridgeMatch, fridgeTerms, scaleLine, stepsOf } from "./recipe";

const r = (ingredients: string[], instructions = ""): Entity => ({ key: "recipes:1", domain: "recipes", title: "x", subtitle: "", tags: [], pop: 0, item: { meta: { ingredients, instructions } } } as unknown as Entity);

describe("recipe text", () => {
  it("finds allergens and spares plant milks", () => {
    expect(allergensOf(r(["200g Plain Flour", "2 Eggs", "100ml Coconut Milk"]))).toEqual(["gluten", "eggs"]);
    expect(allergensOf(r(["150g Raw tiger prawns", "1 tbsp Fish Sauce", "2 tbsp Tahini"]))).toEqual(["fish", "shellfish", "sesame"]);
    expect(allergensOf(r(["100g Rice Flour", "Oat Milk"]))).toEqual([]);
    expect(allergensOf(r(["Almond Milk"]))).toEqual(["nuts"]);
  });
  it("scales quantities", () => {
    expect(scaleLine("800g Black Eyed Peas", 2)).toBe("1.6kg Black Eyed Peas");
    expect(scaleLine("1/2 tsp Salt", 2)).toBe("1 tsp Salt");
    expect(scaleLine("1 1/2 cups Milk", 2)).toBe("3 cups Milk");
    expect(scaleLine("3 Eggs", 0.5)).toBe("1½ Eggs");
    expect(scaleLine("Juice of 1 Lime", 2)).toBe("Juice of 1 Lime");
    expect(scaleLine("2-3 cloves Garlic", 2)).toBe("4-6 cloves Garlic");
  });
  it("splits steps and reads times", () => {
    expect(stepsOf("step 1\r\nChop it.\r\nstep 2\r\nCook it.")).toEqual(["Chop it.", "Cook it."]);
    expect(durationsIn("Simmer for 1-2 hours, then rest 10 mins")).toEqual([120, 10]);
  });
  it("matches a fridge", () => {
    expect(fridgeTerms("chicken, lemons + rice")).toEqual(["chicken", "lemons", "rice"]);
    const m = fridgeMatch(r(["1 Chicken", "1 Lemon", "Salt", "200g Spinach"]), ["chicken", "lemons"]);
    expect(m.have).toEqual(["chicken", "lemons"]);
    expect(m.missing).toEqual(["200g Spinach"]);
  });
});
