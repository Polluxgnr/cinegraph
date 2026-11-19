"use client";

import { useT } from "@/lib/i18n";

import { useState } from "react";
import { linkMeta, type LinkMeta } from "@/lib/meta";
import { addCustom, getState, recordFeedback } from "@/lib/store";

/**
 * Style search beyond the catalogue: for a name like "mertra" or "jacker", try the brand's likely own sites
 * (link preview, only when you ask) and open the usual places people find underground labels.
 */
const TLDS = ["com", "fr", "co", "store", "shop", "eu", "co.uk", "be"];

export default function WebLookup({ query }: { query: string }) {
  const T = useT();
  const [found, setFound] = useState<{ url: string; meta: LinkMeta }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const q = encodeURIComponent(query);

  async function lookUp() {
    setBusy(true);
    const probe = async (urls: string[]) =>
      (await Promise.all(urls.map(async (url) => ({ url, meta: await linkMeta(url) })))).filter((r) => r.meta.title || r.meta.image);
    let res = query.includes(".")
      ? await probe([`https://${query.replace(/^https?:\/\//, "")}`])
      : await probe(TLDS.slice(0, 4).map((t) => `https://www.${slug}.${t}`));
    if (!res.length && !query.includes(".")) res = await probe(TLDS.slice(0, 4).map((t) => `https://${slug}.${t}`));
    setFound(res);
    setBusy(false);
  }

  function add(url: string, meta: LinkMeta) {
    const name = query.includes(".") ? (meta.title?.split(/[|–—-]/)[0].trim() || query) : query.replace(/\b\w/g, (c) => c.toUpperCase());
    if (getState().custom.some((c) => c.domain === "brands" && c.url === url)) return setAdded(name);
    const [id] = addCustom([{ domain: "brands", title: name, subtitle: new URL(url).host, url, image: meta.image, tags: ["underground", "found on the web"], note: meta.description, meta: { kind: "brand" }, source: "web" }]);
    recordFeedback({ key: id, domain: "brands", action: "liked", source: "web" });
    setAdded(name);
  }

  if (slug.length < 3) return null;
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{T("Looking for")}{" "}<b>{query}</b> {T("beyond the catalogue?")}</p>
        <button className="btn px-3 py-1.5 text-sm" onClick={lookUp} disabled={busy}>{busy ? T("Looking…") : T("Find their site")}</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <a className="chip text-xs" target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${q}+clothing+brand`}>{T("Google ↗")}</a>
        <a className="chip text-xs" target="_blank" rel="noreferrer" href={`https://www.instagram.com/${slug}/`}>{T("Instagram @")}{slug} ↗</a>
        <a className="chip text-xs" target="_blank" rel="noreferrer" href={`https://www.pinterest.com/search/pins/?q=${q}`}>{T("Pinterest ↗")}</a>
        <a className="chip text-xs" target="_blank" rel="noreferrer" href={`https://www.vinted.fr/catalog?search_text=${q}`}>{T("Vinted ↗")}</a>
        <a className="chip text-xs" target="_blank" rel="noreferrer" href={`https://www.grailed.com/shop?query=${q}`}>{T("Grailed ↗")}</a>
        <a className="chip text-xs" target="_blank" rel="noreferrer" href={`https://www.tiktok.com/search?q=${q}`}>{T("TikTok ↗")}</a>
      </div>
      {found && !found.length && <p className="text-xs text-muted">{T("No site found at")}{" "}{slug}{T(".com/.fr/.co/.store. Paste their link in “+ Add” if you know it.")}</p>}
      {found?.map(({ url, meta }) => (
        <div key={url} className="flex items-center gap-3 rounded-xl border border-line p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- link preview */}
          {meta.image && <img src={meta.image} alt="" className="h-14 w-14 rounded-lg object-cover" />}
          <div className="min-w-0 flex-1">
            <a href={url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:text-accent">{meta.title ?? url}</a>
            <p className="truncate text-xs text-muted">{new URL(url).host}{meta.description ? ` · ${meta.description}` : ""}</p>
          </div>
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => add(url, meta)}>{added ? T("✓ Added") : T("+ Add to my style")}</button>
        </div>
      ))}
    </section>
  );
}
