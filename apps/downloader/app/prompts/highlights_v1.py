from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import dataclass

from app.errors import JobError
from app.providers.transcription import Word

log = logging.getLogger(__name__)

PROMPT_VERSION = "highlights_v1"

MIN_CLIP_SEC = 30
MAX_CLIP_SEC = 90

# Nama kunci amplop yang pernah ditemui selain "candidates".
_ENVELOPE_KEYS = ("candidates", "clips", "segments", "highlights", "hasil")

# Kunci penanda bahwa sebuah objek adalah kandidat, bukan amplop.
_CANDIDATE_KEYS = ("start_sec", "end_sec")


@dataclass(frozen=True)
class Candidate:
    start_sec: float
    end_sec: float
    score: float
    title: str
    hook_text: str
    reason: str | None = None


def _timestamped_transcript(words: list[Word], every_sec: float = 10.0) -> str:
    """Menyusun transkrip dengan penanda waktu berkala.

    LLM tidak perlu timestamp per kata untuk memilih segmen; penanda tiap
    sepuluh detik sudah cukup dan memangkas jumlah token secara signifikan.
    """
    lines: list[str] = []
    buf: list[str] = []
    next_mark = 0.0
    for w in words:
        if w.start >= next_mark:
            if buf:
                lines.append(" ".join(buf))
                buf = []
            lines.append(f"[{int(w.start)}s]")
            next_mark = w.start + every_sec
        buf.append(w.text.strip())
    if buf:
        lines.append(" ".join(buf))
    return "\n".join(lines)


def build_prompt(words: list[Word], duration_sec: int, want: int = 10) -> str:
    return f"""Kamu adalah editor konten short-form berpengalaman untuk audiens Indonesia.

Di bawah ini transkrip sebuah video berdurasi {duration_sec} detik, dengan
penanda waktu dalam kurung siku.

Tugasmu: pilih {want} segmen yang paling mungkin viral sebagai klip vertikal
di TikTok, YouTube Shorts, dan Instagram Reels.

Kriteria segmen yang baik:
- Berdiri sendiri. Penonton yang belum menonton bagian lain tetap paham.
- Punya ketegangan, kejutan, opini tajam, atau cerita yang tuntas.
- Dimulai tepat sebelum bagian menariknya, bukan di tengah kalimat.
- Durasi antara {MIN_CLIP_SEC} dan {MAX_CLIP_SEC} detik. Segmen di luar rentang
  itu akan dibuang, jadi jangan diajukan.

Judul dan hook wajib ditulis dalam Bahasa Indonesia yang wajar diucapkan,
bukan terjemahan kaku. Hook adalah satu kalimat pendek yang ditampilkan di
tiga detik pertama klip untuk menahan penonton; ia memancing rasa penasaran
tanpa mengumbar jawabannya.

Nilai score adalah bilangan desimal antara 0 dan 1, bukan persen.

Balas HANYA dengan JSON, tanpa penjelasan apa pun di luar JSON, tanpa pagar
markdown, dengan bentuk:

{{"candidates":[
  {{"start_sec":<angka>,"end_sec":<angka>,"score":<0..1>,
    "title":"<judul singkat Bahasa Indonesia>",
    "hook_text":"<hook Bahasa Indonesia>",
    "reason":"<alasan singkat mengapa segmen ini menarik>"}}
]}}

Transkrip:
{_timestamped_transcript(words)}
"""


# Label pagar tidak selalu "json": ditemui "JSON", "json5", bahkan
# "javascript". Label apa pun diterima, isinya yang divalidasi.
_FENCE_RE = re.compile(r"```[ \t]*[A-Za-z0-9_.+-]*[ \t]*\r?\n?(.*?)```", re.DOTALL)


def _strip_trailing_commas(text: str) -> str:
    """Membuang koma menggantung di luar literal string.

    Regex polos `,\\s*[}\\]]` juga akan merusak judul seperti
    "Uang, } bukan segalanya", jadi isi string dilewati apa adanya.
    """
    out: list[str] = []
    in_string = False
    escaped = False
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if in_string:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
            out.append(ch)
        elif ch == ",":
            j = i + 1
            while j < n and text[j] in " \t\r\n":
                j += 1
            if not (j < n and text[j] in "}]"):
                out.append(ch)
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _extract_json(raw: str) -> object:
    """Menggali objek JSON dari keluaran LLM yang bisa berantakan.

    Diurutkan dari cara paling murah: apa adanya, isi tiap pagar markdown,
    lalu potongan dari kurung pertama sampai terakhir. Koma menggantung
    dibersihkan sebagai percobaan kedua di setiap kandidat.
    """
    attempts: list[str] = [raw.strip()]

    attempts.extend(m.group(1).strip() for m in _FENCE_RE.finditer(raw))

    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start, end = raw.find(open_ch), raw.rfind(close_ch)
        if start != -1 and end > start:
            attempts.append(raw[start : end + 1])

    for text in attempts:
        if not text:
            continue
        for attempt in (text, _strip_trailing_commas(text)):
            try:
                # NaN/Infinity sengaja tidak ditolak di sini: satu token aneh
                # tidak boleh menjatuhkan kandidat lain yang sehat. Nilainya
                # disaring per-field oleh _as_float.
                return json.loads(attempt)
            except json.JSONDecodeError:
                continue

    # Keluaran mentah tidak pernah masuk pesan error: ia bisa memuat kutipan
    # transkrip milik user dan pesan ini berakhir di kolom jobs.error.
    raise JobError("LLM_BAD_OUTPUT", "tidak menemukan JSON pada keluaran LLM", terminal=False)


def _as_float(value: object) -> float | None:
    """float() yang menolak NaN dan tak hingga.

    json.loads menerima token NaN/Infinity, dan nilai NaN lolos semua
    perbandingan rentang (nan < 30 maupun nan > 90 sama-sama False), jadi
    kandidat sampah akan lolos validasi bila tidak disaring di sini.
    """
    try:
        num = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return num if math.isfinite(num) else None


def _normalize_score(value: object) -> float | None:
    """Menormalkan score ke rentang 0..1.

    Aturan persen: nilai di atas 10 sampai 100 (atau berakhiran "%") dibaca
    sebagai persen, jadi 92 menjadi 0.92. Nilai 1..10 ambigu — bisa skala 1..5,
    bisa 1..10, bisa salah ketik. Menebak skala di sana berisiko mengubah
    urutan kandidat secara diam-diam, jadi nilai tersebut hanya dijepit.
    Angka 10 sendiri ikut dijepit, bukan dibagi 100: pada skala 1..10 ia justru
    pilihan terbaik model, dan membacanya sebagai 10% akan membalik urutan.
    """
    percent = False
    if isinstance(value, str):
        text = value.strip()
        if text.endswith("%"):
            percent = True
            text = text[:-1].strip()
        value = text

    num = _as_float(value)
    if num is None:
        return None
    if percent or 10.0 < num <= 100.0:
        num /= 100.0
    return max(0.0, min(1.0, num))


def _looks_like_candidate(obj: dict) -> bool:
    return any(k in obj for k in _CANDIDATE_KEYS)


def _as_items(data: object) -> list:
    """Menyeragamkan bentuk amplop menjadi daftar objek kandidat."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        items: object = None
        for key in _ENVELOPE_KEYS:
            if key in data:
                items = data[key]
                break
        if items is None:
            # Nama kunci amplop kadang dikarang model; ambil daftar objek
            # pertama yang ada, item yang tidak relevan tersaring belakangan.
            items = next(
                (
                    v
                    for v in data.values()
                    if isinstance(v, list) and any(isinstance(x, dict) for x in v)
                ),
                None,
            )
        if items is None and _looks_like_candidate(data):
            items = data
        if isinstance(items, dict):
            # Model mengembalikan satu objek, bukan daftar berisi satu objek.
            items = [items]
        if isinstance(items, list):
            return items
    raise JobError("LLM_BAD_OUTPUT", "keluaran LLM bukan daftar kandidat", terminal=False)


def parse_candidates(raw: str, duration_sec: int) -> list[Candidate]:
    items = _as_items(_extract_json(raw))

    out: list[Candidate] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        start = _as_float(item.get("start_sec"))
        end = _as_float(item.get("end_sec"))
        score = _normalize_score(item.get("score"))
        title = item.get("title")
        hook = item.get("hook_text")
        if start is None or end is None or score is None:
            continue
        if not isinstance(title, str) or not title.strip():
            continue
        if not isinstance(hook, str) or not hook.strip():
            continue
        if start < 0 or end > duration_sec:
            continue
        # Rentang terbalik menghasilkan panjang negatif; nilai negatif selalu
        # di bawah MIN_CLIP_SEC, jadi tidak perlu cabang terpisah untuk itu.
        length = end - start
        if length < MIN_CLIP_SEC or length > MAX_CLIP_SEC:
            continue
        reason = item.get("reason")
        out.append(
            Candidate(
                start_sec=start,
                end_sec=end,
                score=score,
                title=title.strip(),
                hook_text=hook.strip(),
                reason=reason.strip() if isinstance(reason, str) else None,
            )
        )

    if len(out) < len(items):
        # Hanya jumlah yang dicatat; isi keluaran LLM memuat materi user.
        log.warning(
            "%d dari %d kandidat LLM dibuang karena tidak valid",
            len(items) - len(out),
            len(items),
        )

    if not out:
        raise JobError(
            "LLM_BAD_OUTPUT", "tidak ada kandidat yang lolos validasi", terminal=False
        )
    return sorted(out, key=lambda c: c.score, reverse=True)


def slice_transcript(words: list[Word], start: float, end: float) -> str:
    return " ".join(w.text.strip() for w in words if w.start >= start and w.end <= end).strip()
