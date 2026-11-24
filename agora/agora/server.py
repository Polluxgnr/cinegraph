"""Local web server: the interface plus a small JSON API. Listens on 127.0.0.1 only."""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

from .config import load_config, read_profile, reload_config, write_profile
from .llm import LLMError
from .models import SearchRequest
from .pipeline import clarify, run_search
from .sources import all_sources
from .sources.browser import BrowserManager

WEB = Path(__file__).parent / "web"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    await BrowserManager.close()


app = FastAPI(title="agora", lifespan=lifespan)

# CineGraph (your taste app on GitHub Pages) may ask questions from the browser; nothing else may.
# Chrome asks public pages for permission before they reach 127.0.0.1 ("local network access"), and the
# preflight must say private-network requests are welcome.
ALLOWED_ORIGINS = {"https://polluxgnr.github.io", "http://localhost:3000", "http://127.0.0.1:4321"}


@app.middleware("http")
async def cors(request, call_next):
    from fastapi.responses import Response

    origin = request.headers.get("origin")
    ok = origin in ALLOWED_ORIGINS
    if request.method == "OPTIONS" and ok:
        resp = Response(status_code=204)
    else:
        resp = await call_next(request)
    if ok:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        resp.headers["Access-Control-Allow-Private-Network"] = "true"
        resp.headers["Vary"] = "Origin"
    return resp


class ClarifyIn(BaseModel):
    question: str
    model: str | None = None


class SearchIn(BaseModel):
    question: str
    answers: dict[str, str] = {}
    sources: list[str] | None = None
    mode: str = "standard"
    model: str | None = None


class ProfileIn(BaseModel):
    text: str


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    cfg = reload_config()
    return {
        "models": [{"name": n, "provider": m.get("provider", "openai"), "model": m.get("model", "")}
                   for n, m in cfg["models"].items()],
        "default_model": cfg.get("default_model"),
        "modes": list(cfg["search"].get("modes", {}).keys()) or ["quick", "standard", "deep"],
        "sources": [s.info() for s in all_sources(refresh=True).values()],
        "profile": read_profile(),
    }


@app.post("/api/clarify")
async def api_clarify(body: ClarifyIn):
    try:
        return await clarify(body.question, body.model)
    except LLMError as e:
        return JSONResponse({"error": str(e)}, status_code=502)
    except Exception as e:
        return JSONResponse({"error": f"{type(e).__name__}: {e}"}, status_code=500)


@app.post("/api/search")
async def api_search(body: SearchIn):
    req = SearchRequest(**body.model_dump())

    async def stream():
        try:
            async for event in run_search(req):
                yield json.dumps(event, ensure_ascii=False, default=str) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": f"{type(e).__name__}: {e}"}) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.put("/api/profile")
def api_profile(body: ProfileIn):
    write_profile(body.text)
    return {"ok": True}


def serve(port: int = 8765, open_browser: bool = True) -> None:
    import threading
    import webbrowser

    import uvicorn

    load_config()
    if open_browser:
        threading.Timer(1.2, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
