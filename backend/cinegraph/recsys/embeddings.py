"""Content embeddings (overview + keywords + genres + credits) stored in pgvector.

EMBEDDER=fastembed  -> BAAI/bge-small-en-v1.5 via ONNX (384 d, downloaded once to data/models)
EMBEDDER=lsa        -> TF-IDF + truncated SVD (384 d), fully offline
"""
from __future__ import annotations

import hashlib
import logging
from functools import lru_cache

import numpy as np

from .. import db
from ..config import get_settings

log = logging.getLogger(__name__)
DIM = 384


def title_text(t: dict) -> str:
    kind = "TV series" if t["kind"] == "tv" else "Film"
    parts = [f"{t['title']} ({t.get('year') or 'n/a'}). {kind}."]
    if t.get("genres"):
        parts.append("Genres: " + ", ".join(t["genres"]) + ".")
    if t.get("keywords"):
        parts.append("Themes: " + ", ".join(t["keywords"][:25]) + ".")
    for role, label in (("director", "Directed by"), ("creator", "Created by"), ("writer", "Written by"),
                        ("cast", "Starring")):
        names = (t.get("people") or {}).get(role) or []
        if names:
            parts.append(f"{label} {', '.join(names[:5])}.")
    if t.get("countries"):
        parts.append("Country: " + ", ".join(t["countries"][:3]) + ".")
    if t.get("overview"):
        parts.append(t["overview"])
    return " ".join(parts)


class Embedder:
    name: str

    def embed(self, texts: list[str]) -> np.ndarray: ...

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed([text])[0]


class FastEmbedder(Embedder):
    def __init__(self, model: str):
        from fastembed import TextEmbedding

        self.name = f"fastembed:{model}"
        self.model = TextEmbedding(model_name=model, cache_dir=str(get_settings().models_dir / "fastembed"))

    def embed(self, texts: list[str]) -> np.ndarray:
        return np.asarray(list(self.model.embed(texts, batch_size=64)), dtype=np.float32)

    def embed_query(self, text: str) -> np.ndarray:
        return np.asarray(next(iter(self.model.query_embed(text))), dtype=np.float32)


class LsaEmbedder(Embedder):
    """Fit on the catalogue; persisted with joblib so queries use the same space."""

    name = "lsa:tfidf-svd384"

    def __init__(self):
        import joblib

        self.path = get_settings().models_dir / "lsa.joblib"
        self.pipe = joblib.load(self.path) if self.path.exists() else None

    def fit(self, texts: list[str]) -> None:
        import joblib
        from sklearn.decomposition import TruncatedSVD
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.pipeline import make_pipeline

        n = min(DIM, max(2, len(texts) - 1))
        self.pipe = make_pipeline(TfidfVectorizer(min_df=2, sublinear_tf=True, ngram_range=(1, 2),
                                                  max_features=200_000), TruncatedSVD(n, random_state=0))
        self.pipe.fit(texts)
        joblib.dump(self.pipe, self.path)

    def embed(self, texts: list[str]) -> np.ndarray:
        if self.pipe is None:
            raise RuntimeError("LSA embedder not fitted; run `cinegraph build embeddings`")
        x = self.pipe.transform(texts).astype(np.float32)
        if x.shape[1] < DIM:
            x = np.pad(x, ((0, 0), (0, DIM - x.shape[1])))
        return x / np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-9)


@lru_cache
def get_embedder() -> Embedder:
    s = get_settings()
    if s.embedder == "fastembed":
        try:
            return FastEmbedder(s.embed_model)
        except Exception as e:  # noqa: BLE001 - e.g. offline on first run
            log.warning("fastembed unavailable (%s); falling back to LSA", e)
    return LsaEmbedder()


def load_title_docs(where: str = "true", params=None) -> list[dict]:
    return db.fetchall(
        f"""
        SELECT t.id, t.kind, t.title, t.year, t.genres, t.keywords, t.countries, t.overview,
               (SELECT jsonb_object_agg(role, names) FROM (
                   SELECT c.role, array_agg(p.name ORDER BY c.ord) AS names
                   FROM credits c JOIN people p ON p.id = c.person_id WHERE c.title_id = t.id GROUP BY c.role) x
               ) AS people
        FROM titles t WHERE {where}
        """, params)


def build(force: bool = False, batch: int = 256) -> dict:
    emb = get_embedder()
    docs = load_title_docs()
    texts = {d["id"]: title_text(d) for d in docs}
    if isinstance(emb, LsaEmbedder):
        # the LSA space depends on the whole corpus: refit and re-embed everything
        emb.fit(list(texts.values()))
        force = True
    existing = {r["title_id"]: (r["model"], r["text_hash"])
                for r in db.fetchall("SELECT title_id, model, text_hash FROM title_embeddings")}
    todo = []
    for tid, text in texts.items():
        h = hashlib.sha1(text.encode()).hexdigest()
        if force or existing.get(tid) != (emb.name, h):
            todo.append((tid, text, h))
    log.info("embeddings: %d to (re)compute with %s", len(todo), emb.name)
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        vecs = emb.embed([t for _, t, _ in chunk])
        with db.connect() as conn:
            for (tid, _, h), v in zip(chunk, vecs):
                conn.execute(
                    "INSERT INTO title_embeddings (title_id, model, embedding, text_hash) VALUES (%s,%s,%s,%s) "
                    "ON CONFLICT (title_id) DO UPDATE SET model = EXCLUDED.model, embedding = EXCLUDED.embedding, "
                    "text_hash = EXCLUDED.text_hash", (tid, emb.name, v, h))
            conn.commit()
        if (i // batch) % 10 == 0:
            log.info("embeddings: %d/%d", min(i + batch, len(todo)), len(todo))
    return {"model": emb.name, "computed": len(todo), "total": len(texts)}


def load_matrix() -> tuple[np.ndarray, np.ndarray]:
    """All embeddings as (ids, unit-normalised matrix). Cached per process by callers."""
    rows = db.fetchall("SELECT title_id, embedding FROM title_embeddings ORDER BY title_id")
    if not rows:
        return np.zeros(0, dtype=np.int64), np.zeros((0, DIM), dtype=np.float32)
    ids = np.asarray([r["title_id"] for r in rows], dtype=np.int64)
    m = np.vstack([np.asarray(r["embedding"], dtype=np.float32) for r in rows])
    m /= np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)
    return ids, m
