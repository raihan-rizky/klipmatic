FROM denoland/deno:bin-2.9.4 AS deno

FROM ghcr.io/astral-sh/uv:python3.12-bookworm

COPY --from=deno /deno /usr/local/bin/deno

RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && deno --version \
    && ffmpeg -version >/dev/null

WORKDIR /work/apps/downloader

CMD ["uv", "run", "python", "-m", "app.worker"]
