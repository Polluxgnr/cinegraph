import type { MetadataRoute } from "next";

export const dynamic = "force-static";
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CineGraph",
    short_name: "CineGraph",
    description: "A personal taste engine: films, series, docs, music, food, travel, cars and style.",
    id: `${BASE}/`,
    start_url: `${BASE}/`,
    scope: `${BASE}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0b0f",
    theme_color: "#0c0b0f",
    categories: ["entertainment", "lifestyle"],
    icons: [
      { src: `${BASE}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${BASE}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
      { src: `${BASE}/icons/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Swipe", url: `${BASE}/swipe/` },
      { name: "Tonight", url: `${BASE}/tonight/` },
      { name: "Vault", url: `${BASE}/vault/` },
    ],
    // "Share" a link from any app on your phone straight into your vault
    share_target: { action: `${BASE}/vault/`, method: "GET", params: { title: "title", text: "text", url: "url" } },
  } as MetadataRoute.Manifest;
}
