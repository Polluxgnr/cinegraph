"use client";
/**
 * Your memory. One JSON document in IndexedDB (no server), mirrored to a private GitHub Gist
 * when sync is on. `history` is append-only, so every model can be rebuilt from it; everything
 * else is derived state kept for speed.
 */
import { useRef, useSyncExternalStore } from "react";

export type Action =
  | "fav"
  | "loved"
  | "liked"
  | "ok"
  | "disliked"
  | "dropped"
  | "watching"
  | "asap"
  | "want"
  | "maybe"
  | "unknown"
  | "later"
  | "never";

export const SEEN_ACTIONS: Action[] = ["fav", "loved", "liked", "ok", "disliked", "dropped", "watching"];
/** Answers that mean "I've seen / tried it all" (sagas, progress, lists marked done). */
export const DONE_ACTIONS: Action[] = ["fav", "loved", "liked", "ok", "disliked", "dropped"];
export const isDone = (a?: string) => !!a && (DONE_ACTIONS as string[]).includes(a);
/** "Not now" hides an item for this long, without saying anything about your taste. */
export const SNOOZE_MS = 30 * 24 * 3600 * 1000;

/** Taste label in [-1, 1] used by the models; null = no taste information ("no idea"). */
export const ACTION_VALUE: Record<Action, number | null> = {
  fav: 1,
  loved: 1,
  liked: 0.6,
  ok: 0,
  disliked: -1,
  dropped: -0.45,
  watching: 0.5,
  asap: 0.6,
  want: 0.45,
  maybe: 0.15,
  unknown: null,
  later: null,
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
  priority?: boolean; // "must watch soon": top of the list
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

/** Something you added yourself (a link, a track, a recipe blog...) or imported from your history. */
export interface CustomItem {
  id: string; // "<domain>:custom:<uuid>"
  domain: string;
  title: string;
  subtitle?: string;
  url?: string;
  image?: string;
  tags: string[];
  note?: string;
  meta?: Record<string, unknown>; // facts shown on the card (video length, likes, price...)
  created: number;
  source: string; // manual | youtube-takeout | spotify-export | netflix ...
}

export interface Settings {
  space: string; // the area the whole app is currently about (films, music, recipes...)
  platforms: string[];
  lang: "fr" | "en";
  anthropicKey?: string;
  anthropicModel?: string;
  spotifyClientId?: string;
  googleClientId?: string; // your Google OAuth client, for "Connect YouTube"
  /** gistToken + anthropicKey, AES-GCM encrypted at rest (see sealSecrets); plain values live in memory only */
  sealed?: string;
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

export interface TripSpot {
  q: string; // Wikidata id
  name: string;
  lat: number;
  lon: number;
  img?: string;
  group: string;
  day: number | null; // null = not planned yet
  done?: boolean;
}
export interface Trip {
  id: string;
  place: string; // places:<qid>
  title: string;
  image?: string;
  days: number;
  start?: string; // ISO date
  spots: TripSpot[];
  notes: Record<number, string>; // per day
  created: number;
  updated: number;
}

export interface State {
  v: 1;
  feedback: Record<string, Feedback>;
  history: Feedback[];
  lists: Record<string, ListEntry>;
  progress: Record<string, { season: number; episode: number; updated: number }>;
  vault: VaultItem[];
  custom: CustomItem[];
  /** what each import found, for the Import page (counts, followed channels, playlists...) */
  imports: Record<string, { at: number; summary: string; channels?: { name: string; url?: string; count: number }[] }>;
  learned: Learned;
  settings: Settings;
  /** trips you're planning: spots per day, like a travel journal */
  trips: Trip[];
  /** deletions, so they sync: "list:<key>" | "custom:<id>" | "trip:<id>" | "vault:<id>" | "hist:<key>|<at>" -> when */
  deleted: Record<string, number>;
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
    custom: [],
    trips: [],
    deleted: {},
    imports: {},
    settings: {
      space: "films",
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

async function idbDelete(key: string): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ------------------------------------------------------------------ secrets at rest
/**
 * Tokens are never written to disk in clear: before saving, gistToken and anthropicKey are encrypted with an
 * AES-GCM key the browser generates and can't export (a non-extractable CryptoKey kept in IndexedDB), and
 * decrypted into memory on load. A copied browser profile, a backup or a storage dump doesn't reveal them.
 */
const SECRET_KEYS = ["gistToken", "anthropicKey"] as const;
let cryptoKey: Promise<CryptoKey | null> | null = null;
function secretKey(): Promise<CryptoKey | null> {
  cryptoKey ??= (async () => {
    if (!globalThis.crypto?.subtle) return null;
    const existing = await idbGet<CryptoKey>("secret-key").catch(() => undefined);
    if (existing) return existing;
    const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await idbSet("secret-key", k).catch(() => {});
    return k;
  })().catch(() => null);
  return cryptoKey;
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

async function sealState(s: State): Promise<State> {
  const plain = Object.fromEntries(SECRET_KEYS.filter((k) => s.settings[k]).map((k) => [k, s.settings[k]]));
  const settings: Settings = { ...s.settings, gistToken: undefined, anthropicKey: undefined, sealed: undefined };
  const key = Object.keys(plain).length ? await secretKey() : null;
  if (!key) return { ...s, settings: Object.keys(plain).length ? s.settings : settings }; // no WebCrypto: keep as is
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(plain))));
  return { ...s, settings: { ...settings, sealed: `${b64(iv)}.${b64(ct)}` } };
}

async function unsealState(s: State): Promise<State> {
  const sealed = s.settings?.sealed;
  if (!sealed) return s;
  try {
    const key = await secretKey();
    if (!key) return s;
    const [iv, ct] = sealed.split(".").map(unb64);
    const plain = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct)));
    return { ...s, settings: { ...s.settings, ...plain, sealed: undefined } };
  } catch {
    return { ...s, settings: { ...s.settings, sealed: undefined } }; // key lost (storage cleared): tokens must be re-entered
  }
}

async function writeState(id: string, s: State) {
  await idbSet(stateKey(id), await sealState(s));
}
async function readState(id: string): Promise<State | undefined> {
  const s = await idbGet<State>(stateKey(id)).catch(() => undefined);
  return s ? unsealState(s) : undefined;
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

// ------------------------------------------------------------------ profiles
export interface ProfileInfo {
  id: string;
  name: string;
  emoji: string;
}
export interface Profiles {
  active: string;
  list: ProfileInfo[];
  /** deleted profile ids -> when (so a deletion reaches the other devices) */
  deleted?: Record<string, number>;
}
let profiles: Profiles = { active: "default", list: [{ id: "default", name: "Me", emoji: "🙂" }] };
const stateKey = (id: string) => (id === "default" ? "state" : `state:${id}`);
/** Settings that belong to the device, not the person: every profile on this device shares them. */
const DEVICE_KEYS = ["gistToken", "gistId", "anthropicKey", "anthropicModel", "spotifyClientId", "googleClientId"] as const;
function deviceSettings(from: Settings): Partial<Settings> {
  return Object.fromEntries(DEVICE_KEYS.filter((k) => from[k] != null).map((k) => [k, from[k]]));
}

export function getProfiles(): Profiles {
  return profiles;
}

/** Another profile's memory (read-only snapshot), e.g. for "pick together". */
export async function readProfileState(id: string): Promise<State> {
  if (id === profiles.active) return state;
  const s = await readState(id);
  return migrate(s ?? {});
}

/** Store a synced copy of a non-active profile as is (no timestamp bump, so it doesn't look like a new edit). */
export async function saveProfileState(id: string, s: State) {
  if (id === profiles.active) return;
  await writeState(id, s);
}

/** Write to another (non-active) profile's memory. */
export async function updateProfileState(id: string, fn: (s: State) => void) {
  if (id === profiles.active) return update(fn);
  const s = await readProfileState(id);
  fn(s);
  s.updatedAt = Date.now();
  await writeState(id, s);
}

async function saveProfiles() {
  await idbSet("profiles", profiles).catch(() => {});
}

export async function createProfile(name: string, emoji: string): Promise<string> {
  const id = crypto.randomUUID().slice(0, 8);
  profiles = { ...profiles, list: [...profiles.list, { id, name, emoji }] };
  await writeState(id, { ...emptyState(), settings: { ...emptyState().settings, space: state.settings.space, ...deviceSettings(state.settings) } });
  await saveProfiles();
  emit();
  return id;
}

export async function switchProfile(id: string) {
  if (id === profiles.active || !profiles.list.some((p) => p.id === id)) return;
  await writeState(profiles.active, state).catch(() => {});
  const next = await readState(id);
  profiles = { ...profiles, active: id };
  await saveProfiles();
  const device = deviceSettings(state.settings);
  state = migrate(next ?? {});
  state.settings = { ...state.settings, ...device };
  emit();
}

export async function renameProfile(id: string, name: string, emoji: string) {
  profiles = { ...profiles, list: profiles.list.map((p) => (p.id === id ? { ...p, name, emoji } : p)) };
  await saveProfiles();
  emit();
}

export async function deleteProfile(id: string) {
  if (id === "default" || id === profiles.active) return;
  profiles = { ...profiles, list: profiles.list.filter((p) => p.id !== id), deleted: { ...profiles.deleted, [id]: Date.now() } };
  await saveProfiles();
  await idbDelete(stateKey(id)).catch(() => {});
  emit();
}

/** Profiles created on another device (from sync) appear here too; nothing is ever removed this way. */
export async function mergeProfiles(remote: Profiles | undefined) {
  if (!remote?.list?.length) return;
  const deleted = { ...remote.deleted, ...profiles.deleted };
  for (const [id, t] of Object.entries(remote.deleted ?? {})) deleted[id] = Math.max(t, profiles.deleted?.[id] ?? 0);
  const known = new Set(profiles.list.map((p) => p.id));
  const extra = remote.list.filter((p) => !known.has(p.id) && !deleted[p.id]);
  const list = [...profiles.list, ...extra].filter((p) => p.id === "default" || p.id === profiles.active || !deleted[p.id]);
  if (list.length === profiles.list.length && !extra.length && JSON.stringify(deleted) === JSON.stringify(profiles.deleted ?? {})) return;
  profiles = { ...profiles, list, deleted };
  await saveProfiles();
  emit();
}

export function useProfiles(): Profiles {
  return useSyncExternalStore(subscribe, () => profiles, () => profiles);
}

let loading: Promise<State> | null = null;
/** Restore memory once; concurrent callers share the same load (a second load would clobber early edits). */
export function loadState(): Promise<State> {
  loading ??= (async () => {
    try {
      const p = await idbGet<Profiles>("profiles");
      if (p?.list?.length) profiles = p;
      const s = await readState(profiles.active);
      if (s) state = migrate(s);
    } catch {
      // private mode / blocked storage: run in memory
    }
    loaded = true;
    emit();
    // ask the browser not to evict our storage (Safari otherwise may after a week without visits)
    navigator.storage?.persist?.().catch(() => {});
    return state;
  })();
  return loading;
}

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeState(profiles.active, state).catch(() => {});
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
    if (fb.action === "asap") {
      s.lists[fb.key] = { ...(s.lists[fb.key] ?? { key: fb.key, domain: fb.domain, added: fb.at }), status: "want", priority: true };
    } else if (fb.action === "want" || fb.action === "maybe") {
      s.lists[fb.key] ??= { key: fb.key, domain: fb.domain, added: fb.at, status: "want" };
    } else if (fb.action === "watching") {
      s.lists[fb.key] = { ...(s.lists[fb.key] ?? { key: fb.key, domain: fb.domain, added: fb.at }), status: "watching" };
    } else if (isDone(fb.action)) {
      if (s.lists[fb.key]) s.lists[fb.key].status = "done";
    } else if (fb.action === "never") {
      if (s.lists[fb.key]) s.deleted[`list:${fb.key}`] = fb.at;
      delete s.lists[fb.key];
    }
  });
}

export function undoLast(): Feedback | null {
  const last = state.history.at(-1);
  if (!last) return null;
  update((s) => {
    s.history.pop();
    s.deleted[`hist:${last.key}|${last.at}`] = Date.now();
    const prev = [...s.history].reverse().find((h) => h.key === last.key);
    if (prev) s.feedback[last.key] = prev;
    else delete s.feedback[last.key];
  });
  return last;
}

export function setList(key: string, domain: string, status: ListEntry["status"] | null) {
  update((s) => {
    if (status === null) {
      delete s.lists[key];
      s.deleted[`list:${key}`] = Date.now();
    }
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
    s.deleted[`vault:${id}`] = Date.now();
  });
}

export function setProgress(key: string, season: number, episode: number) {
  update((s) => {
    s.progress[key] = { season, episode, updated: Date.now() };
    s.lists[key] = { ...(s.lists[key] ?? { key, domain: "films", added: Date.now() }), status: "watching" };
  });
}

export function addCustom(items: Omit<CustomItem, "id" | "created">[]): string[] {
  const ids: string[] = [];
  update((s) => {
    const known = new Set(s.custom.map((c) => `${c.domain}|${(c.url ?? c.title).toLowerCase()}`));
    for (const it of items) {
      const k = `${it.domain}|${(it.url ?? it.title).toLowerCase()}`;
      if (known.has(k)) {
        ids.push(s.custom.find((c) => `${c.domain}|${(c.url ?? c.title).toLowerCase()}` === k)!.id);
        continue;
      }
      known.add(k);
      const id = `${it.domain}:custom:${crypto.randomUUID().slice(0, 8)}`;
      s.custom.push({ ...it, id, created: Date.now() });
      ids.push(id);
    }
  });
  return ids;
}

export function removeCustom(id: string) {
  update((s) => {
    s.custom = s.custom.filter((c) => c.id !== id);
    delete s.feedback[id];
    delete s.lists[id];
    s.deleted[`custom:${id}`] = Date.now();
  });
}

export function setSpace(space: string) {
  if (state.settings.space !== space) setSettings({ space });
}

export function exportJSON(): string {
  return JSON.stringify(state, null, 1);
}

export { deleteTrip, toggleTripSpot, tripFor, updateTrip } from "./trips";
