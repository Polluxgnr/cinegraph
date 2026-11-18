"use client";

import { useState } from "react";
import Connectors from "@/components/Connectors";
import PairDevice from "@/components/PairDevice";
import ProfileSwitcher from "@/components/ProfileSwitcher";
import { DOMAINS } from "@/lib/domains";
import { relearn } from "@/lib/engine/learn";
import { useManifest } from "@/lib/hooks";
import { asset } from "@/lib/data";
import { backupJSON, exportObsidian, restoreJSON } from "@/lib/io";
import { DEFAULT_PLATFORMS, emptyState, replaceState, setSettings, useStore } from "@/lib/store";
import { pullGist, pushGist } from "@/lib/sync";

const ALL_PLATFORMS = [...DEFAULT_PLATFORMS, "arte.tv", "france.tv"];
const FILTERS: [string, string][] = [["romance", "No romance"], ["musical", "No musicals"], ["laugh-track sitcom", "No laugh-track sitcoms"], ["kids", "No kids' shows"]];

export default function Settings() {
  const s = useStore((x) => x.settings);
  const counts = useStore((x) => ({ answers: Object.keys(x.feedback).length, history: x.history.length, vault: x.vault.length, updated: x.updatedAt }));
  const m = useManifest().data;
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <div className="max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-4xl md:text-5xl">Settings</h1>
        <div className="w-56"><ProfileSwitcher compact /></div>
      </header>
      <p className="-mt-3 text-sm text-muted">Settings, answers and lists belong to the profile above; every profile syncs.</p>
      <Connectors />

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

      <Section id="sync" title="Memory & sync" hint={`${counts.answers} answers, ${counts.history} events, ${counts.vault} vault items.`}>
        {s.gistToken ? (
          <p className="rounded-lg border border-like/40 bg-like/10 p-3 text-sm">✓ Sync is on. Every answer is saved to your private Gist a few seconds later and pulled on your other devices when you open the app.</p>
        ) : (
          <p className="rounded-lg border border-nope/40 bg-nope/10 p-3 text-sm">Your answers are saved <b>in this browser only</b>. Swipes on your iPad or phone stay there until you turn on sync (2 minutes, once).</p>
        )}
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Open <a className="text-accent" href="https://github.com/settings/tokens/new?scopes=gist&description=CineGraph%20memory" target="_blank" rel="noreferrer">this GitHub page</a> (scope <code>gist</code> is already ticked), set “No expiration”, click <b>Generate token</b> and copy it.</li>
          <li>Paste it below. All profiles on this device use it; each profile gets its own file in one <b>private</b> Gist.</li>
          <li>On your iPad or phone, open the link from <b>Link another device</b>: no second token needed.</li>
        </ol>
        <Secret value={s.gistToken} placeholder="ghp_…" onSave={(v) => {
          setSettings({ gistToken: v || undefined });
          if (v) run("First sync", async () => { await pullGist().catch(() => false); return `Synced to Gist ${await pushGist()}`; });
        }} />
        {s.gistToken && <PairDevice />}
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

      <Section title="Import & connect" hint="YouTube, Spotify, Netflix and Letterboxd history, and backups, now live on their own page.">
        <a href={asset("/import/")} className="btn-ghost text-sm">Open Import & connect →</a>
      </Section>

      <Section id="ai" title="AI (optional)" hint="Your Anthropic API key enables smarter search parsing and a written taste portrait. Stored only in this browser, never synced.">
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

function Section({ id, title, hint, children }: { id?: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-20 space-y-3 p-5">
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
