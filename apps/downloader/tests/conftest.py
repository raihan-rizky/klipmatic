import os
from pathlib import Path

import psycopg
import pytest

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://postgres:postgres@localhost:55432/klipmatic",
)
DB_PKG = Path(__file__).resolve().parents[3] / "packages" / "db"


@pytest.fixture
def conn():
    """Database bersih untuk setiap tes."""
    with psycopg.connect(TEST_DB_URL, autocommit=True) as c:
        c.execute("drop schema if exists public cascade; create schema public;")
        c.execute("drop schema if exists auth cascade;")
        c.execute((DB_PKG / "sql" / "000_auth_shim.sql").read_text())
        c.execute((DB_PKG / "migrations" / "0000_init.sql").read_text())
        c.execute((DB_PKG / "migrations" / "0001_media_assets.sql").read_text())
        c.execute((DB_PKG / "migrations" / "0002_candidate_previews.sql").read_text())
        c.execute((DB_PKG / "migrations" / "0003_candidate_preview_renders.sql").read_text())
    with psycopg.connect(TEST_DB_URL) as c:
        yield c


def new_conn():
    return psycopg.connect(TEST_DB_URL)
