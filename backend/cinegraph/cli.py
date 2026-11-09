"""`cinegraph` command line. Run inside the api container:
    docker compose exec api cinegraph --help
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

import typer

app = typer.Typer(no_args_is_help=True, add_completion=False, help="CineGraph: personal film & series recommender")
ingest_app = typer.Typer(no_args_is_help=True, help="Catalogue ingestion (TMDB, Wikidata, MovieLens)")
build_app = typer.Typer(no_args_is_help=True, help="Build recommender artefacts")
app.add_typer(ingest_app, name="ingest")
app.add_typer(build_app, name="build")


@app.callback()
def _main(verbose: bool = typer.Option(False, "-v", "--verbose")) -> None:
    import sys

    for stream in (sys.stdout, sys.stderr):  # Windows consoles default to cp1252
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.DEBUG if verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)


def _echo(obj) -> None:
    typer.echo(json.dumps(obj, indent=2, default=str, ensure_ascii=False))


@app.command("init-db")
def init_db() -> None:
    """Create / migrate the schema (idempotent)."""
    from . import db

    db.init_schema()
    typer.echo("schema ready")


# ------------------------------------------------------------------ ingest
@ingest_app.command("tmdb")
def ingest_tmdb(
    top_movies: int = typer.Option(3000, help="top N movies by TMDB popularity"),
    top_tv: int = typer.Option(1500, help="top N series by TMDB popularity"),
    full: bool = typer.Option(False, "--full", help="crawl every id in the daily exports (~1.2M, days)"),
    limit: Optional[int] = typer.Option(None, help="stop after N detail fetches (resume later)"),
    skip_exports: bool = typer.Option(False, help="reuse already-staged export ids"),
) -> None:
    """Download TMDB daily ID exports, select targets, crawl details (resumable)."""
    from .ingest import tmdb_ingest
    from .ingest.tmdb_client import TMDBError
    from .config import get_settings

    if not get_settings().tmdb_api_key:
        raise typer.BadParameter("TMDB_API_KEY missing in .env (see README: 'Get a TMDB key').")
    if not skip_exports:
        _echo(tmdb_ingest.stage_exports())
    typer.echo(f"new targets: {tmdb_ingest.select_targets(top_movies, top_tv, full)}")
    try:
        _echo(tmdb_ingest.crawl(limit=limit))
    except TMDBError as e:
        raise typer.Exit(f"TMDB error: {e}")


@ingest_app.command("movielens")
def ingest_movielens(variant: Optional[str] = typer.Option(None, help="ml-latest-small | ml-32m")) -> None:
    """Import MovieLens links, stub titles, tags and ratings."""
    from .ingest.movielens import import_movielens

    _echo(import_movielens(variant))


@ingest_app.command("wikidata")
def ingest_wikidata(
    tv_bootstrap: int = typer.Option(0, help="also seed the N best-known TV series from Wikidata"),
    limit: Optional[int] = typer.Option(None, help="max titles to enrich this run"),
) -> None:
    """Resolve Wikidata ids and fetch awards / based on / influences / series / locations."""
    from .ingest import wikidata

    sp = wikidata.Sparql()
    if tv_bootstrap:
        typer.echo(f"tv series seeded: {wikidata.bootstrap_tv(tv_bootstrap, sp=sp)}")
        typer.echo(f"non-series removed: {wikidata.prune_non_series(sp=sp)}")
    typer.echo(f"ids resolved: {wikidata.resolve_qids(sp=sp)}")
    typer.echo(f"titles enriched: {wikidata.fetch_facts(limit=limit, sp=sp)}")


@ingest_app.command("links")
def ingest_links() -> None:
    """AlloCiné / SensCritique / Letterboxd / IMDb ids + Wikipedia images (titles without TMDB posters)."""
    from .ingest import links

    typer.echo(f"ids: {links.fetch_ids()}")
    typer.echo(f"wikipedia images: {links.fetch_wikipedia_images()}")


@ingest_app.command("quickstart")
def ingest_quickstart(tv: int = 1200) -> None:
    """No-key bootstrap: MovieLens small + Wikidata TV series + Wikidata facts.
    With TMDB_API_KEY set, also runs a 1500/800 TMDB crawl."""
    from .config import get_settings

    ingest_movielens(None)
    if get_settings().tmdb_api_key:
        ingest_tmdb(top_movies=1500, top_tv=800, full=False, limit=None, skip_exports=False)
    ingest_wikidata(tv_bootstrap=tv, limit=None)


# ------------------------------------------------------------------ build
@build_app.command("graph")
def build_graph() -> None:
    """(Re)build the knowledge graph."""
    from .recsys import graph

    _echo(graph.build())


@build_app.command("embeddings")
def build_embeddings(force: bool = False) -> None:
    """Embed new / changed titles into pgvector."""
    from .recsys import embeddings

    _echo(embeddings.build(force=force))


@build_app.command("cf")
def build_cf(iterations: int = 15) -> None:
    """Train implicit ALS on MovieLens + your ratings."""
    from .recsys import cf

    _echo(cf.train(iterations=iterations))


@build_app.command("clusters")
def build_clusters() -> None:
    """Cluster the embedding space (bandit arms)."""
    from .recsys import bandit

    _echo(bandit.build_clusters())


@build_app.command("all")
def build_all() -> None:
    """graph + embeddings + clusters + ALS + LTR."""
    from . import services

    _echo(services.retrain_all())


@app.command("train-ltr")
def train_ltr() -> None:
    """Train the learning-to-rank blend from your feedback."""
    from .recsys import ltr

    _echo(ltr.train())


# ------------------------------------------------------------------ letterboxd
@app.command("import-letterboxd")
def import_letterboxd(zip_path: Path, offline: bool = typer.Option(False, help="don't query TMDB for misses")) -> None:
    """Import the official Letterboxd export ZIP."""
    from .userdata.letterboxd_zip import import_zip
    from .userdata.matcher import resolve

    resolver = (lambda n, y: resolve(n, y, "movie", allow_remote=False)) if offline else None
    rep = import_zip(zip_path, resolver)
    _echo({"rows": rep.rows, "matched": rep.matched, "unmatched": rep.unmatched[:50],
           "unmatched_total": len(rep.unmatched)})


@app.command("sync-rss")
def sync_rss(username: Optional[str] = None) -> None:
    """Pull new diary entries from your public Letterboxd RSS feed."""
    from .userdata.letterboxd_rss import poll

    _echo(poll(username))


@app.command("export-letterboxd")
def export_letterboxd(out: Path = Path("letterboxd-export"),
                      include_letterboxd: bool = typer.Option(False, help="also re-export data that came from Letterboxd")
                      ) -> None:
    """Write Letterboxd-importer CSVs (upload them at letterboxd.com/import)."""
    from .userdata.letterboxd_export import export_all

    _echo(export_all(out, include_letterboxd))


@app.command("seed-watchlist")
def seed_watchlist(path: Optional[Path] = None, offline: bool = False) -> None:
    """Load docs/seed_watchlist.md into the watchlist (unmatched titles are retried next run)."""
    from .userdata.seed_watchlist import load

    _echo(load(path, allow_remote=not offline))


@app.command("export-static")
def export_static(
    out: Optional[Path] = typer.Option(None, help="default: web/public/data"),
    domain: Optional[list[str]] = typer.Option(None, help="only these domains (repeatable)"),
    skip_films: bool = False,
) -> None:
    """Write the static data the web app loads (films, embeddings, CF, every taste domain)."""
    from .export_static import export_all

    m = export_all(out, domain, skip_films)
    _echo({k: v for k, v in m.items() if k != "film_keys"})


# ------------------------------------------------------------------ inspect
@app.command("recommend")
def cli_recommend(n: int = 10, kind: str = "any", mood: Optional[str] = None) -> None:
    """Print recommendations with explanations."""
    from .recsys.pipeline import Constraints, recommend

    c = Constraints(kinds=None if kind == "any" else {kind}, mood=mood)
    res = recommend(n=n, constraints=c, log_impressions=False, balance_kinds=kind == "any")
    typer.echo(f"model={res['model']} profile={res['profile_size']} candidates={res['candidates']}")
    for it in res["items"]:
        typer.echo(f"{it['position'] + 1:>2}. [{it['kind']}] {it['title']} ({it['year']})  {it['score']:.3f}\n"
                   f"      {it['why']}")


@app.command("query")
def cli_query(q: str, n: int = 8) -> None:
    """Natural-language query, e.g. "like Fauda but funnier, under 2h, on Netflix"."""
    from .recsys.nlquery import query

    res = query(q, n)
    typer.echo(f"parser={res['parser']} reranked_by={res['reranked_by']} anchors={res['anchors']}")
    typer.echo(f"intent={json.dumps(res['intent'], ensure_ascii=False)}")
    for i, it in enumerate(res["items"], 1):
        typer.echo(f"{i:>2}. [{it['kind']}] {it['title']} ({it['year']}) {it.get('platforms')}\n      {it['why']}")


if __name__ == "__main__":
    app()
