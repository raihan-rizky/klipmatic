"""Healthcheck harian untuk extractor yt-dlp (spec §9.2).

Kerusakan extractor adalah risiko operasional nomor satu proyek ini. Skrip ini
memastikan operator mengetahuinya sebelum user melapor.

Pakai:
    uv run python -m scripts.canary

Kode keluar:
    0 — semua platform terpantau dan sehat
    1 — ada URL kanari yang gagal diprobe (kemungkinan extractor rusak)
    2 — ada platform tanpa URL kanari, jadi platform itu tidak terpantau
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from typing import Callable

from app.errors import JobError
from app.ytdlp import SourceMeta
from app.ytdlp import probe as _probe

# Satu URL kanari per platform yang didukung (spec §9.2). Semuanya dapat
# ditimpa lewat env: ketika sebuah URL kanari membusuk — video dihapus, akun
# ditutup — operator harus bisa menggantinya tanpa menunggu rilis aplikasi.
#
# Google Drive sengaja tidak punya default: tidak ada berkas Drive publik milik
# pihak ketiga yang cukup stabil untuk di-hardcode. Konsekuensinya ditanggung
# lewat kode keluar 2, bukan lewat diam — platform tanpa URL kanari adalah
# platform tanpa pemantauan, dan spec §9.2 mewajibkan ketiganya dipantau.
CANARY_URLS_DEFAULT: dict[str, str] = {
    "youtube": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "tiktok": "https://www.tiktok.com/@tiktok/video/7106594312292453675",
    "gdrive": "",
}

EXIT_OK = 0
EXIT_PROBE_GAGAL = 1
EXIT_TAK_TERPANTAU = 2


@dataclass(frozen=True)
class CanaryResult:
    url: str
    ok: bool
    error_code: str | None


def canary_urls() -> dict[str, str]:
    """Memetakan platform ke URL kanari, dengan env sebagai penimpa."""
    # `or default`, bukan nilai default os.environ.get: .env.example memuat
    # variabel-variabel ini dalam keadaan kosong, dan string kosong berarti
    # "belum diisi", bukan "matikan kanari ini".
    return {
        platform: os.environ.get(f"CANARY_{platform.upper()}_URL") or default
        for platform, default in CANARY_URLS_DEFAULT.items()
    }


def run_canary(
    urls: list[str], probe_fn: Callable[[str], SourceMeta] | None = None
) -> list[CanaryResult]:
    # Default diselesaikan saat pemanggilan, bukan saat definisi. Mengikat
    # _probe langsung di signature membuatnya tidak bisa diganti dari tes,
    # sehingga unit test ikut menembak jaringan sungguhan.
    probe = probe_fn or _probe
    results: list[CanaryResult] = []
    for url in urls:
        try:
            probe(url)
            results.append(CanaryResult(url, True, None))
        except JobError as e:
            results.append(CanaryResult(url, False, e.code))
        except Exception:  # noqa: BLE001 — kanari tidak boleh ikut mati
            results.append(CanaryResult(url, False, "INTERNAL"))
    return results


def main() -> int:
    configured = canary_urls()
    tak_terpantau = [platform for platform, url in configured.items() if not url]

    urls = [url for url in configured.values() if url]
    by_url = {url: platform for platform, url in configured.items() if url}

    results = run_canary(urls)
    for r in results:
        status = "OK   " if r.ok else "GAGAL"
        print(f"{status} {by_url[r.url]} {r.url} {r.error_code or ''}".rstrip())

    failed = [r for r in results if not r.ok]
    if failed:
        print(
            f"\n{len(failed)} dari {len(results)} URL kanari gagal. "
            f"Periksa apakah yt-dlp perlu diperbarui.",
            file=sys.stderr,
        )
        return EXIT_PROBE_GAGAL

    if tak_terpantau:
        # Didahulukan setelah kegagalan probe: extractor rusak lebih mendesak
        # daripada kanari yang belum dipasang. Tetapi run tetap merah, karena
        # nightly yang hijau dengan platform gelap adalah alarm yang berbohong.
        for platform in tak_terpantau:
            print(
                f"TAK TERPANTAU {platform}: isi CANARY_{platform.upper()}_URL "
                f"(repository variable pada nightly.yml, atau .env lokal) "
                f"dengan URL milik sendiri yang dibagikan publik",
                file=sys.stderr,
            )
        return EXIT_TAK_TERPANTAU

    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
