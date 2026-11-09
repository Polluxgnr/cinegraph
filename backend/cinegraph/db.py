"""Postgres access (psycopg 3 + pgvector). Plain SQL, no ORM: bulk loads and graph
queries are easier to reason about this way."""
from __future__ import annotations

import json
from contextlib import contextmanager
from importlib import resources
from typing import Any, Iterator

import psycopg
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import get_settings

_pool: ConnectionPool | None = None


def _configure(conn: psycopg.Connection) -> None:
    try:
        register_vector(conn)
    except psycopg.ProgrammingError:
        # extension not created yet (first boot); init_schema registers afterwards
        pass
    # the type lookup opens a transaction; the pool rejects connections left INTRANS
    conn.commit()


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            get_settings().database_url,
            min_size=1,
            max_size=10,
            kwargs={"row_factory": dict_row, "autocommit": False},
            configure=_configure,
            open=True,
        )
    return _pool


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    with get_pool().connection() as conn:
        yield conn


def init_schema() -> None:
    sql = resources.files("cinegraph").joinpath("schema.sql").read_text(encoding="utf-8")
    with psycopg.connect(get_settings().database_url, autocommit=True) as conn:
        conn.execute(sql)
    # pool connections created before the extension existed lack the vector type
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def fetchall(sql: str, params: Any = None) -> list[dict]:
    with connect() as conn:
        return conn.execute(sql, params).fetchall()


def fetchone(sql: str, params: Any = None) -> dict | None:
    with connect() as conn:
        return conn.execute(sql, params).fetchone()


def execute(sql: str, params: Any = None) -> None:
    with connect() as conn:
        conn.execute(sql, params)
        conn.commit()


def get_setting(key: str, default: Any = None) -> Any:
    row = fetchone("SELECT value FROM app_settings WHERE key = %s", (key,))
    return row["value"] if row else default


def set_setting(key: str, value: Any) -> None:
    execute(
        "INSERT INTO app_settings (key, value) VALUES (%s, %s::jsonb) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (key, json.dumps(value)),
    )


def get_job_state(job: str) -> dict:
    row = fetchone("SELECT state FROM job_state WHERE job = %s", (job,))
    return row["state"] if row else {}


def set_job_state(job: str, state: dict) -> None:
    execute(
        "INSERT INTO job_state (job, state, updated_at) VALUES (%s, %s::jsonb, now()) "
        "ON CONFLICT (job) DO UPDATE SET state = EXCLUDED.state, updated_at = now()",
        (job, json.dumps(state)),
    )
