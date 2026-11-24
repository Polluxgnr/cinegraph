import { describe, expect, it } from "vitest";
import { leagueById, metric, sideHref, wikiHint } from "./sports";

describe("sports helpers", () => {
  it("turns ESPN's imperial sizes into metric", () => {
    expect(metric(`6' 3"`)).toBe("191 cm");
    expect(metric("174 lbs")).toBe("79 kg");
    expect(metric("1.78 m")).toBe("1.78 m");
    expect(metric(undefined)).toBeUndefined();
  });

  it("links a side to its team, or to the athlete in individual sports", () => {
    const l = leagueById("fra.1")!;
    expect(sideHref(l, { id: "160" })).toBe("/sports/team/?l=fra.1&id=160");
    expect(sideHref(l, { id: "9", athlete: true })).toBe("/sports/athlete/?l=fra.1&id=9");
    expect(sideHref(l, {})).toBeUndefined();
  });

  it("words the Wikipedia search per sport", () => {
    expect(wikiHint(leagueById("fra.1")!, "team")).toEqual({ en: "football club", fr: "club de football" });
    expect(wikiHint(leagueById("nba")!, "athlete").en).toBe("basketball player");
  });
});
