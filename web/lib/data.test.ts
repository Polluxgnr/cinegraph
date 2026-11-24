import { describe, expect, it } from "vitest";
import { fromColumns } from "./data";

describe("catalogue by column", () => {
  it("rebuilds one object per film and leaves missing fields out", () => {
    const films = fromColumns({ n: 2, cols: { id: [1, 2], t: ["Alien", "Heat"], y: [1979, null], g: [["Horror"], null] } });
    expect(films).toEqual([{ id: 1, t: "Alien", y: 1979, g: ["Horror"] }, { id: 2, t: "Heat" }]);
    expect("y" in films[1]).toBe(false);
  });
});
