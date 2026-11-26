"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { setNote, useStore } from "@/lib/store";

/** Your own comment on anything: what you thought, who recommended it, where to eat it... Synced with the rest. */
export default function NoteBox({ k, domain }: { k: string; domain: string }) {
  const T = useT();
  const note = useStore((s) => s.notes?.[k]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note?.text ?? "");
  if (!editing) {
    return note ? (
      <div className="border-t border-line pt-3 text-sm" data-testid="note">
        <p className="mb-1 flex items-center justify-between text-xs text-muted">
          <span>{T("My comment")} · {new Date(note.at).toLocaleDateString(T.lang)}</span>
          <button className="hover:text-ink" onClick={() => { setText(note.text); setEditing(true); }}>{T("Edit")}</button>
        </p>
        <p className="whitespace-pre-wrap text-ink/90">{note.text}</p>
      </div>
    ) : (
      <button className="w-full border-t border-line pt-3 text-left text-xs text-muted hover:text-ink" onClick={() => { setText(""); setEditing(true); }} data-testid="note-add">
        ✎ {T("Add a comment (what you thought, who told you about it…)")}
      </button>
    );
  }
  return (
    <form className="space-y-2 border-t border-line pt-3" onSubmit={(ev) => { ev.preventDefault(); setNote(k, domain, text); setEditing(false); }}>
      <textarea value={text} onChange={(ev) => setText(ev.target.value)} rows={3} autoFocus maxLength={4000} aria-label={T("My comment")}
                className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent" />
      <div className="flex justify-end gap-2 text-xs">
        {note && <button type="button" className="px-2 text-muted hover:text-nope" onClick={() => { setNote(k, domain, ""); setEditing(false); }}>{T("Delete")}</button>}
        <button type="button" className="btn-ghost px-3 py-1" onClick={() => setEditing(false)}>{T("Cancel")}</button>
        <button className="btn px-3 py-1">{T("Save")}</button>
      </div>
    </form>
  );
}
