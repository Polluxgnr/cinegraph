/**
 * Memory across devices: your state is mirrored to a *private* GitHub Gist with a token you
 * create (classic token, scope `gist` only). The token stays in this browser.
 * Every profile is a file in that Gist; each sync round merges both sides (nothing answered anywhere is lost).
 */
import { asset } from "./data";
import { getProfiles, getState, mergeProfiles, migrate, readProfileState, replaceState, saveProfileState, setSettings, type Settings, type State, SYNCED_SETTINGS } from "./store";

const PROFILES_FILE = "cinegraph-profiles.json";

const API = "https://api.github.com";

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
}

/** Device settings from `local`; the taste settings (follows, swipe filters) from whichever side changed them last. */
export function mergeSettings(local: Settings, remote?: Settings): Settings {
  if (!remote) return local;
  const remoteNewer = (remote.tasteAt ?? 0) > (local.tasteAt ?? 0);
  const out: Settings = { ...local };
  if (remoteNewer) {
    out.tasteAt = remote.tasteAt;
    for (const k of SYNCED_SETTINGS) (out as unknown as Record<string, unknown>)[k] = remote[k];
  }
  // follows merge per person, whichever device changed last: the later change wins for each name, so following
  // someone on the phone and someone else on the laptop keeps both (a removal keeps its date and wins if later)
  const la = local.followAt ?? {}, ra = remote.followAt ?? {};
  const following: Record<string, 1 | -1> = {};
  const followAt: Record<string, number> = {};
  const names = new Set([...Object.keys(la), ...Object.keys(ra), ...Object.keys(local.following ?? {}), ...Object.keys(remote.following ?? {})]);
  for (const n of names) {
    const lt = la[n], rt = ra[n];
    // dated changes win over undated ones; without dates, the side whose taste settings changed last
    const useRemote = rt != null && lt != null ? rt > lt : rt != null ? true : lt != null ? false : remoteNewer ? n in (remote.following ?? {}) : !(n in (local.following ?? {}));
    const v = (useRemote ? remote : local).following?.[n];
    if (v) following[n] = v;
    const at = Math.max(lt ?? 0, rt ?? 0);
    if (at) followAt[n] = at;
  }
  out.following = following;
  out.followAt = followAt;
  return out;
}

export function merge(a: State, b: State): State {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  // deletions from either side win over anything older than them
  const deleted: Record<string, number> = { ...(b.deleted ?? {}) };
  for (const [k, t] of Object.entries(a.deleted ?? {})) deleted[k] = Math.max(t, deleted[k] ?? 0);
  const gone = (k: string, at: number) => (deleted[k] ?? -1) >= at;
  const seen = new Set<string>();
  const history = [...a.history, ...b.history]
    .sort((x, y) => x.at - y.at)
    .filter((h) => {
      if (deleted[`hist:${h.key}|${h.at}`]) return false;
      const k = `${h.key}|${h.at}|${h.action}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const feedback = { ...b.feedback, ...a.feedback };
  for (const [k, f] of Object.entries(b.feedback)) if ((a.feedback[k]?.at ?? 0) < f.at) feedback[k] = f;
  for (const [k, f] of Object.entries(feedback)) if (deleted[`hist:${k}|${f.at}`]) delete feedback[k];
  const vaultIds = new Set<string>();
  const vault = [...a.vault, ...b.vault].filter((v) => !gone(`vault:${v.id}`, v.created) && !vaultIds.has(v.id) && vaultIds.add(v.id));
  const lists = Object.fromEntries(Object.entries({ ...b.lists, ...a.lists }).filter(([k, l]) => !gone(`list:${k}`, l.added)));
  const customIds = new Set<string>();
  const custom = [...a.custom, ...b.custom].filter((c) => !gone(`custom:${c.id}`, c.created) && !customIds.has(c.id) && customIds.add(c.id));
  const trips = new Map<string, State["trips"][number]>();
  for (const t of [...(a.trips ?? []), ...(b.trips ?? [])]) if (!gone(`trip:${t.id}`, t.updated) && (!trips.has(t.id) || trips.get(t.id)!.updated < t.updated)) trips.set(t.id, t);
  return migrate({ ...newer, history, feedback, vault, custom, deleted, trips: [...trips.values()], lists, settings: mergeSettings(a.settings, b.settings) });
}

const fileFor = (id: string) => (id === "default" ? "cinegraph-memory.json" : `cinegraph-memory-${id}.json`);
const strip = (s: State): State => ({ ...s, settings: { ...s.settings, gistToken: undefined, anthropicKey: undefined } });
/** Does `merged` carry anything `local` didn't have (so it's worth applying)? */
const gained = (local: State, merged: State) =>
  merged.history.length !== local.history.length || merged.vault.length !== local.vault.length ||
  JSON.stringify(merged.trips) !== JSON.stringify(local.trips) ||
  Object.keys(merged.lists).length !== Object.keys(local.lists).length || merged.custom.length !== local.custom.length ||
  Object.keys(merged.deleted ?? {}).length !== Object.keys(local.deleted ?? {}).length || merged.updatedAt > local.updatedAt ||
  (merged.settings.tasteAt ?? 0) > (local.settings.tasteAt ?? 0);

let running: Promise<{ id: string; changed: boolean }> | null = null;

/**
 * One sync round for every profile: read the Gist, merge each profile's remote copy with this device's
 * (answers from both sides survive, the most recent answer wins per item), apply what's new here, then
 * write every profile back. Rounds never overlap.
 */
export function syncNow(): Promise<{ id: string; changed: boolean }> {
  running ??= (async () => {
    try {
      const token = getState().settings.gistToken;
      if (!token) throw new Error("Add a GitHub token in Settings first");
      let gistId = getState().settings.gistId;
      if (!gistId) {
        const r = await fetch(`${API}/gists?per_page=100`, { headers: headers(token) });
        if (!r.ok) throw new Error(`GitHub: ${r.status}`);
        const found = (await r.json()).find((g: { files: Record<string, unknown> }) => PROFILES_FILE in g.files || "cinegraph-memory.json" in g.files);
        gistId = found?.id;
      }
      // 1. read
      let files: Record<string, { truncated?: boolean; raw_url: string; content: string }> = {};
      if (gistId) {
        const r = await fetch(`${API}/gists/${gistId}`, { headers: headers(token) });
        if (r.ok) files = (await r.json()).files ?? {};
        else if (r.status === 404) gistId = undefined;
        else throw new Error(`GitHub: ${r.status}`);
      }
      const read = async (name: string) => {
        const f = files[name];
        return !f ? null : f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
      };
      const remoteProfiles = await read(PROFILES_FILE);
      if (remoteProfiles) await mergeProfiles(JSON.parse(remoteProfiles));
      // 2. merge every profile
      let changed = false;
      const out: Record<string, { content: string }> = { [PROFILES_FILE]: { content: JSON.stringify(getProfiles()) } };
      for (const p of getProfiles().list) {
        const active = p.id === getProfiles().active;
        const local = active ? getState() : await readProfileState(p.id);
        const text = await read(fileFor(p.id));
        let merged = local;
        if (text) {
          merged = merge(local, migrate(JSON.parse(text)));
          // device settings stay with the device; follows and swipe filters travel
          merged.settings = mergeSettings(local.settings, migrate(JSON.parse(text)).settings);
          if (gained(local, merged)) {
            changed = true;
            if (active) replaceState(merged);
            else await saveProfileState(p.id, merged);
          }
        }
        if (merged.updatedAt || merged.history.length) out[fileFor(p.id)] = { content: JSON.stringify(strip(merged)) };
      }
      // 3. write back
      const body = JSON.stringify(gistId ? { files: out } : { description: "CineGraph memory (private)", public: false, files: out });
      const w = await fetch(gistId ? `${API}/gists/${gistId}` : `${API}/gists`, { method: gistId ? "PATCH" : "POST", headers: headers(token), body });
      if (!w.ok) throw new Error(`GitHub: ${w.status}`);
      const id = gistId ?? (await w.json()).id;
      if (getState().settings.gistId !== id) setSettings({ gistId: id });
      markSynced();
      return { id, changed };
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Kept for callers: push = a full sync round, returns the Gist id. */
export async function pushGist(): Promise<string> {
  return (await syncNow()).id;
}

/** Pull = a full sync round; true if this device received something new. */
export async function pullGist(): Promise<boolean> {
  if (!getState().settings.gistToken) return false;
  return (await syncNow()).changed;
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Debounced auto-push after changes (called from the app shell). */
export function scheduleSync() {
  if (!getState().settings.gistToken) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    pushGist().catch(() => {});
  }, 5000);
}

/**
 * A link that sets up sync on your other device in one tap (phone, iPad). The token travels in the URL
 * *fragment*, which browsers never send to a server; the app reads it once and removes it from the address bar.
 */
export function deviceLink(): string | null {
  const { gistToken, gistId } = getState().settings;
  if (!gistToken) return null;
  return `${window.location.origin}${asset("/settings/")}#sync=${btoa(JSON.stringify({ t: gistToken, g: gistId }))}`;
}

/** Called at start-up: if the address carries a device link, store its token and clean the address. */
export function acceptDeviceLink(): boolean {
  const m = window.location.hash.match(/sync=([^&]+)/);
  if (!m) return false;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  try {
    const { t, g } = JSON.parse(atob(decodeURIComponent(m[1])));
    if (typeof t !== "string") return false;
    setSettings({ gistToken: t, gistId: typeof g === "string" ? g : undefined });
    return true;
  } catch {
    return false;
  }
}

/** Push right away (e.g. when the tab is hidden), if a change is waiting. */
export function flushSync() {
  if (!timer || !getState().settings.gistToken) return;
  clearTimeout(timer);
  timer = null;
  pushGist().catch(() => {});
}

/** When this device last exchanged memory with the Gist (per device, for the status badge). */
export function markSynced() {
  try {
    localStorage.setItem("cinegraph:lastSync", String(Date.now()));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent("cinegraph:synced"));
}
export function lastSynced(): number {
  try {
    return Number(localStorage.getItem("cinegraph:lastSync") ?? 0);
  } catch {
    return 0;
  }
}
