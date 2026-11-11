"use client";

import { useEffect, useState } from "react";
import { DOMAINS } from "@/lib/domains";
import { importNetflix, importPack, importPinterest, importSpotify, importYouTube } from "@/lib/imports";
import { backupJSON, importLetterboxd, restoreJSON } from "@/lib/io";
import { finishLogin, redirectUri, startLogin } from "@/lib/spotify";
import { setSettings, useLoaded, useStore } from "@/lib/store";

/** Bring your history in from the services you use, through their official exports. */
export default function ImportPage() {
  const imports = useStore((s) => s.imports);
  const spotify = useStore((s) => s.spotify);
  const clientId = useStore((s) => s.settings.spotifyClientId);
  const loaded = useLoaded();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Spotify sends you back here with ?code=
  useEffect(() => {
    if (!loaded) return;
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) return;
    window.history.replaceState(null, "", window.location.pathname);
    finishLogin(code).then(setMsg).catch((e) => setMsg(`Spotify: ${e.message}`));
  }, [loaded]);

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const drop = (key: string, accept: string, fn: (f: File) => Promise<string>) => (
    <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-line p-4 text-sm text-muted hover:border-accent">
      <input type="file" accept={accept} className="hidden" data-testid={`upload-${key}`} onChange={(e) => e.target.files?.[0] && run(key, () => fn(e.target.files![0]))} />
      {busy === key ? "Reading…" : `Choose the file (${accept})`}
    </label>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="font-display text-4xl md:text-5xl">Import & connect</h1>
        <p className="text-sm text-muted">
          Bring in what you already watched, listened to and saved. Each service lets you download your own data; drop the
          file here and it&apos;s read in your browser (nothing is uploaded).
        </p>
      </header>
      {msg && <p className="card border-accent p-3 text-sm">{msg}</p>}

      <Card title="▶ YouTube: history, subscriptions, Watch later" done={imports.youtube?.summary}>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Open <a className="text-accent" href="https://takeout.google.com/" target="_blank" rel="noreferrer">takeout.google.com</a>, click <b>Deselect all</b>, tick only <b>YouTube and YouTube Music</b>.</li>
          <li>In “Multiple formats”, set <b>history</b> to <b>JSON</b>. Create the export; Google e-mails you a .zip (minutes to hours).</li>
          <li>Drop the zip here: watched videos, channels you watch most, subscriptions and Watch later come in.</li>
        </ol>
        <p className="text-xs text-muted/80">YouTube&apos;s API no longer gives access to watch history or Watch later, so Takeout is the complete route.</p>
        {drop("youtube", ".zip,.json,.html", async (f) => (await importYouTube(f)).summary)}
        {imports.youtube?.channels?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {imports.youtube.channels.slice(0, 24).map((c) => (
              <a key={c.name} href={c.url} target="_blank" rel="noreferrer" className="chip text-xs">{c.name}{c.count ? ` · ${c.count}` : ""}</a>
            ))}
          </div>
        ) : null}
      </Card>

      <Card title="🎧 Spotify: full listening history" done={imports.spotify?.summary}>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Go to <a className="text-accent" href="https://www.spotify.com/account/privacy/" target="_blank" rel="noreferrer">spotify.com/account/privacy</a> → <b>Download your data</b> → “Account data” (arrives in a few days by e-mail).</li>
          <li>Drop the zip here: artists you really play, saved tracks and playlists shape your music taste.</li>
        </ol>
        {drop("spotify", ".zip,.json", async (f) => (await importSpotify(f)).summary)}
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-sm text-muted">Or connect live (top artists, top tracks, playlists): create a free app at{" "}
            <a className="text-accent" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com</a>, add this Redirect URI{" "}
            <code className="break-all text-ink">{loaded ? redirectUri() : ""}</code>, then paste its Client ID.</p>
          <ClientId value={clientId} />
          <button className="btn mt-2 text-sm" disabled={!clientId} onClick={() => run("spotify-live", async () => { await startLogin(); return ""; })}>Connect Spotify</button>
          {spotify?.playlists?.length ? <p className="mt-2 text-xs text-muted">{spotify.playlists.length} playlists · top artists: {spotify.topArtists.slice(0, 8).map((a) => a.name).join(", ")}</p> : null}
        </div>
      </Card>

      <Card title="📌 Pinterest: your public boards" done={imports.pinterest?.summary}>
        <p className="text-sm text-muted">Paste your profile or a board link (public boards only). Pins land in the space you pick, as things to keep in mind; sync again any time to pull new pins.</p>
        <PinterestForm onRun={(url, space) => run("pinterest", async () => (await importPinterest(url, space)).summary)} busy={busy === "pinterest"} />
        {imports.pinterest?.channels?.length ? (
          <ul className="space-y-1 text-sm">
            {imports.pinterest.channels.map((b) => (
              <li key={b.url} className="flex items-center gap-2">
                <span className="flex-1 truncate">{b.name} <span className="text-xs text-muted">({b.count} pins)</span></span>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => run("pinterest", async () => (await importPinterest(b.url!, b.name.split(" → ")[1] ?? "brands")).summary)}>Sync</button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title="📦 Pack (.json): Instagram saves and other lists" done={Object.entries(imports).filter(([k]) => k.startsWith("pack:")).map(([, v]) => v.summary).join(" · ") || undefined}>
        <p className="text-sm text-muted">A list of things sorted by space (places, recipes, style, music…) plus notes for your second brain. Your sorted Instagram saves come as one.</p>
        {drop("pack", ".json", async (f) => (await importPack(f)).summary)}
      </Card>

      <Card title="🎬 Netflix: everything you watched" done={imports.netflix?.summary}>
        <p className="text-sm text-muted">
          Open <a className="text-accent" href="https://www.netflix.com/viewingactivity" target="_blank" rel="noreferrer">netflix.com/viewingactivity</a> (pick your profile), scroll down, <b>Download all</b>, and drop the CSV here.
        </p>
        {drop("netflix", ".csv", async (f) => (await importNetflix(f)).summary)}
      </Card>

      <Card title="📒 Letterboxd" done={undefined}>
        <p className="text-sm text-muted">Settings → Data → Export your data, then drop the ZIP.</p>
        {drop("letterboxd", ".zip", async (f) => {
          const r = await importLetterboxd(f);
          return `Letterboxd: ${r.matched}/${r.total} matched${r.unmatched.length ? ` (not found: ${r.unmatched.slice(0, 8).join(", ")})` : ""}`;
        })}
      </Card>

      <Card title="💾 Backup" done={undefined}>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost text-sm" onClick={backupJSON}>Download my memory (.json)</button>
          <label className="btn-ghost cursor-pointer text-sm">Restore a backup
            <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && run("restore", async () => { await restoreJSON(e.target.files![0]); return "Backup restored"; })} />
          </label>
        </div>
      </Card>
    </div>
  );
}

function Card({ title, done, children }: { title: string; done?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl">{title}</h2>
        {done && <span className="text-xs text-like">✓ imported</span>}
      </div>
      {done && <p className="text-xs text-muted">{done}</p>}
      {children}
    </section>
  );
}

function ClientId({ value }: { value?: string }) {
  const [v, setV] = useState("");
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSettings({ spotifyClientId: v.trim() || undefined }); setV(""); }}>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={value ?? "Spotify Client ID"} autoComplete="off"
             className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
      <button className="btn-ghost text-sm">Save</button>
    </form>
  );
}

function PinterestForm({ onRun, busy }: { onRun: (url: string, space: string) => void; busy: boolean }) {
  const [url, setUrl] = useState("");
  const [space, setSpace] = useState("brands");
  return (
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) onRun(url.trim(), space); }}>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://pinterest.com/you/your-board/"
             className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
      <select value={space} onChange={(e) => setSpace(e.target.value)} className="rounded-lg border border-line bg-panel px-2 py-2 text-sm">
        {DOMAINS.filter((d) => d.name !== "films").map((d) => <option key={d.name} value={d.name}>{d.emoji} {d.short}</option>)}
      </select>
      <button className="btn text-sm" disabled={busy}>{busy ? "Importing…" : "Import pins"}</button>
    </form>
  );
}
