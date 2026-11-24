# agora

Ask anything. agora searches what real people say on Reddit, TikTok, Instagram, X, YouTube comments,
Google Maps reviews, Hacker News, your exported Discord chats and the open web. It reads the posts
**and the comments**, then gives you a cited answer: what most people agree on, where they disagree,
the official line against lived experience, warnings, and a map when the answer is a set of places.

Runs on your own PC, free. The model is swappable: local (Ollama, LM Studio) or hosted (Gemini, Groq,
OpenRouter free tiers, Claude).

## Setup

```bash
pip install -e .            # or: pip install -e ".[dev]" for tests
cp config.example.toml config.toml
```

**1. A model.** The free local route: install [Ollama](https://ollama.com), then

```bash
ollama pull qwen3:8b
```

Or set a free API key (`GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`) and set
`default_model` in `config.toml`. Bigger models give noticeably better answers; small local models
work but read less per question (`context_chars`).

**2. Reddit (optional, free).** Go to https://www.reddit.com/prefs/apps, create an app of type
*script*, and put its id and secret in `config.toml` under `[sources.reddit]`. Without it, tick
"Reddit (browser)" instead.

**3. Logged-in platforms (optional).** TikTok, Instagram, X and Reddit-in-browser are read through a
Chrome window signed in as you:

```bash
python -m agora login            # or: python -m agora login tiktok instagram
```

Sign in on the tabs that open, then close the window. Sessions are kept in `data/browser-profile`.
**Use secondary accounts.** These sites restrict accounts that read automatically, and Discord bans
personal accounts used this way, which is why Discord comes in through exports instead (below).

**4. Your own chats (optional).** Export Discord channels with DiscordChatExporter (JSON format), or
any JSON/TXT/Markdown/HTML, into `data/imports/`. They're searched locally.

## Use

```bash
python -m agora                  # opens the interface at http://127.0.0.1:8765
python -m agora ask "cliff diving spots near Marseille" --mode quick --sources youtube,web
python -m agora sources          # what's ready and what needs setup
```

In the interface: pick the model and depth at the top, tick sources on the left, set your profile
(top right) so answers fit you. **Ask** asks you refining questions first; **Search now** skips them.
Every `[n]` in an answer jumps to the source it came from.

Depth: **Quick** reads ~8 results, **Standard** ~20, **Deep** ~40, each with its comments. Tune in
`[search.modes]`.

## How it works

```
question ─► refining questions (model, uses your profile)
         ─► search plan: platform-specific queries, local-language queries, answer shape
         ─► all sources searched in parallel (browser sources one page at a time, at human pace)
         ─► ranked by relevance, engagement, freshness; spread across platforms
         ─► best results opened: full text + comments
         ─► model writes the cited answer; places geocoded onto a map (OpenStreetMap)
```

| File | What it does |
|---|---|
| `agora/pipeline.py` | The whole flow above |
| `agora/prompts.py` | Every instruction the model gets. Edit here to change its judgement |
| `agora/llm.py` | Model slot: OpenAI-compatible endpoints and Claude |
| `agora/rank.py` | Which results get read, without spending model calls |
| `agora/sources/*.py` | One file per platform, discovered automatically |
| `agora/sources/browser.py` | The general reader for logged-in sites |
| `agora/web/index.html` | The interface (single file, no build step) |

## Adding a platform

Drop a file in `agora/sources/`. For a site readable in the browser, ten lines are enough:

```python
from .browser import BrowserSource

class Pinterest(BrowserSource):
    name, label = "pinterest", "Pinterest"
    description = "Pins and comments (logged-in browser)"
    search_url = "https://www.pinterest.com/search/pins/?q={q}"
    link_pattern = r"^/pin/\d+$"
    login_url = "https://www.pinterest.com/login/"
```

The general reader takes the visible text of each post (comments included) and the model separates
post, comments and replies, so no per-site parsing is needed. For a site with an API, subclass
`Source` and implement `search()` and `enrich()` (see `hackernews.py`).

## Adding a model

Any OpenAI-compatible server is one block in `config.toml`. Another kind: subclass `LLM` in
`llm.py` and register it in `PROVIDERS`.

## Tests

```bash
pytest                 # offline logic tests
pytest -m live         # real internet, stand-in model (no API key needed)
python tests/fake_server.py   # the interface on :8766 with the stand-in model
```

## Limits worth knowing

- It finds what's posted publicly or in groups your accounts are in. Word-of-mouth stays word-of-mouth.
- Browser sources are slow by design (a few seconds per page). Deep mode on TikTok + Instagram takes minutes.
- Sites change. The open sources use stable APIs; the browser reader only depends on what a post link
  looks like, so a redesign usually needs a one-line `link_pattern` fix.
- Scraped text goes to whichever model you pick. Use a local model for anything you want to stay on your PC.
