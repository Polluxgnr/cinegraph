"""Knowledge graph in Postgres (kg_nodes / kg_edges) and explainable path scoring.

Nodes: title, person, keyword, genre, country, decade, award, work, location, series, subject.
Edges go from a title to an entity (directed_by, written_by, stars, has_keyword, won, ...)
or from a title to another title (based_on, influenced_by, follows).

Scoring a candidate C against the titles you rated (anchors A, weight w = (rating-3)/2):
  2-hop paths  C -rel-> entity <-rel- A,   contribution = w * rel_weight / log(2 + degree)
  1-hop paths  C -based_on/influenced_by/follows-> A (or reverse)
The strongest positive path becomes the explanation: "Same writer as X, which you rated 5".
"""
from __future__ import annotations

import logging
import math
from collections import defaultdict
from dataclasses import dataclass

from .. import db

log = logging.getLogger(__name__)

ROLE_REL = {"director": "directed_by", "writer": "written_by", "creator": "created_by", "cast": "stars",
            "composer": "scored_by", "dop": "shot_by", "producer": "produced_by"}
WD_REL = {"award": ("award", "won"), "nominated": ("award", "nominated_for"), "based_on": ("work", "based_on"),
          "influenced_by": ("work", "influenced_by"), "series": ("series", "part_of_series"),
          "follows": ("work", "follows"), "followed_by": ("work", "followed_by"),
          "narrative_location": ("location", "set_in"), "main_subject": ("subject", "about")}

REL_WEIGHT = {
    "directed_by": 1.0, "written_by": 0.9, "created_by": 1.0, "stars": 0.45, "scored_by": 0.35,
    "shot_by": 0.3, "produced_by": 0.15, "has_keyword": 0.35, "won": 0.25, "nominated_for": 0.12,
    "based_on": 1.0, "influenced_by": 0.8, "part_of_series": 1.2, "follows": 1.2, "followed_by": 1.2,
    "set_in": 0.25, "about": 0.4,
}
DIRECT_WEIGHT = {"based_on": 1.2, "influenced_by": 0.9, "follows": 1.3, "followed_by": 1.3}

BUILD_SQL = """
TRUNCATE kg_edges, kg_nodes RESTART IDENTITY;

INSERT INTO kg_nodes (type, key, label) SELECT 'title', id::text, title FROM titles;
INSERT INTO kg_nodes (type, key, label)
    SELECT 'person', p.id::text, p.name FROM people p WHERE EXISTS (SELECT 1 FROM credits c WHERE c.person_id = p.id);
INSERT INTO kg_nodes (type, key, label)
    SELECT DISTINCT 'keyword', lower(k), lower(k) FROM titles, unnest(keywords) k WHERE length(k) > 1
    ON CONFLICT DO NOTHING;
INSERT INTO kg_nodes (type, key, label)
    SELECT DISTINCT 'genre', g, g FROM titles, unnest(genres) g ON CONFLICT DO NOTHING;
INSERT INTO kg_nodes (type, key, label)
    SELECT DISTINCT 'country', c, c FROM titles, unnest(countries) c ON CONFLICT DO NOTHING;
INSERT INTO kg_nodes (type, key, label)
    SELECT DISTINCT 'decade', ((year / 10) * 10)::text, ((year / 10) * 10)::text || 's' FROM titles
    WHERE year IS NOT NULL ON CONFLICT DO NOTHING;

-- credits
INSERT INTO kg_edges (src, dst, rel, weight)
SELECT tn.id, pn.id,
       CASE c.role WHEN 'director' THEN 'directed_by' WHEN 'writer' THEN 'written_by' WHEN 'creator' THEN 'created_by'
                   WHEN 'cast' THEN 'stars' WHEN 'composer' THEN 'scored_by' WHEN 'dop' THEN 'shot_by'
                   ELSE 'produced_by' END,
       CASE WHEN c.role = 'cast' THEN greatest(0.3, 1.0 - c.ord * 0.08) ELSE 1 END
FROM credits c
JOIN kg_nodes tn ON tn.type = 'title' AND tn.key = c.title_id::text
JOIN kg_nodes pn ON pn.type = 'person' AND pn.key = c.person_id::text
WHERE c.role <> 'cast' OR c.ord < 10
ON CONFLICT DO NOTHING;

INSERT INTO kg_edges (src, dst, rel)
SELECT tn.id, kn.id, 'has_keyword' FROM titles t CROSS JOIN LATERAL unnest(t.keywords) AS k
JOIN kg_nodes kn ON kn.type = 'keyword' AND kn.key = lower(k)
JOIN kg_nodes tn ON tn.type = 'title' AND tn.key = t.id::text
ON CONFLICT DO NOTHING;

INSERT INTO kg_edges (src, dst, rel)
SELECT tn.id, gn.id, 'has_genre' FROM titles t CROSS JOIN LATERAL unnest(t.genres) AS g
JOIN kg_nodes gn ON gn.type = 'genre' AND gn.key = g
JOIN kg_nodes tn ON tn.type = 'title' AND tn.key = t.id::text
ON CONFLICT DO NOTHING;

INSERT INTO kg_edges (src, dst, rel)
SELECT tn.id, cn.id, 'from_country' FROM titles t CROSS JOIN LATERAL unnest(t.countries) AS c
JOIN kg_nodes cn ON cn.type = 'country' AND cn.key = c
JOIN kg_nodes tn ON tn.type = 'title' AND tn.key = t.id::text
ON CONFLICT DO NOTHING;

INSERT INTO kg_edges (src, dst, rel)
SELECT tn.id, dn.id, 'in_decade' FROM titles t
JOIN kg_nodes dn ON dn.type = 'decade' AND dn.key = ((t.year / 10) * 10)::text
JOIN kg_nodes tn ON tn.type = 'title' AND tn.key = t.id::text
ON CONFLICT DO NOTHING;
"""


def build() -> dict:
    with db.connect() as conn:
        conn.execute(BUILD_SQL)
        # Wikidata facts: object is another title when its QID is in the catalogue
        for prop, (ntype, rel) in WD_REL.items():
            conn.execute(
                """
                INSERT INTO kg_nodes (type, key, label)
                SELECT DISTINCT %s, f.object_qid, COALESCE(f.object_label, f.object_qid) FROM wikidata_facts f
                WHERE f.prop = %s AND NOT EXISTS (SELECT 1 FROM titles t2 WHERE t2.wikidata_id = f.object_qid)
                ON CONFLICT DO NOTHING
                """, (ntype, prop))
            conn.execute(
                """
                INSERT INTO kg_edges (src, dst, rel)
                SELECT tn.id, COALESCE(tt.id, en.id), %s
                FROM wikidata_facts f
                JOIN kg_nodes tn ON tn.type = 'title' AND tn.key = f.title_id::text
                LEFT JOIN titles t2 ON t2.wikidata_id = f.object_qid
                LEFT JOIN kg_nodes tt ON tt.type = 'title' AND tt.key = t2.id::text
                LEFT JOIN kg_nodes en ON en.type = %s AND en.key = f.object_qid
                WHERE f.prop = %s AND COALESCE(tt.id, en.id) IS NOT NULL AND COALESCE(tt.id, en.id) <> tn.id
                ON CONFLICT DO NOTHING
                """, (rel, ntype, prop))
        conn.execute("""UPDATE kg_nodes n SET degree = d.c
                        FROM (SELECT dst, count(*) c FROM kg_edges GROUP BY dst) d WHERE n.id = d.dst""")
        conn.execute("ANALYZE kg_nodes; ANALYZE kg_edges;")
        stats = conn.execute("SELECT (SELECT count(*) FROM kg_nodes) nodes, (SELECT count(*) FROM kg_edges) edges"
                             ).fetchone()
        conn.commit()
    log.info("knowledge graph: %s", stats)
    return dict(stats)


# ------------------------------------------------------------------ scoring
@dataclass
class Path:
    anchor_id: int
    anchor_title: str
    anchor_label: str      # "you rated it 5" / "you loved it"
    rel: str
    via: str | None        # entity label, None for direct title-title edges
    via_type: str | None
    contribution: float

    def explain(self) -> str:
        a = f"{self.anchor_title}, {self.anchor_label}"
        v = self.via
        return {
            "directed_by": f"Directed by {v}, like {a}",
            "written_by": f"Same writer ({v}) as {a}",
            "created_by": f"From {v}, who created {a}",
            "stars": f"With {v}, also in {a}",
            "scored_by": f"Music by {v}, as in {a}",
            "shot_by": f"Shot by {v}, like {a}",
            "produced_by": f"Produced by {v}, like {a}",
            "has_keyword": f"Shares '{v}' with {a}",
            "won": f"Won {v}, like {a}",
            "nominated_for": f"Up for {v}, like {a}",
            "based_on": f"Also based on {v}, like {a}" if v else f"Based on {a}",
            "influenced_by": f"Influenced by {v}, like {a}" if v else f"Influenced by {a}",
            "part_of_series": f"Same series ({v}) as {a}",
            "follows": f"Follow-up to {a}" if not v else f"Follows {v}, like {a}",
            "followed_by": f"Precedes {a}" if not v else f"Leads into {v}, like {a}",
            "set_in": f"Also set in {v}, like {a}",
            "about": f"Also about {v}, like {a}",
        }.get(self.rel, f"Connected to {a} via {v}")


def anchor_label(rating: float | None, signal: str) -> str:
    if signal == "love":
        return "which you loved"
    if signal == "like":
        return "which you liked"
    if signal == "dislike":
        return "which you disliked"
    if signal == "hidden":
        return "which you passed on"
    if signal == "heart":
        return "which you liked on Letterboxd"
    if signal == "watched":
        return "which you watched"
    if rating is not None:
        return f"which you rated {rating:g}"
    return "from your history"


def score_paths(candidate_ids: list[int], anchors: dict[int, dict], max_degree: int = 1500
                ) -> dict[int, dict]:
    """anchors: {title_id: {"w": float in [-1,1], "title": str, "label": str}}
    -> {candidate_id: {"score": float, "n_paths": int, "best": Path | None, "neg": float}}"""
    if not candidate_ids or not anchors:
        return {}
    a_ids = list(anchors)
    rows = db.fetchall(
        """
        WITH cn AS (SELECT id node, key::int tid FROM kg_nodes WHERE type = 'title' AND key = ANY(%(c)s)),
             an AS (SELECT id node, key::int tid FROM kg_nodes WHERE type = 'title' AND key = ANY(%(a)s))
        SELECT cn.tid cand, an.tid anchor, e1.rel rel, e2.rel rel_a, m.label, m.type, m.degree,
               e1.weight * e2.weight AS ew
        FROM cn
        JOIN kg_edges e1 ON e1.src = cn.node
        JOIN kg_nodes m ON m.id = e1.dst AND m.type NOT IN ('genre', 'decade', 'country', 'title')
                         AND m.degree <= %(maxdeg)s
        JOIN kg_edges e2 ON e2.dst = m.id
        JOIN an ON an.node = e2.src
        WHERE an.tid <> cn.tid
        UNION ALL
        SELECT cn.tid, an.tid, e.rel, e.rel, NULL, NULL, 1, 1.0
        FROM cn JOIN kg_edges e ON e.src = cn.node JOIN an ON an.node = e.dst
        UNION ALL
        SELECT cn.tid, an.tid, e.rel, e.rel, NULL, 'reverse', 1, 1.0
        FROM cn JOIN kg_edges e ON e.dst = cn.node JOIN an ON an.node = e.src
        WHERE e.rel IN ('based_on', 'influenced_by', 'follows', 'followed_by')
        """,
        {"c": [str(c) for c in candidate_ids], "a": [str(a) for a in a_ids], "maxdeg": max_degree},
    )
    out: dict[int, dict] = defaultdict(lambda: {"score": 0.0, "n_paths": 0, "best": None, "neg": 0.0})
    per_pair: dict[tuple[int, int], float] = defaultdict(float)
    for r in rows:
        a = anchors[r["anchor"]]
        if r["label"] is None:  # direct title-title edge
            rel = r["rel"]
            if r["type"] == "reverse":
                rel = {"follows": "followed_by", "followed_by": "follows"}.get(rel, rel)
            base = DIRECT_WEIGHT.get(rel, 0.5)
            via, vtype = None, None
        else:
            rel = r["rel"]
            base = REL_WEIGHT.get(rel, 0.2) * (1.0 if r["rel_a"] == rel else 0.4)
            base *= r["ew"] / math.log(2 + r["degree"])
            via, vtype = r["label"], r["type"]
        contrib = a["w"] * base
        key = (r["cand"], r["anchor"])
        # cap what one anchor can contribute so one long filmography doesn't dominate
        if abs(per_pair[key]) >= 1.5:
            continue
        per_pair[key] += contrib
        o = out[r["cand"]]
        o["score"] += contrib
        o["n_paths"] += 1
        if contrib < 0:
            o["neg"] += contrib
        if contrib > 0 and (o["best"] is None or contrib > o["best"].contribution):
            o["best"] = Path(r["anchor"], a["title"], a["label"], rel, via, vtype, contrib)
    return dict(out)


# ------------------------------------------------------------------ graph view
def ego_graph(title_id: int, max_entities: int = 25, titles_per_entity: int = 4) -> dict:
    """Subgraph around a title: its entities (not genres/decades) and other titles sharing them,
    preferring titles you rated."""
    center = db.fetchone("SELECT id FROM kg_nodes WHERE type = 'title' AND key = %s", (str(title_id),))
    if not center:
        return {"nodes": [], "links": []}
    ents = db.fetchall(
        """
        SELECT m.id, m.type, m.label, m.degree, e.rel FROM kg_edges e JOIN kg_nodes m ON m.id = e.dst
        WHERE e.src = %s AND m.type NOT IN ('genre', 'decade', 'country') AND m.degree > 1
        ORDER BY (m.type = 'keyword'), m.degree ASC LIMIT %s
        """, (center["id"], max_entities))
    nodes = {center["id"]: None}
    links = []
    for e in ents:
        nodes[e["id"]] = None
        links.append({"source": center["id"], "target": e["id"], "rel": e["rel"]})
        others = db.fetchall(
            """
            SELECT tn.id, e2.rel FROM kg_edges e2 JOIN kg_nodes tn ON tn.id = e2.src
            LEFT JOIN user_ratings r ON r.title_id = tn.key::int
            LEFT JOIN titles t ON t.id = tn.key::int
            WHERE e2.dst = %s AND tn.id <> %s AND tn.type = 'title'
            ORDER BY r.rating DESC NULLS LAST, t.popularity DESC NULLS LAST LIMIT %s
            """, (e["id"], center["id"], titles_per_entity))
        for o in others:
            nodes[o["id"]] = None
            links.append({"source": o["id"], "target": e["id"], "rel": o["rel"]})
    return {"nodes": _node_details(list(nodes)), "links": links, "center": center["id"]}


def taste_graph(n_titles: int = 30) -> dict:
    """Your best-rated titles and the entities that connect at least two of them."""
    top = db.fetchall(
        """
        SELECT n.id FROM kg_nodes n JOIN user_ratings r ON n.type = 'title' AND n.key = r.title_id::text
        ORDER BY r.rating DESC, r.rated_at DESC LIMIT %s
        """, (n_titles,))
    ids = [r["id"] for r in top]
    if not ids:
        return {"nodes": [], "links": []}
    shared = db.fetchall(
        """
        SELECT e.dst, array_agg(e.src) srcs, min(e.rel) rel FROM kg_edges e JOIN kg_nodes m ON m.id = e.dst
        WHERE e.src = ANY(%s) AND m.type NOT IN ('decade', 'country')
        GROUP BY e.dst HAVING count(*) >= 2 ORDER BY count(*) DESC LIMIT 80
        """, (ids,))
    nodes = set(ids)
    links = []
    for s in shared:
        nodes.add(s["dst"])
        for src in s["srcs"]:
            links.append({"source": src, "target": s["dst"], "rel": s["rel"]})
    return {"nodes": _node_details(list(nodes)), "links": links}


def _node_details(node_ids: list[int]) -> list[dict]:
    rows = db.fetchall(
        """
        SELECT n.id, n.type, n.label, n.key, t.poster_path, t.year, t.kind, r.rating
        FROM kg_nodes n
        LEFT JOIN titles t ON n.type = 'title' AND t.id = n.key::int
        LEFT JOIN user_ratings r ON n.type = 'title' AND r.title_id = n.key::int
        WHERE n.id = ANY(%s)
        """, (node_ids,))
    return [{"id": r["id"], "type": r["type"], "label": r["label"],
             "title_id": int(r["key"]) if r["type"] == "title" else None,
             "poster_path": r["poster_path"], "year": r["year"], "kind": r["kind"], "rating": r["rating"]}
            for r in rows]
