"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { detailHref } from "@/components/RecCard";
import type { FilmData } from "@/lib/data";
import { entitiesOf, entityLabel } from "@/lib/engine/score";
import { useFilms, useQueryParam } from "@/lib/hooks";
import { type Feedback, useStore } from "@/lib/store";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

interface GNode { id: string; label: string; type: string; key?: string; liked?: boolean; x?: number; y?: number }
interface GLink { source: string; target: string }

const COLOR: Record<string, string> = {
  title: "#f3efe7", director: "#f2a93b", writer: "#f2a93b", creator: "#f2a93b", cast: "#ffb86b", composer: "#ffb86b",
  saga: "#ff5d8f", award: "#ffd166", source: "#3ddc97", influence: "#3ddc97", location: "#4cc9f0", subject: "#b892ff",
};

/** Built in the browser from the catalogue: your liked titles + every person / saga / award / source
 * shared by at least two of them, or the neighbourhood of one title. */
function buildGraph(d: FilmData, feedback: Record<string, Feedback>, center: string | null) {
  const nodes = new Map<string, GNode>();
  const links: GLink[] = [];
  const addTitle = (row: number, liked = false) => {
    const e = d.entities[row];
    if (!nodes.has(e.key)) nodes.set(e.key, { id: e.key, label: e.title, type: "title", key: e.key, liked });
  };
  if (center) {
    const row = d.index.get(center);
    if (row == null) return { nodes: [], links: [] };
    addTitle(row, true);
    const all = entitiesOf(d.films[row]);
    const ents = all.filter(([rel]) => rel !== "cast").concat(all.filter(([r]) => r === "cast").slice(0, 4));
    for (const [rel, ent] of ents) {
      nodes.set(ent, { id: ent, label: entityLabel(d, ent), type: rel });
      links.push({ source: center, target: ent });
      let n = 0;
      for (let i = 0; i < d.films.length && n < 4; i++) {
        if (i === row) continue;
        if (entitiesOf(d.films[i]).some(([, e2]) => e2 === ent)) {
          addTitle(i, ["loved", "liked"].includes(feedback[d.entities[i].key]?.action ?? ""));
          links.push({ source: d.entities[i].key, target: ent });
          n++;
        }
      }
    }
    return { nodes: [...nodes.values()], links };
  }
  const liked = Object.values(feedback).filter((f) => f.domain === "films" && (f.action === "loved" || f.action === "liked")).slice(-60);
  const count = new Map<string, { rel: string; titles: string[] }>();
  for (const f of liked) {
    const row = d.index.get(f.key);
    if (row == null) continue;
    for (const [rel, ent] of entitiesOf(d.films[row])) {
      const c = count.get(ent) ?? { rel, titles: [] };
      c.titles.push(f.key);
      count.set(ent, c);
    }
  }
  for (const [ent, { rel, titles }] of count) {
    if (titles.length < 2) continue;
    nodes.set(ent, { id: ent, label: entityLabel(d, ent), type: rel });
    for (const t of titles) {
      addTitle(d.index.get(t)!, true);
      links.push({ source: t, target: ent });
    }
  }
  return { nodes: [...nodes.values()], links };
}

export default function GraphPage() {
  const films = useFilms().data;
  const feedback = useStore((s) => s.feedback);
  const [center, setCenter] = useQueryParam("k");
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fg = useRef<any>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [hover, setHover] = useState<GNode | null>(null);
  const graph = useMemo(() => (films ? buildGraph(films, feedback, center) : null), [films, feedback, center]);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: Math.max(420, window.innerHeight - 260) }));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    fg.current?.d3Force("charge")?.strength(-150);
    fg.current?.d3Force("link")?.distance(50);
  }, [graph]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl md:text-5xl">{center ? "Around one title" : "Your taste graph"}</h1>
          <p className="text-sm text-muted">
            {center ? "Its people, saga, awards and sources, and other titles sharing them." : "What connects the titles you liked: people, sagas, awards, sources. Click a title to explore around it."}
          </p>
        </div>
        {center && <button className="text-sm text-muted hover:text-ink" onClick={() => setCenter(null)}>← my taste graph</button>}
      </header>
      <div ref={wrap} className="card relative overflow-hidden">
        {graph && !graph.nodes.length && <p className="p-6 text-sm text-muted">Like a few films that share people or a saga, and the graph will draw itself.</p>}
        {graph && graph.nodes.length > 0 && (
          <ForceGraph2D
            ref={fg}
            graphData={graph}
            width={size.w}
            height={size.h}
            backgroundColor="#16141b"
            cooldownTicks={120}
            onEngineStop={() => fg.current?.zoomToFit(400, 40)}
            linkColor={() => "rgba(154,147,166,0.25)"}
            onNodeHover={(n) => setHover((n as GNode) ?? null)}
            onNodeClick={(n) => {
              const node = n as GNode;
              if (!node.key) return;
              if (node.key === center) router.push(detailHref(node.key));
              else setCenter(node.key);
            }}
            nodeCanvasObject={(n, ctx, scale) => {
              const node = n as GNode;
              const isTitle = node.type === "title";
              const r = isTitle ? (node.liked ? 6 : 4) : 3.5;
              ctx.beginPath();
              ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
              ctx.fillStyle = COLOR[node.type] ?? "#888";
              ctx.fill();
              if (node.id === center) {
                ctx.strokeStyle = "#f2a93b";
                ctx.lineWidth = 2;
                ctx.stroke();
              }
              if (!isTitle || node.liked || scale > 2 || hover?.id === node.id) {
                const fs = (isTitle ? 12 : 10) / scale;
                ctx.font = `${isTitle ? 600 : 400} ${fs}px Manrope, sans-serif`;
                ctx.fillStyle = isTitle ? "#f3efe7" : "rgba(243,239,231,0.75)";
                ctx.textAlign = "center";
                ctx.fillText(node.label.length > 26 ? node.label.slice(0, 25) + "…" : node.label, node.x!, node.y! + r + fs + 1);
              }
            }}
          />
        )}
        {hover && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/80 px-3 py-2 text-xs">
            <span className="uppercase tracking-wider text-muted">{hover.type}</span>
            <p className="text-sm">{hover.label}</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        {Object.entries({ title: "title", director: "people", saga: "saga", award: "award", source: "source", location: "place", subject: "subject" }).map(([k, l]) => (
          <span key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR[k] }} />{l}</span>
        ))}
      </div>
    </div>
  );
}
