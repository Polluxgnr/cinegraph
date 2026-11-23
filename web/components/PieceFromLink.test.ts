import { describe, expect, it } from "vitest";
import type { DomainData } from "@/lib/data";
import { guessBrand, guessCategory } from "./PieceFromLink";

const d = { entities: [
  { key: "brands:stone-island", title: "Stone Island", item: { url: "https://www.stoneisland.com", meta: { kind: "brand" } } },
  { key: "brands:scuffers", title: "Scuffers", item: { url: "https://scuffers.com", meta: { kind: "brand" } } },
] } as unknown as DomainData;

describe("piece from a link", () => {
  it("knows the brand from the shop's site, or from the page title", () => {
    expect(guessBrand(d, "https://scuffers.com/products/zip-hoodie")).toEqual({ name: "Scuffers", known: true });
    expect(guessBrand(d, "https://www.ssense.com/p/123", "Stone Island Ghost Piece overshirt | SSENSE")).toEqual({ name: "Stone Island", known: true });
    expect(guessBrand(d, "https://www.mertra.com/products/x", "Hoodie")).toEqual({ name: "Mertra", known: false });
  });
  it("guesses the category from the name", () => {
    expect(guessCategory("Logo zip hoodie black")).toBe("tops");
    expect(guessCategory("Cargo pant olive")).toBe("pants");
    expect(guessCategory("Gore-Tex shell jacket")).toBe("outerwear");
    expect(guessCategory("XT-6 Advanced")).toBe("sneakers");
  });
});

describe("name from the link", () => {
  it("drops shop paths and SKU codes", async () => {
    const { nameFromUrl } = await import("./PieceFromLink");
    expect(nameFromUrl("https://www.salomon.com/en-us/shop/product/xt-6-l41741400.html")).toBe("XT-6");
    expect(nameFromUrl("https://scuffers.com/products/zip-hoodie-black")).toBe("Zip Hoodie Black");
  });
});
