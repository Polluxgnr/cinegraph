"use client";

import { useT } from "@/lib/i18n";

import Link from "next/link";
import { useMemo, useState } from "react";
import EntityImage from "@/components/EntityImage";
import PieceFromLink from "@/components/PieceFromLink";
import { detailHref } from "@/components/RecCard";
import type { DomainData } from "@/lib/data";
import { addCustom, recordFeedback } from "@/lib/store";
import { fmtPrice } from "@/lib/text";
import type { Entity } from "@/lib/types";

export const CATEGORIES = ["outerwear", "tops", "pants", "sneakers", "shoes", "bags", "accessories", "eyewear", "fragrance"] as const;
export const LABEL: Record<string, string> = {
  outerwear: "Outerwear", tops: "Tops & knits", pants: "Pants & denim", sneakers: "Sneakers", shoes: "Shoes & boots",
  bags: "Bags", accessories: "Accessories", eyewear: "Eyewear", fragrance: "Fragrance",
};
const SEARCH: Record<string, string> = {
  outerwear: "jacket", tops: "hoodie shirt knit", pants: "pants jeans", sneakers: "sneakers", shoes: "boots shoes",
  bags: "bag", accessories: "cap belt", eyewear: "sunglasses", fragrance: "parfum",
};

export const categoryOf = (e: Entity) => e.tags.find((t) => (CATEGORIES as readonly string[]).includes(t)) ?? "other";

/**
 * A brand, piece by piece: what's in the catalogue and what you added, grouped by category, plus a way to
 * browse every category on the brand's own site and second hand. Works from a brand page and a piece page.
 */
export default function BrandPieces({ d, e }: { d: DomainData; e: Entity }) {
  const T = useT();
  const meta = e.item?.meta ?? {};
  const brand = meta.kind === "piece" && typeof meta.brand === "string" ? meta.brand : e.title;
  const brandEntity = d.entities.find((x) => x.title === brand && x.item?.meta?.kind !== "piece") ?? e;
  const host = (() => {
    try {
      return new URL(brandEntity.item?.url ?? "").host;
    } catch {
      return "";
    }
  })();
  const pieces = useMemo(() => d.entities.filter((x) => x.tags.includes("piece") && (x.item?.meta?.brand === brand || x.tags.includes(brand.toLowerCase()))), [d, brand]);
  const groups = useMemo(() => {
    const g = new Map<string, Entity[]>();
    for (const p of pieces) g.set(categoryOf(p), [...(g.get(categoryOf(p)) ?? []), p]);
    return [...g.entries()].sort((a, b) => CATEGORIES.indexOf(a[0] as never) - CATEGORIES.indexOf(b[0] as never));
  }, [pieces]);
  const q = (s: string) => encodeURIComponent(s);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 font-display text-2xl">{brand}{T(", piece by piece")}</h2>
        {groups.length ? (
          <div className="space-y-5">
            {groups.map(([cat, list]) => (
              <div key={cat}>
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">{T(LABEL[cat] ?? cat)} · {list.length}</p>
                <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
                  {list.map((p) => (
                    <Link key={p.key} href={detailHref(p.key)} className={`card w-40 shrink-0 overflow-hidden ${p.key === e.key ? "border-accent" : ""}`}>
                      <EntityImage e={p} aspect="4/3" />
                      <div className="p-2">
                        <p className="line-clamp-2 text-sm leading-snug">{p.title.replace(`${brand} `, "")}</p>
                        <p className="text-xs text-muted">{typeof p.item?.meta?.price === "number" ? fmtPrice(p.item.meta.price as number, p.item.meta.price_approx === true) : ""}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{T("No pieces saved for")}{" "}{brand} {T("yet. Browse below and add the ones you want to keep in mind.")}</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-2xl">{T("Browse")}{" "}{brand} {T("by category")}</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => (
            <div key={c} className="card flex items-center justify-between gap-2 p-3 text-sm">
              <span>{T(LABEL[c])}</span>
              <span className="flex gap-1.5">
                {host && <a className="chip text-xs" target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${q(`site:${host} ${SEARCH[c]}`)}`}>{T("On their site ↗")}</a>}
                <a className="chip text-xs" target="_blank" rel="noreferrer" href={`https://www.vinted.fr/catalog?search_text=${q(`${brand} ${SEARCH[c].split(" ")[0]}`)}`}>{T("Vinted ↗")}</a>
                <a className="chip text-xs" target="_blank" rel="noreferrer" href={`https://www.grailed.com/shop?query=${q(`${brand} ${SEARCH[c].split(" ")[0]}`)}`}>{T("Grailed ↗")}</a>
              </span>
            </div>
          ))}
        </div>
      </section>

      <PieceFromLink d={d} brand={brand} />
      <AddPiece brand={brand} />
    </div>
  );
}

function AddPiece({ brand }: { brand: string }) {
  const T = useT();
  const [name, setName] = useState("");
  const [cat, setCat] = useState<string>("outerwear");
  const [price, setPrice] = useState("");
  const [url, setUrl] = useState("");
  const [done, setDone] = useState<string | null>(null);
  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-display text-xl">{T("No link? Add a")}{" "}{brand} {T("piece by hand")}</h2>
      <form className="grid gap-2 sm:grid-cols-[1fr_auto_7rem]" onSubmit={(ev) => {
        ev.preventDefault();
        if (!name.trim()) return;
        const [id] = addCustom([{
          domain: "brands", title: `${brand} ${name.trim()}`, subtitle: `${cat} · ${brand}`, url: url.trim() || undefined,
          tags: ["piece", cat, brand.toLowerCase()], meta: { kind: "piece", brand, ...(Number(price) > 0 ? { price: Number(price) } : {}) }, source: "manual",
        }]);
        recordFeedback({ key: id, domain: "brands", action: "want", source: "manual" });
        setDone(`${brand} ${name.trim()} added to your list`);
        setName(""); setPrice(""); setUrl("");
      }}>
        <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder={T("e.g. Goggle jacket in navy")} className="rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
        <select value={cat} onChange={(ev) => setCat(ev.target.value)} className="rounded-lg border border-line bg-panel px-2 py-2 text-sm">
          {CATEGORIES.map((c) => <option key={c} value={c}>{T(LABEL[c])}</option>)}
        </select>
        <input value={price} onChange={(ev) => setPrice(ev.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder={T("€ price")} className="rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
        <input value={url} onChange={(ev) => setUrl(ev.target.value)} placeholder={T("Link to the product (optional)")} className="rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent sm:col-span-2" />
        <button className="btn text-sm">{T("Add")}</button>
      </form>
      {done && <p className="text-xs text-like">✓ {done}</p>}
    </section>
  );
}
