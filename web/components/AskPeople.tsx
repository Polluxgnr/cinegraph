"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { useStore } from "@/lib/store";

/**
 * "What do people actually say?": asks Agora, your own multi-platform review reader (Reddit, YouTube comments,
 * Google Maps reviews, TikTok, Instagram, X, forums…), running on your PC. CineGraph is a static site, so the
 * reading happens there; this panel sends the question and shows the cited answer as it streams in.
 */
const DEFAULT_URL = "http://127.0.0.1:8765";

interface Source { id: number; platform: string; url: string; title?: string; author?: string; score?: number | null }
interface Answer {
  tldr?: string;
  answer_md?: string;
  consensus?: string[];
  warnings?: string[];
  disagreements?: { topic: string; sides: string[] }[];
  stats?: { found: number; read: number; seconds: number; model: string };
}

export default function AskPeople({ suggestions = [], title }: { suggestions?: string[]; title?: string }) {
  const T = useT();
  const base = useStore((s) => s.settings.agoraUrl) || DEFAULT_URL;
  const [up, setUp] = useState<boolean | null>(null);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"quick" | "standard" | "deep">("quick");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${base}/api/meta`, { signal: AbortSignal.timeout(2500) }).then((r) => live && setUp(r.ok)).catch(() => live && setUp(false));
    return () => {
      live = false;
    };
  }, [base]);

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    setErr(null);
    setLog([]);
    setSources([]);
    setAnswer(null);
    try {
      const r = await fetch(`${base}/api/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, mode }) });
      if (!r.ok || !r.body) throw new Error(`Agora ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "status") setLog((l) => [...l, ev.message]);
          else if (ev.type === "source") setLog((l) => [...l, `${ev.name}: ${ev.status}${ev.detail ? ` (${ev.detail})` : ""}`]);
          else if (ev.type === "reading") setLog((l) => [...l.filter((x) => !x.startsWith("📖")), `📖 ${ev.done}/${ev.total}`]);
          else if (ev.type === "sources") setSources(ev.items);
          else if (ev.type === "answer") setAnswer(ev.answer);
          else if (ev.type === "error") setErr(ev.message);
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // "[3]" -> a link to source 3
  const cite = (s: string): ReactNode[] =>
    s.split(/(\[\d+(?:,\s*\d+)*\])/g).map((part, i) => {
      const m = part.match(/^\[([\d,\s]+)\]$/);
      if (!m) return part;
      return m[1].split(/,\s*/).map((n) => {
        const src = sources.find((x) => x.id === Number(n));
        return src ? <a key={`${i}-${n}`} href={src.url} target="_blank" rel="noreferrer" className="mx-0.5 rounded bg-accent/15 px-1 text-[11px] text-accent" title={`${src.platform} · ${src.title ?? ""}`}>{n}</a> : `[${n}]`;
      });
    });

  return (
    <section className="card space-y-3 p-4" data-testid="ask-people">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl">{title ?? T("What do people actually say?")}</h2>
        <span className={`text-xs ${up ? "text-like" : "text-muted"}`}>{up == null ? "…" : up ? T("● Agora is running") : T("○ Agora is not running")}</span>
      </div>
      {up === false ? (
        <div className="space-y-1 text-sm text-muted">
          <p>{T("Agora reads Reddit, YouTube comments, Google Maps reviews, TikTok, Instagram and forums, and writes a cited answer. It runs on your PC: start it, then come back.")}</p>
          <code className="block whitespace-pre rounded-lg bg-panel-2 px-3 py-2 text-xs text-ink">{"cd cinegraph/agora\npip install -e .   # once\npython -m agora"}</code>
          <p className="text-xs">{T("Settings → Connections lets you change its address.")}</p>
        </div>
      ) : (
        <>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={T("Ask: is it worth it, best spots, sizing, what fans think…")}
                   className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" />
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="chip bg-transparent text-xs" aria-label={T("Depth")}>
              <option value="quick">{T("Quick")}</option><option value="standard">{T("Standard")}</option><option value="deep">{T("Deep")}</option>
            </select>
            <button className="btn px-3 py-1.5 text-sm" disabled={busy || !up}>{busy ? T("Reading…") : T("Ask")}</button>
          </form>
          {!busy && !answer && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{suggestions.map((s) => <button key={s} className="chip text-xs" onClick={() => { setQ(s); ask(s); }}>{s}</button>)}</div>
          )}
        </>
      )}
      {busy && <p className="text-xs text-muted">{log.slice(-3).join(" · ")}</p>}
      {err && <p className="text-sm text-nope">{err}</p>}
      {answer && (
        <div className="space-y-3 text-sm leading-relaxed">
          {answer.tldr && <p className="text-base">{cite(answer.tldr)}</p>}
          {!!answer.warnings?.length && <ul className="space-y-1 rounded-xl border border-nope/40 p-3">{answer.warnings.map((w, i) => <li key={i}>⚠ {cite(w)}</li>)}</ul>}
          {!!answer.consensus?.length && (
            <div><p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">{T("Most people agree")}</p><ul className="list-disc space-y-1 pl-5">{answer.consensus.map((c, i) => <li key={i}>{cite(c)}</li>)}</ul></div>
          )}
          {!!answer.disagreements?.length && (
            <div><p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">{T("Where they disagree")}</p>
              {answer.disagreements.map((d, i) => <p key={i}><b>{d.topic}:</b> {d.sides.map((s, k) => <span key={k}>{k ? " / " : ""}{cite(s)}</span>)}</p>)}</div>
          )}
          {answer.answer_md && <div className="space-y-2 whitespace-pre-line text-ink/85">{cite(answer.answer_md.replace(/^#+\s*/gm, "").replace(/\*\*/g, ""))}</div>}
          {answer.stats && <p className="text-[11px] text-muted">{T("{read} posts read with their comments, {found} found · {s} s · {model}", { read: answer.stats.read, found: answer.stats.found, s: answer.stats.seconds, model: answer.stats.model })}</p>}
        </div>
      )}
    </section>
  );
}
