/**
 * Memory across devices: your state is mirrored to a *private* GitHub Gist with a token you
 * create (classic token, scope `gist` only). The token stays in this browser.
 * Conflict rule: the newest `updatedAt` wins; histories are merged by timestamp.
 */
import { asset } from "./data";
import { getProfiles, getState, mergeProfiles, migrate, replaceState, setSettings, type State } from "./store";

const PROFILES_FILE = "cinegraph-profiles.json";

/** One Gist file per profile, so each profile syncs its own memory. */
const fileName = () => {
  const p = getProfiles();
  return p.active === "default" ? "cinegraph-memory.json" : `cinegraph-memory-${p.active}.json`;
};
const API = "https://api.github.com";

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
}

export function merge(a: State, b: State): State {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const seen = new Set<string>();
  const history = [...a.history, ...b.history]
    .sort((x, y) => x.at - y.at)
    .filter((h) => {
      const k = `${h.key}|${h.at}|${h.action}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const feedback = { ...b.feedback, ...a.feedback };
  for (const [k, f] of Object.entries(b.feedback)) if ((a.feedback[k]?.at ?? 0) < f.at) feedback[k] = f;
  const vaultIds = new Set<string>();
  const vault = [...a.vault, ...b.vault].filter((v) => !vaultIds.has(v.id) && vaultIds.add(v.id));
  return migrate({ ...newer, history, feedback, vault, lists: { ...b.lists, ...a.lists }, settings: a.settings });
}

export async function pushGist(): Promise<string> {
  const s = getState();
  const token = s.settings.gistToken;
  if (!token) throw new Error("Add a GitHub token in Settings first");
  // never upload secrets
  const safe: State = { ...s, settings: { ...s.settings, gistToken: undefined, anthropicKey: undefined } };
  const files = { [fileName()]: { content: JSON.stringify(safe) }, [PROFILES_FILE]: { content: JSON.stringify(getProfiles()) } };
  const body = JSON.stringify({ files });
  if (s.settings.gistId) {
    const r = await fetch(`${API}/gists/${s.settings.gistId}`, { method: "PATCH", headers: headers(token), body });
    if (r.ok) return s.settings.gistId;
    if (r.status !== 404) throw new Error(`GitHub: ${r.status}`);
  }
  const r = await fetch(`${API}/gists`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ description: "CineGraph memory (private)", public: false, files }),
  });
  if (!r.ok) throw new Error(`GitHub: ${r.status}`);
  const g = await r.json();
  setSettings({ gistId: g.id });
  return g.id;
}

export async function pullGist(): Promise<boolean> {
  const s = getState();
  const { gistToken: token } = s.settings;
  let { gistId } = s.settings;
  if (!token) return false;
  if (!gistId) {
    const r = await fetch(`${API}/gists?per_page=100`, { headers: headers(token) });
    if (!r.ok) throw new Error(`GitHub: ${r.status}`);
    const found = (await r.json()).find((g: { files: Record<string, unknown> }) => fileName() in g.files || PROFILES_FILE in g.files);
    if (!found) return false;
    gistId = found.id as string;
  }
  const r = await fetch(`${API}/gists/${gistId}`, { headers: headers(token) });
  if (!r.ok) throw new Error(`GitHub: ${r.status}`);
  const g = await r.json();
  const read = async (f: { truncated?: boolean; raw_url: string; content: string } | undefined) =>
    !f ? null : f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  const profilesText = await read(g.files[PROFILES_FILE]);
  if (profilesText) await mergeProfiles(JSON.parse(profilesText));
  const file = g.files[fileName()];
  if (!file) {
    setSettings({ gistId }); // this profile has no copy yet: the next push creates it
    return false;
  }
  const content = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
  const remote = migrate(JSON.parse(content));
  const merged = merge(getState(), remote);
  merged.settings = { ...getState().settings, gistId };
  replaceState(merged);
  return true;
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
