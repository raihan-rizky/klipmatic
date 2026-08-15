import tomllib
from pathlib import Path

COMPOSE_FILE = Path(__file__).resolve().parents[3] / "docker-compose.dev.yml"


def test_worker_uses_dedicated_virtualenv_volume_and_copy_link_mode():
    compose = COMPOSE_FILE.read_text()

    assert "UV_PROJECT_ENVIRONMENT: /venv" in compose
    assert "UV_LINK_MODE: copy" in compose
    assert "- worker-venv:/venv" in compose
    assert "  worker-venv:" in compose


def test_worker_accepts_a_dedicated_database_url_without_local_hardcoding():
    compose = COMPOSE_FILE.read_text()
    worker_config = compose.split("  worker:\n", 1)[1].split("\nvolumes:\n", 1)[0]

    assert "DATABASE_URL: ${WORKER_DATABASE_URL:-${DATABASE_URL}}" in worker_config
    assert "postgresql://postgres:postgres@postgres:5432/klipmatic" not in worker_config


def test_worker_disables_prepared_statements_for_transaction_pooling():
    worker_file = COMPOSE_FILE.parent / "apps" / "downloader" / "app" / "worker.py"

    assert "prepare_threshold=None" in worker_file.read_text()


def test_worker_builds_image_with_pinned_deno_and_ffmpeg():
    dockerfile = COMPOSE_FILE.parent / "apps" / "downloader" / "Dockerfile"
    compose = COMPOSE_FILE.read_text()

    assert "denoland/deno:bin-2.9.4" in dockerfile.read_text()
    assert "COPY --from=deno /deno /usr/local/bin/deno" in dockerfile.read_text()
    assert "apt-get install -y --no-install-recommends ffmpeg" in dockerfile.read_text()
    assert "deno --version" in dockerfile.read_text()
    assert "dockerfile: apps/downloader/Dockerfile" in compose
    assert "apt-get install -y -qq ffmpeg" not in compose


def test_worker_locks_default_ytdlp_ejs_dependencies():
    downloader = COMPOSE_FILE.parent / "apps" / "downloader"
    config = tomllib.loads((downloader / "pyproject.toml").read_text())
    lock = (downloader / "uv.lock").read_text()

    assert "yt-dlp[default]==2026.7.4" in config["project"]["dependencies"]
    assert 'name = "yt-dlp-ejs"' in lock
