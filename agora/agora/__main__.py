"""python -m agora serve | login | ask | sources"""
from __future__ import annotations

import argparse
import asyncio
import sys

from .models import SearchRequest


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="agora", description="Research anything from what real people say.")
    sub = ap.add_subparsers(dest="cmd")

    s = sub.add_parser("serve", help="start the interface (default)")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--no-browser", action="store_true")

    lg = sub.add_parser("login", help="sign in to TikTok, Instagram, X... in the scraping browser")
    lg.add_argument("sites", nargs="*", help="e.g. tiktok instagram (default: all)")

    a = sub.add_parser("ask", help="ask from the terminal")
    a.add_argument("question")
    a.add_argument("--model")
    a.add_argument("--mode", default="standard")
    a.add_argument("--sources", help="comma-separated, e.g. reddit,youtube,web")

    sub.add_parser("sources", help="list sources and whether they're ready")

    args = ap.parse_args()
    if args.cmd in (None, "serve"):
        from .server import serve
        serve(getattr(args, "port", 8765), not getattr(args, "no_browser", False))
    elif args.cmd == "login":
        from .sources.browser import login
        asyncio.run(login(args.sites or None))
    elif args.cmd == "sources":
        from .sources import all_sources
        for src in all_sources().values():
            ok, why = src.available()
            print(f"{'ready' if ok else 'needs setup':12} {src.name:16} {src.label:18} {why}")
    elif args.cmd == "ask":
        asyncio.run(_ask(args))


async def _ask(args) -> None:
    from .pipeline import run_search
    from .sources.browser import BrowserManager

    req = SearchRequest(question=args.question, mode=args.mode, model=args.model,
                        sources=args.sources.split(",") if args.sources else None)
    sources = []
    try:
        async for ev in run_search(req):
            t = ev["type"]
            if t == "status":
                print(f"… {ev['message']}")
            elif t == "source":
                print(f"  {ev['name']}: {ev['status']} {ev.get('count', '')} {ev.get('detail', '')}".rstrip())
            elif t == "sources":
                sources = ev["items"]
            elif t == "error":
                print(f"! {ev['message']}")
            elif t == "answer":
                ans = ev["answer"]
                print("\n" + (ans.get("tldr") or "") + "\n")
                for w in ans.get("warnings") or []:
                    print(f"⚠ {w}")
                print("\n" + (ans.get("answer_md") or ""))
                for p in ans.get("places") or []:
                    print(f"📍 {p.get('name')} ({p.get('area')}) {p.get('lat', '')},{p.get('lon', '')}: {p.get('summary')}")
                print("\nSources:")
                for s in sources:
                    print(f"  [{s['id']}] {s['platform']}: {s['title'][:80]} {s['url']}")
    finally:
        await BrowserManager.close()


if __name__ == "__main__":
    main()
