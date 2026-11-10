"use client";
/**
 * Your memory. One JSON document in IndexedDB (no server), mirrored to a private GitHub Gist
 * when sync is on. `history` is append-only, so every model can be rebuilt from it; everything
 * else is derived state kept for speed.
 */
import { useRef, useSyncExternalStore } from "react";

export type Action =
  | "loved"
  | "liked"
  | "ok"
  | "disliked"
  | "watching"
  | "want"
  | "maybe"
  | "unknown"
  | "never";

export const SEEN_ACTIONS: Action[] = ["loved", "liked", "ok", "disliked", "watching"];

/** Taste label in [-1, 1] used by the models; null = no taste information ("no idea"). */
export const ACTION_VALUE: Record<Action, number | null> = {
  loved: 1,
  liked: 0.6,
  ok: 0,
  disliked: -1,
  watching: 0.5,
  want: 0.45,
  maybe: 0.15,
  unknown: null,
  never: -0.6,
};

export interface Feedback {
  key: string;
  domain: string;
  action: Action;
  at: number;
  chips?: string[];
  rating?: number; // optional half-star rating
  source?: string; // swipe | card | import | spotify ...
  predicted?: number; // what the model predicted when you answered (for calibration stats)
}

export interface ListEntry {
  key: string;
  domain: string;
  added: number;
  status: "want" | "watching" | "done";
  note?: string;
}

export interface VaultItem {
  id: string;
  url?: string;
  title: string;
  note?: string;
  tags: string[];
  domain?: string;
  image?: string;
  created: number;
}

export interface Settings {
  platforms: string[];
  lang: "fr" | "en";
  anthropicKey?: string;
  anthropicModel?: string;
  spotifyClientId?: string;
  gistToken?: string;
  gistId?: string;
  hideBlocked: boolean; // honour hard filters (romance / musicals / laugh-track sitcoms)
  blocked: string[]; // which hard filters are on
}

export interface Learned {
  /** Online logistic-regression weights per domain (feature order in engine/features.ts). */
  ranker: Record<string, { w: number[]; n: number }>;
  /** Thompson-sampling arms per domain: tag -> [alpha, beta]. */
  arms: Record<string, Record<string, [number, number]>>;
}

export interface State {
  v: 1;
  feedback: Record<string, Feedback>;
  history: Feedback[];
  lists: Record<string, ListEntry>;
  progress: Record<string, { season: number; episode: number; updated: number }>;
  vault: VaultItem[];
  learned: Learned;
  settings: Settings;
  spotify?: {
    connectedAt: number;
    topArtists: { name: string; genres: string[]; image?: string; url?: string }[];
    topTracks: { name: string; artist: string; url?: string }[];
    playlists: { name: string; url?: string; image?: string; tracks: number }[];
  };
  updatedAt: number;
}

export const DEFAULT_PLATFORMS = ["Netflix", "Prime Video", "Disney+", "HBO Max", "Canal+", "Apple TV+"];

export function emptyState(): State {
  return {
    v: 1,
    feedback: {},
    history: [],
    lists: {},
    progress: {},
    vault: [],
    learned: { ranker: {}, arms: {} },
    settings: {
      platforms: DEFAULT_PLATFORMS,
      lang: "fr",
      hideBlocked: true,
      blocked: ["romance", "musical", "laugh-track sitcom", "kids"],
    },
    updatedAt: 0,
  };
}

// ------------------------------------------------------------------ IndexedDB (tiny wrapper)
const DB = "cinegraph";
const STORE = "kv";

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => res(r.result as T | undefined);
    r.onerror = () => rej(r.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ------------------------------------------------------------------ store
let state: State = emptyState();
let loaded = false;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_HISTORY = 50_000;

export function migrate(s: Partial<State>): State {
  const base = emptyState();
  return {
    ...base,
    ...s,
    learned: { ...base.learned, ...(s.learned ?? {}) },
    settings: { ...base.settings, ...(s.settings ?? {}) },
  } as State;
}

export async function loadState(): Promise<State> {
  if (loaded) return state;
  try {
    const s = await idbGet<State>("state");
    if (s) state = migrate(s);
  } catch {
    // private mode / blocked storage: run in memory
  }
  loaded = true;
  emit();
  return state;
}

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    idbSet("state", state).catch(() => {});
    window.dispatchEvent(new CustomEvent("cinegraph:saved"));
  }, 300);
}

export function getState(): State {
  return state;
}

export function update(fn: (s: State) => void) {
  const next = structuredClone(state);
  fn(next);
  next.updatedAt = Date.now();
  state = next;
  emit();
  persist();
}

export function replaceState(s: State) {
  state = migrate(s);
  emit();
  persist();
}

const EMPTY = emptyState();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Select from the store; the selection is memoised per state version so selectors may build objects. */
export function useStore<T>(select: (s: State) => T): T {
  const memo = useRef<{ s: State | null; v: T | undefined; server?: T }>({ s: null, v: undefined });
  return useSyncExternalStore(
    subscribe,
    () => {
      if (memo.current.s !== state) memo.current = { ...memo.current, s: state, v: select(state) };
      return memo.current.v as T;
    },
    () => {
      if (!("server" in memo.current)) memo.current.server = select(EMPTY);
      return memo.current.server as T;
    },
  );
}

export function useLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => loaded, () => false);
}

// ------------------------------------------------------------------ mutations
export function recordFeedback(f: Omit<Feedback, "at"> & { at?: number }) {
  const fb: Feedback = { ...f, at: f.at ?? Date.now() };
  update((s) => {
    s.feedback[fb.key] = fb;
    s.history.push(fb);
    if (s.history.length > MAX_HISTORY) s.history.splice(0, s.history.length - MAX_HISTORY);
    // lists follow the answer
    if (fb.action === "want" || fb.action === "maybe") {
      s.lists[fb.key] ??= { key: fb.key, domain: fb.domain, added: fb.at, status: "want" };
    } else if (fb.action === "watching") {
      s.lists[fb.key] = { ...(s.lists[fb.key] ?? { key: fb.key, domain: fb.domain, added: fb.at }), status: "watching" };
    } else if (["loved", "liked", "ok", "disliked"].includes(fb.action)) {
      if (s.lists[fb.key]) s.lists[fb.key].status = "done";
    } else if (fb.action === "never") {
      delete s.lists[fb.key];
    }
  });
}

export function undoLast(): Feedback | null {
  const last = state.history.at(-1);
  if (!last) return null;
  update((s) => {
    s.history.pop();
    const prev = [...s.history].reverse().find((h) => h.key === last.key);
    if (prev) s.feedback[last.key] = prev;
    else delete s.feedback[last.key];
  });
  return last;
}

export function setList(key: string, domain: string, status: ListEntry["status"] | null) {
  update((s) => {
    if (status === null) delete s.lists[key];
    else s.lists[key] = { ...(s.lists[key] ?? { key, domain, added: Date.now() }), status };
  });
}

export function setSettings(patch: Partial<Settings>) {
  update((s) => {
    s.settings = { ...s.settings, ...patch };
  });
}

export function addVault(v: Omit<VaultItem, "id" | "created">) {
  update((s) => {
    s.vault.unshift({ ...v, id: crypto.randomUUID(), created: Date.now() });
  });
}

export function removeVault(id: string) {
  update((s) => {
    s.vault = s.vault.filter((v) => v.id !== id);
  });
}

export function setProgress(key: string, season: number, episode: number) {
  update((s) => {
    s.progress[key] = { season, episode, updated: Date.now() };
    s.lists[key] = { ...(s.lists[key] ?? { key, domain: "films", added: Date.now() }), status: "watching" };
  });
}

export function exportJSON(): string {
  return JSON.stringify(state, null, 1);
}
