"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export interface MapPoint { id: string; lat: number; lon: number; label: string; color: string; badge?: string; faded?: boolean }
export interface MapRoute { color: string; points: [number, number][] }

/**
 * A dark map (OpenStreetMap tiles, darkened in CSS) with coloured markers and optional day routes. Leaflet is loaded
 * on the client only; the map refits whenever the points change.
 */
export default function SpotMap({ points, routes = [], className = "h-80", onSelect }: { points: MapPoint[]; routes?: MapRoute[]; className?: string; onSelect?: (id: string) => void }) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layer = useRef<import("leaflet").LayerGroup | null>(null);
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current) return;
      if (!map.current) {
        map.current = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
        // OpenStreetMap's own tiles (no key), darkened with a CSS filter on the tile pane to match the app
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
          className: "cg-dark-tiles",
        }).addTo(map.current);
        layer.current = L.layerGroup().addTo(map.current);
      }
      const g = layer.current!;
      g.clearLayers();
      for (const r of routes) if (r.points.length > 1) L.polyline(r.points, { color: r.color, weight: 3, opacity: 0.8, dashArray: "6 6" }).addTo(g);
      for (const p of points) {
        const icon = L.divIcon({
          className: "",
          html: `<span style="display:grid;place-items:center;width:${p.badge ? 24 : 14}px;height:${p.badge ? 24 : 14}px;border-radius:999px;background:${p.color};opacity:${p.faded ? 0.45 : 1};border:2px solid #0b0b10;box-shadow:0 0 0 2px ${p.color}55;color:#0b0b10;font:600 11px system-ui">${p.badge ?? ""}</span>`,
          iconSize: p.badge ? [24, 24] : [14, 14],
          iconAnchor: p.badge ? [12, 12] : [7, 7],
        });
        L.marker([p.lat, p.lon], { icon, title: p.label })
          .bindTooltip(p.label, { direction: "top", offset: [0, -8] })
          .on("click", () => select.current?.(p.id))
          .addTo(g);
      }
      const pts = points.filter((p) => !p.faded).map((p) => [p.lat, p.lon] as [number, number]);
      const all = pts.length ? pts : points.map((p) => [p.lat, p.lon] as [number, number]);
      if (all.length) map.current.fitBounds(L.latLngBounds(all).pad(0.15), { maxZoom: 15 });
    })();
    return () => {
      cancelled = true;
    };
  }, [points, routes]);

  useEffect(() => () => {
    map.current?.remove();
    map.current = null;
  }, []);

  return <div ref={el} className={`relative z-0 overflow-hidden rounded-2xl border border-line ${className}`} />;
}
