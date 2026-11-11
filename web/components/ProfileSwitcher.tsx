"use client";

import { useState } from "react";
import { createProfile, deleteProfile, renameProfile, switchProfile, useProfiles } from "@/lib/store";

const EMOJIS = ["🙂", "😎", "🦊", "🐻", "🌙", "🌸", "🔥", "🎧", "🍜", "🧭"];

/** Who's using the app: each profile has its own taste, lists and history. */
export default function ProfileSwitcher({ compact = false }: { compact?: boolean }) {
  const p = useProfiles();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const me = p.list.find((x) => x.id === p.active) ?? p.list[0];
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className={`flex w-full items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-left text-sm hover:border-accent ${compact ? "" : "mb-4"}`}>
        <span className="text-lg">{me.emoji}</span>
        <span className="flex-1 truncate">{me.name}</span>
        <span className="text-xs text-muted">{p.list.length > 1 ? `${p.list.length} profiles` : "profile"} ▾</span>
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 space-y-1 rounded-xl border border-line bg-bg p-2 shadow-2xl">
          {p.list.map((x) => (
            <div key={x.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${x.id === p.active ? "bg-panel-2" : "hover:bg-panel"}`}>
              <button className="flex flex-1 items-center gap-2 text-left" onClick={() => { switchProfile(x.id); setOpen(false); }}>
                <span>{x.emoji}</span>
                <span className="truncate">{x.name}</span>
              </button>
              <button className="text-xs text-muted hover:text-ink" title="Rename" onClick={() => {
                const n = prompt("Profile name", x.name);
                if (n) renameProfile(x.id, n, EMOJIS[(EMOJIS.indexOf(x.emoji) + 1) % EMOJIS.length]);
              }}>✎</button>
              {x.id !== "default" && x.id !== p.active && (
                <button className="text-xs text-muted hover:text-nope" title="Delete profile" onClick={() => confirm(`Delete ${x.name}'s profile and memory?`) && deleteProfile(x.id)}>✕</button>
              )}
            </div>
          ))}
          <form className="flex gap-1 border-t border-line pt-2" onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            await createProfile(name.trim(), EMOJIS[p.list.length % EMOJIS.length]);
            setName("");
          }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New profile (e.g. Léa)"
                   className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 py-1 text-xs outline-none focus:border-accent" />
            <button className="btn-ghost px-2 py-1 text-xs">Add</button>
          </form>
        </div>
      )}
    </div>
  );
}
