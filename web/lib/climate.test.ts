import { describe, expect, it } from "vitest";
import { comfort, sky } from "./climate";

describe("climate", () => {
  it("prefers warm dry sunny months", () => {
    const summer = comfort({ hi: 26, rain: 30, wetDays: 4, sun: 10 });
    const winter = comfort({ hi: 6, rain: 60, wetDays: 14, sun: 2 });
    const scorching = comfort({ hi: 41, rain: 0, wetDays: 0, sun: 11 });
    expect(summer).toBeGreaterThan(0.9);
    expect(winter).toBeLessThan(0.3);
    expect(scorching).toBeLessThan(summer);
  });
  it("names the sky", () => {
    expect(sky(0)[1]).toBe("Clear");
    expect(sky(95)[1]).toBe("Thunderstorm");
  });
});
