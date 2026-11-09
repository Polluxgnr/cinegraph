/**
 * Memory across devices: your state is mirrored to a *private* GitHub Gist with a token you
 * create (classic token, scope `gist` only). The token stays in this browser.
 * Conflict rule: the newest `updatedAt` wins; histories are merged by timestamp.
 */
import { getState, migrate, replaceState, setSettings, type State } from "./store";

const FILE = "cinegraph-memory.json";
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
  const body = JSON.stringify({ files: { [FILE]: { content: JSON.stringify(safe) } } });
  if (s.settings.gistId) {
    const r = await fetch(`${API}/gists/${s.settings.gistId}`, { method: "PATCH", headers: headers(token), body });
    if (r.ok) return s.settings.gistId;
    if (r.status !== 404) throw new Error(`GitHub: ${r.status}`);
  }
  const r = await fetch(`${API}/gists`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ description: "CineGraph memory (private)", public: false, files: { [FILE]: { content: JSON.stringify(safe) } } }),
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
    const found = (await r.json()).find((g: { files: Record<string, unknown> }) => FILE in g.files);
    if (!found) return false;
    gistId = found.id as string;
  }
  const r = await fetch(`${API}/gists/${gistId}`, { headers: headers(token) });
  if (!r.ok) throw new Error(`GitHub: ${r.status}`);
  const g = await r.json();
  const file = g.files[FILE];
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
  timer = setTimeout(() => pushGist().catch(() => {}), 8000);
}
