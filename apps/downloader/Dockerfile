FROM denoland/deno:bin-2.9.4 AS deno

FROM ghcr.io/astral-sh/uv:python3.12-bookworm

COPY --from=deno /deno /usr/local/bin/deno

RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates libegl1 libgles2 \
    && rm -rf /var/lib/apt/lists/* \
    && deno --version \
    && ffmpeg -version >/dev/null

WORKDIR /work/apps/downloader

COPY apps/downloader/pyproject.toml apps/downloader/uv.lock ./
RUN uv sync --locked --no-dev

COPY apps/downloader/app ./app
RUN uv run python -c "from app.face_focus import _create_detector; _create_detector().close()"

CMD ["uv", "run", "python", "-m", "app.worker"]
