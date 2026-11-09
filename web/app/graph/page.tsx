"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api, type Title } from "@/lib/api";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

interface GNode {
  id: number;
  type: string;
  label: string;
  title_id: number | null;
  year: number | null;
  rating: number | null;
  kind: string | null;
  x?: number;
  y?: number;
}
interface GLink {
  source: number | GNode;
  target: number | GNode;
  rel: string;
}

const COLOR: Record<string, string> = {
  title: "#f3efe7",
  person: "#f2a93b",
  keyword: "#7aa2ff",
  genre: "#9a93a6",
  award: "#ffd166",
  work: "#3ddc97",
  series: "#ff5d8f",
  location: "#4cc9f0",
  subject: "#b892ff",
};

export default function GraphPage() {
  return (
    <Suspense fallback={<div className="card h-96 animate-pulse" />}>
      <GraphView />
    </Suspense>
  );
}

function GraphView() {
  const router = useRouter();
  const params = useSearchParams();
  const titleId = params.get("title") ? Number(params.get("title")) : null;
  const [data, setData] = useState<{ nodes: GNode[]; links: GLink[] } | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Title[]>([]);
  const [hover, setHover] = useState<GNode | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fg = useRef<any>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });

  useEffect(() => {
    const path = titleId ? `/graph/title/${titleId}` : "/graph/me";
    api.get<{ nodes: GNode[]; links: GLink[] }>(path).then(setData);
  }, [titleId]);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: Math.max(420, window.innerHeight - 260) }));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (q.length < 2) return;
    const id = setTimeout(() => api.get<Title[]>(`/titles/search?q=${encodeURIComponent(q)}&limit=6`).then(setHits), 200);
    return () => clearTimeout(id);
  }, [q]);
  const shownHits = q.length >= 2 ? hits : [];

  const graph = useMemo(() => data && { nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => ({ ...l })) }, [data]);

  useEffect(() => {
    const f = fg.current;
    if (!f || !graph) return;
    f.d3Force("charge")?.strength(-140);
    f.d3Force("link")?.distance(45);
  }, [graph]);


  function focus(id: number | null) {
    setQ("");
    setHits([]);
    router.replace(id ? `/graph?title=${id}` : "/graph");
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl md:text-5xl">{titleId ? "Around one title" : "Your taste graph"}</h1>
          <p className="text-sm text-muted">
            {titleId
              ? "People, awards, sources and themes it shares with other titles (yours first)."
              : "Your top-rated titles and what connects them. Click a title to recentre."}
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Centre on a title…"
            className="w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {shownHits.length > 0 && (
            <ul className="card absolute z-20 mt-1 w-full overflow-hidden">
              {shownHits.map((h) => (
                <li key={h.id}>
                  <button className="w-full px-3 py-2 text-left text-sm hover:bg-panel-2" onClick={() => focus(h.id)}>
                    {h.title} <span className="text-muted">{h.year}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>
      {titleId && (
        <button className="text-sm text-muted hover:text-ink" onClick={() => focus(null)}>
          ← back to your taste graph
        </button>
      )}
      <div ref={wrap} className="card relative overflow-hidden">
        {graph && graph.nodes.length === 0 && (
          <p className="p-6 text-sm text-muted">
            Nothing to draw yet. Rate a few titles (or import Letterboxd) and run <code>cinegraph build graph</code>.
          </p>
        )}
        {graph && graph.nodes.length > 0 && (
          <ForceGraph2D
            ref={fg}
            graphData={graph}
            onEngineStop={() => fg.current?.zoomToFit(400, 40)}
            d3VelocityDecay={0.3}
            width={size.w}
            height={size.h}
            backgroundColor="#16141b"
            cooldownTicks={120}
            linkColor={() => "rgba(154,147,166,0.25)"}
            nodeRelSize={4}
            onNodeHover={(n) => setHover((n as GNode) ?? null)}
            onNodeClick={(n) => {
              const node = n as GNode;
              if (node.title_id) {
                if (node.title_id === titleId) router.push(`/title/${node.title_id}`);
                else focus(node.title_id);
              }
            }}
            nodeCanvasObject={(n, ctx, scale) => {
              const node = n as GNode;
              const isTitle = node.type === "title";
              const r = isTitle ? 5 + (node.rating ?? 0) : 3.5;
              ctx.beginPath();
              ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
              ctx.fillStyle = COLOR[node.type] ?? "#888";
              ctx.fill();
              if (node.title_id === titleId) {
                ctx.strokeStyle = "#f2a93b";
                ctx.lineWidth = 2;
                ctx.stroke();
              }
              const important = node.title_id === titleId || node.rating != null || !isTitle || hover?.id === node.id;
              if (important || scale > 2.2) {
                const fs = (isTitle ? 12 : 10) / scale;
                ctx.font = `${isTitle ? 600 : 400} ${fs}px Manrope, sans-serif`;
                ctx.fillStyle = isTitle ? "#f3efe7" : "rgba(243,239,231,0.7)";
                ctx.textAlign = "center";
                ctx.fillText(node.label.length > 28 ? node.label.slice(0, 27) + "…" : node.label, node.x!, node.y! + r + fs + 1);
              }
            }}
          />
        )}
        {hover && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/80 px-3 py-2 text-xs">
            <span className="uppercase tracking-wider text-muted">{hover.type}</span>
            <p className="text-sm">{hover.label}</p>
            {hover.rating && <p className="text-accent">you rated {hover.rating}</p>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        {Object.entries(COLOR).map(([k, c]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
            {k}
          </span>
        ))}
        {titleId && (
          <Link href={`/title/${titleId}`} className="ml-auto text-accent">
            Open title →
          </Link>
        )}
      </div>
    </div>
  );
}
