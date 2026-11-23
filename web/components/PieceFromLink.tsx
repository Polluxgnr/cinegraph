"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { CATEGORIES } from "@/components/BrandPieces";
import type { DomainData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { pieceMeta, type PieceMeta } from "@/lib/meta";
import { addCustom, getState, recordFeedback } from "@/lib/store";

const LABEL: Record<string, string> = {
  outerwear: "Outerwear", tops: "Tops & knits", pants: "Pants & denim", sneakers: "Sneakers", shoes: "Shoes & boots",
  bags: "Bags", accessories: "Accessories", eyewear: "Eyewear", fragrance: "Fragrance",
};
const GUESS: [string, RegExp][] = [
  ["sneakers", /sneaker|trainer|runner|xt-6|samba|dunk|jordan|new balance|\b9\d{2}\b|basket/i],
  ["shoes", /boot|loafer|derby|shoe|mule|clog|sandal|chaussure|bottine/i],
  ["outerwear", /jacket|coat|parka|puffer|anorak|gilet|overshirt|bomber|blouson|veste|manteau|doudoune|shell/i],
  ["pants", /pant|trouser|jean|denim|short|jogger|cargo|chino|pantalon/i],
  ["bags", /bag|tote|backpack|pouch|wallet|sac\b|sacoche/i],
  ["eyewear", /sunglass|glasses|eyewear|lunettes/i],
  ["fragrance", /parfum|perfume|fragrance|eau de|cologne/i],
  ["accessories", /cap|hat|beanie|scarf|belt|sock|ring|necklace|chain|bonnet|casquette|écharpe/i],
  ["tops", /t-?shirt|tee|shirt|hoodie|sweat|crew|knit|sweater|jumper|cardigan|polo|top|chemise|pull/i],
];
export const guessCategory = (s: string) => GUESS.find(([, re]) => re.test(s))?.[0] ?? "tops";

/** "/en-us/shop/product/xt-6-l41741400.html" -> "XT-6": the product's name from its link, when the page has none. */
export function nameFromUrl(url: string): string {
  let seg = "";
  try {
    seg = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    return "";
  }
  const words = seg.replace(/\.(html?|php|aspx?)$/i, "").split(/[-_]+/)
    .filter((w) => w && !(/\d/.test(w) && /[a-z]/i.test(w) && w.length >= 6) && !/^\d{5,}$/.test(w)); // drop SKU-like tokens
  // short codes next to a number are model names ("xt 6" -> "XT-6"), the rest is title case
  const cased = words.map((w, k) => (w.length <= 3 && /^[a-z]+$/i.test(w) && /^\d{1,3}$/.test(words[k + 1] ?? "") ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)));
  return cased.join(" ").replace(/\b([A-Z]{1,3}) (\d{1,3})\b/g, "$1-$2");
}

/** The catalogue brand behind a shop link (same site), else one named in the page title, else the shop's name. */
export function guessBrand(d: DomainData | null, url: string, title = "", publisher = ""): { name: string; known: boolean } {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* not a URL */
  }
  const brands = (d?.entities ?? []).filter((x) => x.item?.meta?.kind === "brand");
  const byHost = brands.find((b) => {
    try {
      return b.item?.url && new URL(b.item.url).hostname.replace(/^www\./, "") === host;
    } catch {
      return false;
    }
  });
  if (byHost) return { name: byHost.title, known: true };
  const named = brands.filter((b) => b.title.length > 2 && new RegExp(`\\b${b.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(title)).sort((a, b) => b.title.length - a.title.length)[0];
  if (named) return { name: named.title, known: true };
  const fromHost = host.split(".")[0];
  return { name: publisher && publisher.length < 30 && !publisher.includes(".") ? publisher : fromHost.charAt(0).toUpperCase() + fromHost.slice(1), known: false };
}

/**
 * Save a piece from any shop by its link: the page's preview gives the photo, the name and (when the shop publishes
 * it) the price; brand and category are guessed and editable. Saved pieces join your Style list and taste profile.
 */
export default function PieceFromLink({ d, brand: fixedBrand }: { d: DomainData | null; brand?: string }) {
  const T = useT();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<PieceMeta | null>(null);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState(fixedBrand ?? "");
  const [cat, setCat] = useState("tops");
  const [price, setPrice] = useState("");
  const [done, setDone] = useState<string | null>(null);

  async function read(u: string) {
    if (!/^https?:\/\//i.test(u.trim())) return;
    setBusy(true);
    setDone(null);
    const meta = await pieceMeta(u.trim());
    setM(meta);
    const b = fixedBrand ? { name: fixedBrand, known: true } : guessBrand(d, u, meta.title, meta.provider);
    setBrand(b.name);
    // "Brand - Piece | Shop" -> "Piece"
    const clean = (meta.title ?? "").split(/\s[|–—]\s/)[0].replace(new RegExp(`^${b.name}\\s*[-:–]?\\s*`, "i"), "").trim();
    // a shop that serves its generic site title on product pages: the link names the product instead
    const generic = !clean || clean.toLowerCase() === b.name.toLowerCase() || clean.length > 70;
    const piece = generic ? nameFromUrl(u.trim()) : clean;
    setName(piece);
    setCat(GUESS.some(([, re]) => re.test(piece)) ? guessCategory(piece) : guessCategory(`${meta.title ?? ""} ${meta.description ?? ""}`));
    setPrice(meta.price ? String(Math.round(meta.price)) : "");
    setBusy(false);
  }

  function save() {
    if (!name.trim() || !brand.trim()) return;
    const title = `${brand.trim()} ${name.trim()}`;
    if (getState().custom.some((c) => c.domain === "brands" && c.url === url.trim())) return setDone(T("Already saved"));
    // a brand you didn't have yet joins your Style space too
    const known = (d?.entities ?? []).some((x) => x.item?.meta?.kind === "brand" && x.title.toLowerCase() === brand.trim().toLowerCase());
    if (!known) {
      let site: string | undefined;
      try {
        site = new URL(url.trim()).origin;
      } catch {
        /* no site */
      }
      const [bid] = addCustom([{ domain: "brands", title: brand.trim(), subtitle: site ? new URL(site).host : "", url: site, tags: ["found on the web"], meta: { kind: "brand" }, source: "web" }]);
      recordFeedback({ key: bid, domain: "brands", action: "liked", source: "web" });
    }
    const [id] = addCustom([{
      domain: "brands", title, subtitle: `${cat} · ${brand.trim()}`, url: url.trim(), image: m?.image,
      tags: ["piece", cat, brand.trim().toLowerCase()], note: m?.description,
      meta: { kind: "piece", brand: brand.trim(), category: cat, ...(Number(price) > 0 ? { price: Number(price), currency: m?.currency ?? "EUR" } : {}) },
      source: "link",
    }]);
    recordFeedback({ key: id, domain: "brands", action: "want", source: "link" });
    setDone(T("{t} saved to your list", { t: title }));
    setUrl("");
    setM(null);
    setName("");
    setPrice("");
  }

  return (
    <section className="card space-y-3 p-4" data-testid="piece-from-link">
      <h2 className="font-display text-xl">{fixedBrand ? T("Save a {b} piece from its link", { b: fixedBrand }) : T("Save a piece from any shop")}</h2>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); read(url); }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} onPaste={(e) => { const v = e.clipboardData.getData("text"); setTimeout(() => read(v), 0); }}
               placeholder={T("Paste a product link (any shop)")} inputMode="url"
               className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
        <button className="btn px-3 py-1.5 text-sm" disabled={busy}>{busy ? T("Reading…") : T("Read")}</button>
      </form>
      {m && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative aspect-[4/5] w-full shrink-0 overflow-hidden rounded-xl bg-panel-2 sm:w-40">
            {/* eslint-disable-next-line @next/next/no-img-element -- shop preview */}
            {m.image ? <img src={m.image} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <span className="absolute inset-0 grid place-items-center text-4xl">👕</span>}
          </div>
          <div className="grid flex-1 content-start gap-2 sm:grid-cols-2">
            <label className="text-xs text-muted sm:col-span-2">{T("Piece")}
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
            </label>
            <label className="text-xs text-muted">{T("Brand")}
              <input value={brand} onChange={(e) => setBrand(e.target.value)} disabled={!!fixedBrand} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
            </label>
            <label className="text-xs text-muted">{T("Category")}
              <select value={cat} onChange={(e) => setCat(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-panel px-2 py-2 text-sm text-ink">
                {CATEGORIES.map((c) => <option key={c} value={c}>{T(LABEL[c])}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted">{T("Price")}{m.currency && m.currency !== "EUR" ? ` (${m.currency})` : " (€)"}
              <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder={T("optional")}
                     className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
            </label>
            <div className="flex items-end">
              <button type="button" className="btn w-full py-2 text-sm" onClick={save} disabled={!name.trim() || !brand.trim()}>{T("+ Save to my style")}</button>
            </div>
            {!m.title && <p className="text-xs text-muted sm:col-span-2">{T("This shop doesn't share a preview: type the name and price yourself.")}</p>}
          </div>
        </motion.div>
      )}
      {done && <p className="text-xs text-like">✓ {done}</p>}
    </section>
  );
}
