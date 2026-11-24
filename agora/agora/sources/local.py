"""Your own exported chats and notes, searched locally.

Drop files in data/imports/:
- Discord exports in DiscordChatExporter's JSON format (any server or DM you can see)
- Any JSON list of messages with "content"/"text" fields (Telegram, Slack exports...)
- .txt / .md / .html files

Searching them never touches the network, so this is also where private material goes.
"""
from __future__ import annotations

import json
from pathlib import Path

from ..config import ROOT
from ..models import Document
from ..rank import terms
from .base import Source, clip, html_to_text

WINDOW = 25  # messages per chunk: enough to keep a conversation readable


class LocalImports(Source):
    name = "local"
    label = "My imports"
    group = "local"
    description = "Exported Discord/Telegram chats and notes in data/imports"

    _cache: dict[str, tuple[float, list[Document]]] = {}

    def folder(self) -> Path:
        return ROOT / self.cfg.get("folder", "data/imports")

    def files(self) -> list[Path]:
        f = self.folder()
        if not f.exists():
            return []
        return [p for p in f.rglob("*") if p.suffix.lower() in {".json", ".txt", ".md", ".html", ".htm"}]

    def available(self):
        if not self.files():
            return False, f"Put exports in {self.cfg.get('folder', 'data/imports')}"
        return True, ""

    async def search(self, query, limit):
        q = terms(query)
        scored = []
        for path in self.files():
            for chunk in self._chunks(path):
                body = (chunk.title + " " + chunk.text).lower()
                hits = sum(body.count(t) for t in q)
                distinct = sum(1 for t in q if t in body)
                if distinct:
                    scored.append((distinct * 10 + min(hits, 30), chunk))
        scored.sort(key=lambda x: -x[0])
        return [c for _, c in scored[:limit]]

    def _chunks(self, path: Path) -> list[Document]:
        key, mtime = str(path), path.stat().st_mtime
        if key in self._cache and self._cache[key][0] == mtime:
            return self._cache[key][1]
        try:
            chunks = self._parse(path)
        except Exception:
            chunks = []
        self._cache[key] = (mtime, chunks)
        return chunks

    def _parse(self, path: Path) -> list[Document]:
        raw = path.read_text(encoding="utf-8", errors="replace")
        if path.suffix.lower() == ".json":
            data = json.loads(raw)
            if isinstance(data, dict) and "messages" in data:  # DiscordChatExporter
                where = " / ".join(filter(None, [data.get("guild", {}).get("name"),
                                                 "#" + data.get("channel", {}).get("name", "")]))
                msgs = [(m.get("timestamp", "")[:10], (m.get("author") or {}).get("name", ""), m.get("content", ""),
                         sum(r.get("count", 0) for r in m.get("reactions") or []))
                        for m in data["messages"] if m.get("content")]
            elif isinstance(data, list):
                where = path.stem
                msgs = [(str(m.get("date") or m.get("timestamp") or "")[:10], str(m.get("author") or m.get("from") or ""),
                         str(m.get("content") or m.get("text") or ""), 0)
                        for m in data if isinstance(m, dict) and (m.get("content") or m.get("text"))]
            else:
                return []
            out = []
            for i in range(0, len(msgs), WINDOW):
                win = msgs[i:i + WINDOW]
                out.append(Document(
                    platform="local", kind="chat", url=f"{path.as_uri()}#msg{i}",
                    title=f"{where} ({win[0][0]})", date=win[-1][0] or None,
                    text=clip("\n".join(f"{a}: {c}" for _, a, c, _ in win), 6000),
                    score=sum(r for *_, r in win) or None, meta={"file": path.name}))
            return out
        text = html_to_text(raw) if path.suffix.lower() in {".html", ".htm"} else raw
        paras = [p for p in text.split("\n\n") if p.strip()]
        out, buf = [], ""
        for p in paras:
            buf += p + "\n\n"
            if len(buf) > 3000:
                out.append(buf)
                buf = ""
        if buf:
            out.append(buf)
        return [Document(platform="local", kind="page", url=f"{path.as_uri()}#part{i}", title=f"{path.stem} ({i + 1})",
                         text=clip(t, 6000), meta={"file": path.name}) for i, t in enumerate(out)]
