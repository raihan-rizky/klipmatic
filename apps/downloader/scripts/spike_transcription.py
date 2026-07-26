"""Mengukur penyedia transkripsi lalu merekam responsnya sebagai fixture.

Dijalankan manual satu kali per penyedia, bukan bagian dari CI. Skrip ini
sengaja berdiri sendiri dan membaca env secara langsung, supaya tetap bisa
dipakai sebagai alat diagnosa meski adapter sedang bermasalah.

Yang diperiksa: apakah penyedia mengembalikan word-level timestamp lewat
`timestamp_granularities: ["word"]`. Tanpa itu, caption karaoke (P2) dan
Editor C (P3) tidak mungkin dibangun.

Pakai:
    TRANSCRIBE_PROVIDERS=deepinfra,groq \
    TRANSCRIBE_DEEPINFRA_KEY=... TRANSCRIBE_GROQ_KEY=... \
      uv run python -m scripts.spike_transcription sample.opus

Hasilnya dicatat di docs/adr/0001-transcription-provider.md.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"

ORIGIN_RECORDED = (
    "Rekaman panggilan nyata, dihasilkan scripts/spike_transcription.py."
)


def providers() -> list[str]:
    raw = os.environ.get("TRANSCRIBE_PROVIDERS", "deepinfra,groq")
    return [p.strip() for p in raw.split(",") if p.strip()]


def cfg(name: str, field: str, default: str = "") -> str:
    return os.environ.get(f"TRANSCRIBE_{name.upper()}_{field}", default)


def probe(name: str, audio: Path) -> None:
    url = cfg(name, "URL")
    key = cfg(name, "KEY")
    model = cfg(name, "MODEL")
    if not (url and key and model):
        print(f"{name:<12} LEWAT — TRANSCRIBE_{name.upper()}_{{URL,KEY,MODEL}} belum lengkap")
        return

    with httpx.Client(timeout=600) as client:
        resp = client.post(
            url,
            headers={"Authorization": f"Bearer {key}"},
            files={"file": (audio.name, audio.read_bytes(), "audio/ogg")},
            data={
                "model": model,
                "response_format": "verbose_json",
                "timestamp_granularities[]": "word",
                "language": "id",
            },
        )

    print(f"{name:<12} HTTP {resp.status_code}")
    if resp.status_code != 200:
        # Badan respons dapat memantulkan header permintaan pada sebagian
        # gateway, jadi hanya potongan pendek yang ditampilkan.
        print(f"             {resp.text[:200]}")
        return

    body = resp.json()
    words = body.get("words") or []
    print(f"             bahasa terdeteksi : {body.get('language')}")
    print(f"             jumlah word       : {len(words)}")
    if words:
        first = words[0]
        has_fields = all(k in first for k in ("word", "start", "end"))
        print(f"             field per kata    : {'lengkap' if has_fields else 'TIDAK LENGKAP'}")
        print(f"             contoh            : {words[:3]}")
    else:
        print("             TIDAK ADA WORD TIMESTAMP — penyedia ini tidak memenuhi syarat")

    body["_fixture_origin"] = ORIGIN_RECORDED
    out = FIXTURES / f"{name}_ok.json"
    out.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"             fixture ditulis   : {out.name}")

    print("\n             --- periksa manual kualitas Bahasa Indonesianya ---")
    print(f"             {body.get('text', '')[:300]}")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    audio = Path(sys.argv[1])
    if not audio.exists():
        print(f"berkas audio tidak ditemukan: {audio}")
        return 2

    FIXTURES.mkdir(parents=True, exist_ok=True)
    for name in providers():
        probe(name, audio)
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
