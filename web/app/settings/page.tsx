"use client";

import { useEffect, useState } from "react";
import { DOMAINS } from "@/lib/domains";
import { relearn } from "@/lib/engine/learn";
import { useManifest } from "@/lib/hooks";
import { backupJSON, exportObsidian, importLetterboxd, restoreJSON } from "@/lib/io";
import { finishLogin, redirectUri, startLogin } from "@/lib/spotify";
import { DEFAULT_PLATFORMS, emptyState, replaceState, setSettings, useLoaded, useStore } from "@/lib/store";
import { pullGist, pushGist } from "@/lib/sync";

const ALL_PLATFORMS = [...DEFAULT_PLATFORMS, "arte.tv", "france.tv"];
const FILTERS: [string, string][] = [["romance", "No romance"], ["musical", "No musicals"], ["laugh-track sitcom", "No laugh-track sitcoms"], ["kids", "No kids' shows"]];

export default function Settings() {
  const s = useStore((x) => x.settings);
  const counts = useStore((x) => ({ answers: Object.keys(x.feedback).length, history: x.history.length, vault: x.vault.length, updated: x.updatedAt }));
  const loaded = useLoaded();
  const m = useManifest().data;
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Spotify redirects back here with ?code=
  useEffect(() => {
    if (!loaded) return;
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) return;
    window.history.replaceState(null, "", window.location.pathname);
    finishLogin(code).then(setMsg).catch((e) => setMsg(`Spotify: ${e.message}`));
  }, [loaded]);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(true);
    setMsg(`${label}…`);
    try {
      setMsg((await fn()) || `${label}: done`);
    } catch (e) {
      setMsg(`${label}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="font-display text-4xl md:text-5xl">Settings</h1>

      <Section title="My streaming services" hint="Used by Tonight and the ▶ links (France). Free broadcasters are always included.">
        <div className="flex flex-wrap gap-1.5">
          {ALL_PLATFORMS.map((p) => (
            <button key={p} className="chip" data-on={s.platforms.includes(p)}
                    onClick={() => setSettings({ platforms: s.platforms.includes(p) ? s.platforms.filter((x) => x !== p) : [...s.platforms, p] })}>{p}</button>
          ))}
        </div>
      </Section>

      <Section title="Hard filters" hint="Never recommended (your own lists are untouched).">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(([k, l]) => (
            <button key={k} className="chip" data-on={s.blocked.includes(k)}
                    onClick={() => setSettings({ blocked: s.blocked.includes(k) ? s.blocked.filter((x) => x !== k) : [...s.blocked, k] })}>{l}</button>
          ))}
        </div>
      </Section>

      <Section title="Memory & sync" hint={`${counts.answers} answers, ${counts.history} events, ${counts.vault} vault items, stored in this browser.`}>
        <p className="text-sm text-muted">
          To keep your memory across devices, create a GitHub token (classic, scope <code>gist</code> only) at{" "}
          <a className="text-accent" href="https://github.com/settings/tokens/new?scopes=gist&description=CineGraph%20memory" target="_blank" rel="noreferrer">github.com/settings/tokens</a>{" "}
          and paste it here. Your memory goes to a <b>private</b> Gist; the token never leaves this browser.
        </p>
        <Secret value={s.gistToken} placeholder="ghp_…" onSave={(v) => setSettings({ gistToken: v || undefined })} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost text-sm" disabled={!s.gistToken || busy} onClick={() => run("Push", async () => `Saved to Gist ${await pushGist()}`)}>Push now</button>
          <button className="btn-ghost text-sm" disabled={!s.gistToken || busy} onClick={() => run("Pull", async () => ((await pullGist()) ? "Merged from your Gist" : "No Gist found yet"))}>Pull now</button>
          <button className="btn-ghost text-sm" onClick={backupJSON}>Download backup (.json)</button>
          <label className="btn-ghost cursor-pointer text-sm">Restore backup
            <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && run("Restore", async () => { await restoreJSON(e.target.files![0]); })} />
          </label>
          <button className="btn-ghost text-sm" onClick={() => run("Obsidian export", async () => { await exportObsidian(); })}>Export to Obsidian</button>
        </div>
      </Section>

      <Section title="Import" hint="Letterboxd: Settings → Data → Export your data, then drop the ZIP here. Everything is matched in your browser.">
        <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-line p-5 text-sm text-muted hover:border-accent">
          <input type="file" accept=".zip" className="hidden" data-testid="lb-upload"
                 onChange={(e) => e.target.files?.[0] && run("Letterboxd import", async () => {
                   const r = await importLetterboxd(e.target.files![0]);
                   return `Letterboxd: ${r.matched}/${r.total} matched${r.unmatched.length ? ` (not found: ${r.unmatched.slice(0, 8).join(", ")}${r.unmatched.length > 8 ? "…" : ""})` : ""}`;
                 })} />
          Choose letterboxd-….zip
        </label>
      </Section>

      <Section title="Spotify" hint="Imports your top artists, tracks and playlists; top artists seed your music taste.">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Create an app at <a className="text-accent" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com/dashboard</a> (Web API).</li>
          <li>Add this Redirect URI: <code className="break-all text-ink">{loaded ? redirectUri() : ""}</code></li>
          <li>Paste the Client ID below and connect.</li>
        </ol>
        <Secret value={s.spotifyClientId} placeholder="Spotify Client ID" onSave={(v) => setSettings({ spotifyClientId: v || undefined })} reveal />
        <button className="btn text-sm" disabled={!s.spotifyClientId} onClick={() => run("Spotify", async () => { await startLogin(); })}>Connect Spotify</button>
      </Section>

      <Section title="AI (optional)" hint="Your Anthropic API key enables smarter search parsing and a written taste portrait. Stored only in this browser, never synced.">
        <Secret value={s.anthropicKey} placeholder="sk-ant-…" onSave={(v) => setSettings({ anthropicKey: v || undefined })} />
      </Section>

      <Section title="Models" hint={m ? `Catalogue built ${new Date(m.built_at).toLocaleString("fr-FR")} · embeddings ${m.embed_model}` : ""}>
        <div className="flex flex-wrap gap-2">
          {DOMAINS.filter((d) => (d.name === "films" || m?.domains[d.name]?.count)).map((d) => (
            <button key={d.name} className="btn-ghost text-sm" disabled={busy}
                    onClick={() => run(`Relearn ${d.short}`, async () => { const r = await relearn(d.name); return `${d.short}: ranker retrained on ${r.examples} answers`; })}>
              Relearn {d.short}
            </button>
          ))}
        </div>
        {m && (
          <ul className="grid grid-cols-2 gap-x-6 text-xs text-muted sm:grid-cols-3">
            {Object.entries(m.domains).map(([k, v]) => <li key={k}>{v.label}: {v.count.toLocaleString()}{v.images != null ? ` (${v.images.toLocaleString()} with images)` : ""}</li>)}
          </ul>
        )}
        <button className="text-xs text-nope" onClick={() => confirm("Erase all your answers, lists and vault in this browser?") && replaceState(emptyState())}>Reset everything</button>
      </Section>

      {msg && <p className="fixed bottom-24 left-1/2 z-40 max-w-[90vw] -translate-x-1/2 rounded-xl bg-panel-2 px-4 py-2 text-sm shadow-xl md:bottom-6">{msg}</p>}
      <p className="text-xs text-muted/70">
        Data: TMDB (this product uses the TMDB API but is not endorsed or certified by TMDB), Wikidata & Wikimedia Commons (CC0 / CC BY-SA),
        MovieLens (GroupLens), TheMealDB, Deezer API, YouTube RSS. Streaming availability: TMDB / JustWatch.
      </p>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3 p-5">
      <div>
        <h2 className="font-display text-2xl">{title}</h2>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Secret({ value, placeholder, onSave, reveal = false }: { value?: string; placeholder: string; onSave: (v: string) => void; reveal?: boolean }) {
  const [v, setV] = useState("");
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onSave(v.trim()); setV(""); }}>
      <input value={v} onChange={(e) => setV(e.target.value)} type={reveal ? "text" : "password"} autoComplete="off"
             placeholder={value ? (reveal ? value : "•••••••• saved") : placeholder}
             className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
      <button className="btn-ghost text-sm">{v ? "Save" : value ? "Clear" : "Save"}</button>
    </form>
  );
}
