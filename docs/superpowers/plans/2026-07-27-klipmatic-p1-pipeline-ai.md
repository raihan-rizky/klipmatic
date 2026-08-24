# Klipmatic P1 — Pipeline AI: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prasyarat:** P0 selesai (`docs/superpowers/plans/2026-07-27-klipmatic-p0-fondasi-ingest.md`). Rencana ini mengasumsikan tabel, antrian job, worker loop, storage R2, dan handler ingest sudah berjalan dan teruji.

**Goal:** Dari audio yang sudah ada di R2, hasilkan sepuluh kandidat klip berskor lengkap dengan hook — memakai transkripsi berbiaya sangat rendah dan LLM milik user sendiri — lalu tampilkan di web.

**Architecture:** Dua handler job baru menyusul `ingest`. `transcribe` memanggil DeepInfra dengan fallback Groq, menyimpan transkrip word-level ke R2, dan mencatat hasilnya sehingga sumber yang sama tidak pernah ditranskrip dua kali. `analyze` mendekripsi API key milik user, memanggil provider pilihannya, mem-parsing keluaran menjadi kandidat klip, dan menyimpan hasilnya dengan kunci `input_hash` sehingga transkrip dan prompt yang sama tidak pernah dibayar dua kali. Handler `fetch_segments` mengambil hanya potongan video terpilih.

**Tech Stack:** Tambahan atas P0 — `httpx` untuk panggilan HTTP, `cryptography` untuk membuka kredensial BYOK yang disegel TypeScript, DeepInfra dan Groq untuk transkripsi, Gemini / OpenAI-compatible / Anthropic-compatible untuk analisis.

**Spec:** `docs/superpowers/specs/2026-07-27-klipmatic-p0-p1-design.md`

---

## Global Constraints

Berlaku penuh dari P0, ditegaskan ulang karena task-task ini menyentuhnya langsung.

- **CI tidak pernah memanggil jaringan.** Seluruh respons DeepInfra, Groq, Gemini, OpenAI, dan Anthropic direkam sebagai fixture dan diputar ulang.
- **Plaintext API key user tidak pernah meninggalkan server**, tidak masuk log, tidak masuk pesan exception, dan tidak muncul di respons API mana pun termasuk respons error.
- **Worker hanya memancarkan `error_code`.** Pemetaan ke kalimat Indonesia berada hanya di `apps/web/lib/errorMessages.ts`.
- **Model transkripsi:** `whisper-large-v3-turbo`. Model kecil tidak akurat untuk Bahasa Indonesia dan tidak boleh dipakai.
- **Word-level timestamp wajib.** Tanpa itu caption karaoke (P2) dan Editor C (P3) tidak dapat dibangun.
- Commit setiap akhir task, pesan Conventional Commits berbahasa Inggris.

---

## Struktur File

Berkas baru di atas struktur P0.

```
apps/downloader/
├── app/
│   ├── crypto.py                  # membuka segel BYOK dari TypeScript
│   ├── providers/
│   │   ├── __init__.py
│   │   ├── transcription.py       # DeepInfra → Groq
│   │   └── llm.py                 # Gemini / OpenAI-compat / Anthropic-compat
│   ├── prompts/
│   │   └── highlights_v1.py       # prompt + parser keluaran
│   └── handlers/
│       ├── transcribe.py
│       ├── analyze.py
│       └── fetch_segments.py
├── tests/
│   ├── fixtures/
│   │   ├── sealed_keys.json       # dihasilkan oleh tes TypeScript
│   │   ├── deepinfra_ok.json
│   │   ├── groq_ok.json
│   │   ├── llm_gemini_ok.json
│   │   ├── llm_openai_ok.json
│   │   ├── llm_anthropic_ok.json
│   │   └── llm_malformed/*.txt    # keluaran cacat yang nyata
│   ├── test_crypto_interop.py
│   ├── test_transcription.py
│   ├── test_llm.py
│   ├── test_prompts.py
│   ├── test_transcribe_handler.py
│   ├── test_analyze_handler.py
│   └── test_fetch_segments.py
├── scripts/
│   └── canary.py                  # healthcheck harian yt-dlp
apps/web/
├── app/settings/keys/page.tsx
├── app/api/keys/route.ts
├── app/api/keys/[id]/route.ts
├── components/ApiKeyForm.tsx
├── components/CandidateList.tsx
└── test/apiKeys.test.ts
packages/db/
└── test/cryptoFixture.test.ts     # menghasilkan fixture untuk Python
docs/adr/
└── 0001-transcription-provider.md
```

---

## Task 1: Spike — verifikasi word-level timestamp DeepInfra

Spec §5.1 menetapkan ini sebagai pekerjaan hari pertama. Hasilnya menentukan provider primary untuk seluruh sisa rencana. Task ini **tidak** menghasilkan kode produksi; keluarannya adalah keputusan tertulis dan dua berkas fixture.

**Files:**
- Create: `docs/adr/0001-transcription-provider.md`
- Create: `apps/downloader/tests/fixtures/deepinfra_ok.json`, `apps/downloader/tests/fixtures/groq_ok.json`
- Create: `apps/downloader/scripts/spike_transcription.py`

**Interfaces:**
- Consumes: tidak ada
- Produces: fixture respons kedua provider; ADR yang menetapkan `PRIMARY_PROVIDER`

- [ ] **Step 1: Tulis skrip spike**

`apps/downloader/scripts/spike_transcription.py`:
```python
"""Menjalankan satu berkas audio ke DeepInfra dan Groq lalu merekam responsnya.

Dijalankan manual satu kali, bukan bagian dari CI. Keluarannya menjadi fixture.

Pakai:
    DEEPINFRA_API_KEY=... GROQ_API_KEY=... \
      uv run python scripts/spike_transcription.py sample.opus
"""

import json
import os
import sys
from pathlib import Path

import httpx

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"

TARGETS = [
    ("deepinfra", "https://api.deepinfra.com/v1/openai/audio/transcriptions",
     "DEEPINFRA_API_KEY", "openai/whisper-large-v3-turbo"),
    ("groq", "https://api.groq.com/openai/v1/audio/transcriptions",
     "GROQ_API_KEY", "whisper-large-v3-turbo"),
]


def main(audio: Path) -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    for name, url, env, model in TARGETS:
        key = os.environ.get(env)
        if not key:
            print(f"{name}: LEWAT, {env} tidak diset")
            continue
        with httpx.Client(timeout=300) as client:
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
        print(f"{name}: HTTP {resp.status_code}")
        if resp.status_code != 200:
            print(resp.text[:500])
            continue
        body = resp.json()
        (FIXTURES / f"{name}_ok.json").write_text(json.dumps(body, ensure_ascii=False, indent=2))
        words = body.get("words") or []
        print(f"{name}: {len(words)} word timestamp, contoh: {words[:3]}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
```

- [ ] **Step 2: Siapkan sampel audio Bahasa Indonesia**

Ambil audio berdurasi 2-3 menit dari podcast Bahasa Indonesia lewat pipeline P0, atau:
```bash
cd apps/downloader
uv run yt-dlp -f bestaudio -o /tmp/sample.m4a "<URL podcast Indonesia pendek>"
ffmpeg -i /tmp/sample.m4a -vn -ac 1 -ar 16000 -c:a libopus -b:a 24k -y /tmp/sample.opus
```

- [ ] **Step 3: Jalankan spike terhadap kedua provider**

Run:
```bash
cd apps/downloader
DEEPINFRA_API_KEY=... GROQ_API_KEY=... uv run python scripts/spike_transcription.py /tmp/sample.opus
```

Catat untuk masing-masing: apakah array `words` ada dan tidak kosong; apakah tiap entri punya `word`, `start`, `end`; dan kualitas Bahasa Indonesianya secara kasat mata.

- [ ] **Step 4: Tulis ADR**

`docs/adr/0001-transcription-provider.md`:
```markdown
# ADR 0001: Provider transkripsi primary

**Tanggal:** <isi tanggal eksekusi>
**Status:** Diterima

## Konteks

Spec §5.1 memilih DeepInfra sebagai primary karena harganya sekitar sepertiga
Groq (USD 0,012 vs USD 0,036 per jam audio). Pilihan itu bersyarat pada
dukungan word-level timestamp, yang wajib untuk caption karaoke (P2) dan
Editor C (P3).

## Hasil pengukuran

| Provider | HTTP | Array `words` | Field per kata | Kualitas Bahasa Indonesia |
|---|---|---|---|---|
| DeepInfra | <isi> | <isi> | <isi> | <isi> |
| Groq | <isi> | <isi> | <isi> | <isi> |

## Keputusan

`PRIMARY_PROVIDER = "<deepinfra atau groq>"`, `FALLBACK_PROVIDER = "<yang lain>"`.

<Bila DeepInfra tidak mengembalikan word timestamp, primary bergeser permanen
ke Groq. Selisih biayanya sekitar Rp400 per video dan tidak mengubah kelayakan
proyek.>

## Konsekuensi

Konstanta di `app/providers/transcription.py` mengikuti keputusan ini. Rantai
fallback tetap ada apa pun hasilnya, karena kedua penyedia sama-sama bisa down.
```

- [ ] **Step 5: Commit**

```bash
git add docs/adr apps/downloader/scripts apps/downloader/tests/fixtures
git commit -m "docs: ADR 0001 transcription provider selection with recorded fixtures"
```

---

## Task 2: Adapter transkripsi

**Files:**
- Create: `apps/downloader/app/providers/__init__.py`, `apps/downloader/app/providers/transcription.py`
- Test: `apps/downloader/tests/test_transcription.py`

**Interfaces:**
- Consumes: `JobError`; fixture dari Task 1
- Produces:
  - `@dataclass Word` dengan `text: str`, `start: float`, `end: float`
  - `@dataclass TranscriptResult` dengan `language: str`, `text: str`, `words: list[Word]`, `provider: str`, `model: str`, `cost_usd: float`
  - `def parse_response(provider: str, body: dict) -> TranscriptResult`
  - `def estimate_cost(provider: str, duration_sec: int) -> float`
  - `def transcribe(audio: Path, duration_sec: int, *, http=None) -> TranscriptResult`

- [ ] **Step 1: Tulis tes yang gagal**

`apps/downloader/tests/test_transcription.py`:
```python
import json
from pathlib import Path

import httpx
import pytest

from app.errors import JobError
from app.providers.transcription import (
    PRIMARY,
    TranscriptResult,
    estimate_cost,
    parse_response,
    transcribe,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def test_parse_response_menghasilkan_word_timestamp():
    result = parse_response(PRIMARY, _fixture(f"{PRIMARY}_ok.json"))
    assert isinstance(result, TranscriptResult)
    assert result.text.strip()
    assert len(result.words) > 0
    first = result.words[0]
    assert first.text.strip()
    assert first.end > first.start


def test_word_timestamp_menaik_monoton():
    result = parse_response(PRIMARY, _fixture(f"{PRIMARY}_ok.json"))
    for a, b in zip(result.words, result.words[1:]):
        assert b.start >= a.start


def test_parse_response_menolak_respons_tanpa_words():
    with pytest.raises(JobError) as e:
        parse_response("deepinfra", {"text": "halo", "language": "id"})
    assert e.value.code == "TRANSCRIBE_FAILED"


def test_estimate_cost_sebanding_dengan_durasi():
    satu_jam = estimate_cost(PRIMARY, 3600)
    dua_jam = estimate_cost(PRIMARY, 7200)
    assert 0 < satu_jam < 0.10
    assert abs(dua_jam - satu_jam * 2) < 1e-9


def test_transcribe_memakai_primary_saat_berhasil(tmp_path: Path, monkeypatch):
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")
    monkeypatch.setenv("DEEPINFRA_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, json=_fixture(f"{PRIMARY}_ok.json"))

    result = transcribe(audio, 60, http=httpx.Client(transport=httpx.MockTransport(handler)))
    assert result.provider == PRIMARY
    assert len(calls) == 1


def test_transcribe_jatuh_ke_fallback_saat_primary_gagal(tmp_path: Path, monkeypatch):
    from app.providers.transcription import FALLBACK

    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")
    monkeypatch.setenv("DEEPINFRA_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if len(calls) == 1:
            return httpx.Response(503, text="layanan tidak tersedia")
        return httpx.Response(200, json=_fixture(f"{FALLBACK}_ok.json"))

    result = transcribe(audio, 60, http=httpx.Client(transport=httpx.MockTransport(handler)))
    assert result.provider == FALLBACK
    assert len(calls) == 2


def test_transcribe_gagal_bila_kedua_provider_gagal(tmp_path: Path, monkeypatch):
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")
    monkeypatch.setenv("DEEPINFRA_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="meledak")

    with pytest.raises(JobError) as e:
        transcribe(audio, 60, http=httpx.Client(transport=httpx.MockTransport(handler)))
    assert e.value.code == "TRANSCRIBE_FAILED"
    assert e.value.terminal is False


def test_api_key_tidak_bocor_ke_pesan_error(tmp_path: Path, monkeypatch):
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")
    monkeypatch.setenv("DEEPINFRA_API_KEY", "RAHASIA-DEEPINFRA-123")
    monkeypatch.setenv("GROQ_API_KEY", "RAHASIA-GROQ-456")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="unauthorized")

    with pytest.raises(JobError) as e:
        transcribe(audio, 60, http=httpx.Client(transport=httpx.MockTransport(handler)))
    assert "RAHASIA" not in str(e.value)
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `cd apps/downloader && uv run pytest tests/test_transcription.py -v`
Expected: FAIL — `app.providers.transcription` belum ada.

- [ ] **Step 3: Implementasikan**

`apps/downloader/app/providers/__init__.py`: (berkas kosong)

`apps/downloader/app/providers/transcription.py`:
```python
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.errors import JobError

log = logging.getLogger(__name__)

# Ditetapkan oleh docs/adr/0001-transcription-provider.md.
# Ubah kedua konstanta ini bila ADR berubah.
PRIMARY = "deepinfra"
FALLBACK = "groq"

MODEL = "whisper-large-v3-turbo"

_CONFIG = {
    "deepinfra": {
        "url": "https://api.deepinfra.com/v1/openai/audio/transcriptions",
        "env": "DEEPINFRA_API_KEY",
        "model": "openai/whisper-large-v3-turbo",
        "usd_per_sec": 0.0002 / 60,
    },
    "groq": {
        "url": "https://api.groq.com/openai/v1/audio/transcriptions",
        "env": "GROQ_API_KEY",
        "model": "whisper-large-v3-turbo",
        "usd_per_sec": 0.0006 / 60,
    },
}


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class TranscriptResult:
    language: str
    text: str
    words: list[Word]
    provider: str
    model: str
    cost_usd: float


def estimate_cost(provider: str, duration_sec: int) -> float:
    return _CONFIG[provider]["usd_per_sec"] * duration_sec


def parse_response(provider: str, body: dict) -> TranscriptResult:
    raw_words = body.get("words")
    if not raw_words:
        # Tanpa word timestamp, caption karaoke dan Editor C tidak mungkin.
        # Lebih baik gagal keras di sini daripada menemukannya di P2.
        raise JobError(
            "TRANSCRIBE_FAILED",
            f"{provider} tidak mengembalikan word-level timestamp",
            terminal=False,
        )
    words = [
        Word(text=w["word"], start=float(w["start"]), end=float(w["end"]))
        for w in raw_words
        if w.get("word") is not None
    ]
    return TranscriptResult(
        language=body.get("language") or "id",
        text=body.get("text") or "".join(w.text for w in words),
        words=words,
        provider=provider,
        model=MODEL,
        cost_usd=0.0,  # diisi pemanggil lewat estimate_cost
    )


def _call(provider: str, audio: Path, http: httpx.Client) -> TranscriptResult:
    cfg = _CONFIG[provider]
    key = os.environ.get(cfg["env"])
    if not key:
        raise JobError("TRANSCRIBE_FAILED", f"{cfg['env']} tidak diset", terminal=False)

    resp = http.post(
        cfg["url"],
        headers={"Authorization": f"Bearer {key}"},
        files={"file": (audio.name, audio.read_bytes(), "audio/ogg")},
        data={
            "model": cfg["model"],
            "response_format": "verbose_json",
            "timestamp_granularities[]": "word",
            "language": "id",
        },
        timeout=600,
    )
    if resp.status_code != 200:
        # Badan respons sengaja tidak disertakan; ia dapat memantulkan header
        # permintaan termasuk Authorization pada sebagian gateway.
        raise JobError(
            "TRANSCRIBE_FAILED", f"{provider} membalas HTTP {resp.status_code}", terminal=False
        )
    return parse_response(provider, resp.json())


def transcribe(
    audio: Path, duration_sec: int, *, http: httpx.Client | None = None
) -> TranscriptResult:
    """Mencoba primary lalu fallback. Keduanya bisa down, jadi rantai ini
    tetap ada apa pun hasil ADR 0001."""
    client = http or httpx.Client(timeout=600)
    errors: list[str] = []
    for provider in (PRIMARY, FALLBACK):
        try:
            result = _call(provider, audio, client)
            return TranscriptResult(
                language=result.language,
                text=result.text,
                words=result.words,
                provider=provider,
                model=result.model,
                cost_usd=estimate_cost(provider, duration_sec),
            )
        except JobError as e:
            log.warning("provider transkripsi %s gagal: %s", provider, e)
            errors.append(f"{provider}: {e}")
    raise JobError("TRANSCRIBE_FAILED", "; ".join(errors), terminal=False)
```

- [ ] **Step 4: Jalankan tes**

Run: `cd apps/downloader && uv run pytest tests/test_transcription.py -v`
Expected: PASS, delapan tes lulus.

- [ ] **Step 5: Commit**

```bash
git add apps/downloader
git commit -m "feat(worker): transcription adapter with primary and fallback providers"
```

---

## Task 3: Handler transcribe dengan cache

**Files:**
- Create: `apps/downloader/app/handlers/transcribe.py`
- Modify: `apps/downloader/app/worker.py` (daftarkan handler)
- Test: `apps/downloader/tests/test_transcribe_handler.py`

**Interfaces:**
- Consumes: `transcribe()`, `TranscriptResult` (Task 2); `Storage`, `heartbeat` (P0)
- Produces: `def handle_transcribe(conn, job, *, storage=None, transcribe_fn=..., http=None) -> None`; payload `{"source_id": str, "project_id": str}`; menulis baris `transcripts` dan objek R2 `transcripts/{source_id}/{model}.json`

- [ ] **Step 1: Tulis tes yang gagal**

`apps/downloader/tests/test_transcribe_handler.py`:
```python
import json
from unittest.mock import MagicMock

import pytest

from app.errors import JobError
from app.handlers.transcribe import handle_transcribe
from app.providers.transcription import TranscriptResult, Word
from app.queue import Job

RESULT = TranscriptResult(
    language="id",
    text="halo semuanya selamat datang",
    words=[
        Word("halo", 0.0, 0.4), Word("semuanya", 0.4, 1.0),
        Word("selamat", 1.0, 1.5), Word("datang", 1.5, 2.0),
    ],
    provider="deepinfra",
    model="whisper-large-v3-turbo",
    cost_usd=0.012,
)


def _ready_source(conn, external_id: str = "dQw4w9WgXcQ") -> str:
    sid = conn.execute(
        """
        insert into sources (kind, external_id, is_public, url_original, status,
                             duration_sec, audio_r2_key, audio_sha256)
        values ('youtube', %s, true, 'https://youtu.be/x', 'ready', 3600,
                'audio/abc.opus', 'abc')
        returning id
        """,
        (external_id,),
    ).fetchone()[0]
    conn.commit()
    return str(sid)


def _project(conn, source_id: str) -> str:
    uid = conn.execute(
        "insert into auth.users (email) values ('t@test.id') returning id"
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    pid = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'p') returning id",
        (uid, source_id),
    ).fetchone()[0]
    conn.commit()
    return str(pid)


@pytest.fixture
def deps(tmp_path):
    storage = MagicMock()
    storage.download_to.side_effect = lambda key, dest: dest.write_bytes(b"opus palsu")
    return {"storage": storage, "transcribe_fn": lambda audio, dur, http=None: RESULT,
            "workdir": tmp_path}


def test_menyimpan_transkrip_dan_mencatat_biaya(conn, deps):
    s = _ready_source(conn)
    p = _project(conn, s)

    handle_transcribe(conn, Job("j1", "transcribe", {"source_id": s, "project_id": p}, 1, 3, p, None), **deps)

    row = conn.execute(
        "select provider, model, language, r2_key, word_count, cost_usd "
        "from transcripts where source_id = %s", (s,)
    ).fetchone()
    assert row[0] == "deepinfra"
    assert row[1] == "whisper-large-v3-turbo"
    assert row[2] == "id"
    assert row[3] == f"transcripts/{s}/whisper-large-v3-turbo.json"
    assert row[4] == 4
    assert float(row[5]) == pytest.approx(0.012)


def test_json_yang_diunggah_memuat_word_timestamp(conn, deps):
    s = _ready_source(conn)
    p = _project(conn, s)
    handle_transcribe(conn, Job("j2", "transcribe", {"source_id": s, "project_id": p}, 1, 3, p, None), **deps)

    put = deps["storage"].put_bytes.call_args
    body = json.loads(put.args[1].decode("utf-8"))
    assert body["language"] == "id"
    assert len(body["words"]) == 4
    assert body["words"][0] == {"text": "halo", "start": 0.0, "end": 0.4}


def test_transkrip_yang_sudah_ada_tidak_dipanggil_ulang(conn, deps):
    s = _ready_source(conn)
    p = _project(conn, s)
    handle_transcribe(conn, Job("j3", "transcribe", {"source_id": s, "project_id": p}, 1, 3, p, None), **deps)

    calls = []
    deps["transcribe_fn"] = lambda audio, dur, http=None: calls.append(1) or RESULT
    handle_transcribe(conn, Job("j4", "transcribe", {"source_id": s, "project_id": p}, 1, 3, p, None), **deps)

    assert calls == []
    assert conn.execute(
        "select count(*) from transcripts where source_id = %s", (s,)
    ).fetchone()[0] == 1


def test_sumber_belum_ready_ditolak_terminal(conn, deps):
    sid = conn.execute(
        """
        insert into sources (kind, external_id, is_public, url_original, status)
        values ('youtube', 'belumsiap1', true, 'https://youtu.be/x', 'pending')
        returning id
        """
    ).fetchone()[0]
    conn.commit()
    p = _project(conn, str(sid))

    with pytest.raises(JobError) as e:
        handle_transcribe(
            conn, Job("j5", "transcribe", {"source_id": str(sid), "project_id": p}, 1, 3, p, None), **deps
        )
    assert e.value.terminal is True


def test_kegagalan_provider_diteruskan_sebagai_non_terminal(conn, deps):
    s = _ready_source(conn)
    p = _project(conn, s)

    def boom(audio, dur, http=None):
        raise JobError("TRANSCRIBE_FAILED", "kedua provider down", terminal=False)

    deps["transcribe_fn"] = boom
    with pytest.raises(JobError) as e:
        handle_transcribe(conn, Job("j6", "transcribe", {"source_id": s, "project_id": p}, 1, 3, p, None), **deps)
    assert e.value.code == "TRANSCRIBE_FAILED"
    assert e.value.terminal is False
    assert conn.execute(
        "select count(*) from transcripts where source_id = %s", (s,)
    ).fetchone()[0] == 0
```

- [ ] **Step 2: Tambahkan `download_to` dan `put_bytes` ke Storage**

Tambahkan dua metode ke `apps/downloader/app/storage.py`:
```python
    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        self._s3.put_object(
            Bucket=self.bucket, Key=key, Body=data, ContentType=content_type,
            CacheControl="public, max-age=31536000, immutable",
        )

    def download_to(self, key: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        self._s3.download_file(self.bucket, key, str(dest))
        return dest
```

- [ ] **Step 3: Jalankan tes untuk memastikan gagal**

Run: `cd apps/downloader && uv run pytest tests/test_transcribe_handler.py -v`
Expected: FAIL — `app.handlers.transcribe` belum ada.

- [ ] **Step 4: Implementasikan handler**

`apps/downloader/app/handlers/transcribe.py`:
```python
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Callable

import psycopg

from app.errors import JobError
from app.providers.transcription import MODEL, TranscriptResult
from app.providers.transcription import transcribe as _transcribe
from app.queue import Job, heartbeat
from app.storage import Storage, storage_from_env


def _serialize(result: TranscriptResult) -> bytes:
    return json.dumps(
        {
            "language": result.language,
            "text": result.text,
            "provider": result.provider,
            "model": result.model,
            "words": [{"text": w.text, "start": w.start, "end": w.end} for w in result.words],
        },
        ensure_ascii=False,
    ).encode("utf-8")


def handle_transcribe(
    conn: psycopg.Connection,
    job: Job,
    *,
    storage: Storage | None = None,
    transcribe_fn: Callable[..., TranscriptResult] = _transcribe,
    workdir: Path | None = None,
) -> None:
    storage = storage or storage_from_env()
    source_id: str = job.payload["source_id"]

    row = conn.execute(
        "select status, audio_r2_key, duration_sec from sources where id = %s", (source_id,)
    ).fetchone()
    if row is None:
        raise JobError("INTERNAL", f"source {source_id} tidak ditemukan", terminal=True)
    status, audio_key, duration_sec = row
    if status != "ready" or not audio_key:
        raise JobError("INTERNAL", f"source {source_id} belum siap ditranskrip", terminal=True)

    # Cache lapis transkrip (spec §8). Pemeriksaan ini yang membuat user kedua
    # pada video yang sama tidak menimbulkan biaya API sama sekali.
    existing = conn.execute(
        "select id from transcripts where source_id = %s and model = %s", (source_id, MODEL)
    ).fetchone()
    if existing:
        heartbeat(conn, job.id, 100)
        return

    heartbeat(conn, job.id, 10)
    tmp_root = workdir or Path(tempfile.mkdtemp(prefix="cc-transcribe-"))
    audio = tmp_root / f"{source_id}.opus"
    storage.download_to(audio_key, audio)

    heartbeat(conn, job.id, 30)
    result = transcribe_fn(audio, duration_sec or 0)

    heartbeat(conn, job.id, 85)
    key = f"transcripts/{source_id}/{MODEL}.json"
    storage.put_bytes(key, _serialize(result), "application/json")

    conn.execute(
        """
        insert into transcripts (source_id, provider, model, language, r2_key,
                                 word_count, cost_usd)
        values (%s, %s, %s, %s, %s, %s, %s)
        on conflict (source_id, model) do nothing
        """,
        (source_id, result.provider, MODEL, result.language, key,
         len(result.words), result.cost_usd),
    )
    conn.commit()
```

- [ ] **Step 5: Daftarkan handler di worker**

Di `apps/downloader/app/worker.py`, ganti isi fungsi `main` bagian handler:
```python
    from app.handlers.analyze import handle_analyze
    from app.handlers.fetch_segments import handle_fetch_segments
    from app.handlers.ingest import handle_ingest
    from app.handlers.transcribe import handle_transcribe

    handlers: dict[str, Handler] = {
        "ingest": handle_ingest,
        "transcribe": handle_transcribe,
        "analyze": handle_analyze,
        "fetch_segments": handle_fetch_segments,
    }
```
Impor `handle_analyze` dan `handle_fetch_segments` akan gagal sampai Task 6 dan 7 selesai. Untuk sementara, daftarkan hanya `ingest` dan `transcribe`, lalu lengkapi di Task 7.

- [ ] **Step 6: Rantaikan ingest ke transcribe**

Di akhir `handle_ingest` (`apps/downloader/app/handlers/ingest.py`), setelah blok `try` berhasil, tambahkan sebelum `except`:
```python
        from app.queue import enqueue

        enqueue(
            conn, "transcribe",
            {"source_id": source_id, "project_id": project_id},
            user_id=job.user_id, project_id=project_id,
        )
```
Dan pada jalur cache hit (setelah `_repoint_and_drop`), tambahkan hal yang sama dengan `source_id=reusable` sebelum `return`, agar user kedua tetap melanjutkan ke tahap berikutnya.

- [ ] **Step 7: Jalankan tes**

Run: `cd apps/downloader && uv run pytest -v`
Expected: PASS, seluruh tes worker lulus.

- [ ] **Step 8: Commit**

```bash
git add apps/downloader
git commit -m "feat(worker): transcribe handler with per-source transcript cache"
```

---

## Task 4: Membuka segel BYOK di Python

Kredensial disegel oleh TypeScript (P0 Task 5) dan dibuka oleh Python. Kesalahan interop di sini baru ketahuan saat runtime produksi, jadi kompatibilitasnya diuji lintas bahasa memakai fixture.

**Files:**
- Create: `packages/db/test/cryptoFixture.test.ts`
- Create: `apps/downloader/app/crypto.py`
- Test: `apps/downloader/tests/test_crypto_interop.py`

**Interfaces:**
- Consumes: format `SealedKey` dari P0 Task 5
- Produces:
  - `def open_api_key(encrypted_key: str, key_iv: str, key_tag: str, master_key_b64: str) -> str`
  - `def load_api_key(conn, user_id: str, provider: str | None = None) -> ApiKeyRecord`
  - `@dataclass ApiKeyRecord` dengan `id, provider, base_url, model, secret`

- [ ] **Step 1: Tambahkan dependensi kripto**

Tambahkan `"cryptography>=43.0"` ke `dependencies` di `apps/downloader/pyproject.toml`, lalu `uv sync`.

- [ ] **Step 2: Hasilkan fixture dari TypeScript**

`packages/db/test/cryptoFixture.test.ts`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { openApiKey, sealApiKey } from '../src/crypto'

// Master key tetap, khusus tes. JANGAN dipakai di lingkungan mana pun.
const MASTER = 'K1JzZWNyZXQtdGVzdC1tYXN0ZXIta2V5LTMyYnl0ZXMh'

const CASES = [
  { name: 'ascii', plaintext: 'sk-proj-abcdef1234567890' },
  { name: 'panjang', plaintext: 'x'.repeat(512) },
  { name: 'unicode', plaintext: 'kunci-rahasia-ñ-日本語-🎬' },
]

test('menghasilkan fixture untuk interop Python', () => {
  const fixtures = CASES.map((c) => ({ ...c, sealed: sealApiKey(c.plaintext, MASTER) }))

  for (const f of fixtures) {
    expect(openApiKey(f.sealed, MASTER)).toBe(f.plaintext)
  }

  const dir = join(__dirname, '../../../apps/downloader/tests/fixtures')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'sealed_keys.json'),
    JSON.stringify({ masterKey: MASTER, cases: fixtures }, null, 2),
  )
})
```

Run: `bun run test packages/db/test/cryptoFixture.test.ts`
Expected: PASS, dan `apps/downloader/tests/fixtures/sealed_keys.json` terbentuk.

- [ ] **Step 3: Tulis tes Python yang gagal**

`apps/downloader/tests/test_crypto_interop.py`:
```python
import base64
import json
from pathlib import Path

import pytest

from app.crypto import load_api_key, open_api_key

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "sealed_keys.json").read_text())
MASTER = FIXTURE["masterKey"]


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_python_dapat_membuka_segel_typescript(case):
    s = case["sealed"]
    assert open_api_key(s["encryptedKey"], s["keyIv"], s["keyTag"], MASTER) == case["plaintext"]


def test_tag_yang_diubah_ditolak():
    s = FIXTURE["cases"][0]["sealed"]
    tag = bytearray(base64.b64decode(s["keyTag"]))
    tag[0] ^= 0xFF
    with pytest.raises(Exception):
        open_api_key(s["encryptedKey"], s["keyIv"], base64.b64encode(tag).decode(), MASTER)


def test_master_key_salah_ditolak():
    s = FIXTURE["cases"][0]["sealed"]
    wrong = base64.b64encode(b"0" * 32).decode()
    with pytest.raises(Exception):
        open_api_key(s["encryptedKey"], s["keyIv"], s["keyTag"], wrong)


def test_load_api_key_mengembalikan_kredensial_user(conn, monkeypatch):
    monkeypatch.setenv("BYOK_MASTER_KEY", MASTER)
    s = FIXTURE["cases"][0]["sealed"]
    plaintext = FIXTURE["cases"][0]["plaintext"]

    uid = conn.execute(
        "insert into auth.users (email) values ('k@test.id') returning id"
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    conn.execute(
        """
        insert into api_keys (user_id, provider, label, base_url, model,
                              encrypted_key, key_iv, key_tag)
        values (%s, 'gemini', 'utama', null, 'gemini-2.5-flash', %s, %s, %s)
        """,
        (uid, s["encryptedKey"], s["keyIv"], s["keyTag"]),
    )
    conn.commit()

    rec = load_api_key(conn, str(uid))
    assert rec.provider == "gemini"
    assert rec.model == "gemini-2.5-flash"
    assert rec.secret == plaintext


def test_load_api_key_gagal_BYOK_INVALID_bila_user_belum_punya_key(conn, monkeypatch):
    from app.errors import JobError

    monkeypatch.setenv("BYOK_MASTER_KEY", MASTER)
    uid = conn.execute(
        "insert into auth.users (email) values ('nokey@test.id') returning id"
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    conn.commit()

    with pytest.raises(JobError) as e:
        load_api_key(conn, str(uid))
    assert e.value.code == "BYOK_INVALID"
    assert e.value.terminal is True
```

- [ ] **Step 4: Jalankan tes untuk memastikan gagal**

Run: `cd apps/downloader && uv run pytest tests/test_crypto_interop.py -v`
Expected: FAIL — `app.crypto` belum ada.

- [ ] **Step 5: Implementasikan**

`apps/downloader/app/crypto.py`:
```python
from __future__ import annotations

import base64
import os
from dataclasses import dataclass

import psycopg
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.errors import JobError


@dataclass(frozen=True)
class ApiKeyRecord:
    id: str
    provider: str
    base_url: str | None
    model: str
    secret: str


def open_api_key(
    encrypted_key: str, key_iv: str, key_tag: str, master_key_b64: str
) -> str:
    """Membuka segel yang dibuat packages/db/src/crypto.ts.

    Node menyimpan tag GCM terpisah; AESGCM Python mengharapkannya
    tergabung di akhir ciphertext, jadi keduanya disambung di sini.
    """
    master = base64.b64decode(master_key_b64)
    if len(master) != 32:
        raise ValueError("BYOK_MASTER_KEY harus 32 byte dalam base64")
    aes = AESGCM(master)
    ciphertext = base64.b64decode(encrypted_key) + base64.b64decode(key_tag)
    return aes.decrypt(base64.b64decode(key_iv), ciphertext, None).decode("utf-8")


def load_api_key(
    conn: psycopg.Connection, user_id: str, provider: str | None = None
) -> ApiKeyRecord:
    """Mengambil dan mendekripsi kredensial BYOK milik user.

    Nilai plaintext hanya hidup di memori proses ini. Ia tidak pernah ditulis
    ke database, log, maupun pesan exception.
    """
    if provider:
        row = conn.execute(
            """
            select id, provider, base_url, model, encrypted_key, key_iv, key_tag
              from api_keys where user_id = %s and provider = %s
             order by last_used_at desc nulls last, created_at desc limit 1
            """,
            (user_id, provider),
        ).fetchone()
    else:
        row = conn.execute(
            """
            select id, provider, base_url, model, encrypted_key, key_iv, key_tag
              from api_keys where user_id = %s
             order by last_used_at desc nulls last, created_at desc limit 1
            """,
            (user_id,),
        ).fetchone()

    if row is None:
        raise JobError(
            "BYOK_INVALID", "user belum menyimpan API key", terminal=True
        )

    master = os.environ.get("BYOK_MASTER_KEY")
    if not master:
        raise JobError("INTERNAL", "BYOK_MASTER_KEY tidak diset", terminal=False)

    try:
        secret = open_api_key(row[4], row[5], row[6], master)
    except Exception as e:  # noqa: BLE001
        raise JobError("INTERNAL", f"gagal membuka segel kredensial: {type(e).__name__}") from None

    conn.execute("update api_keys set last_used_at = now() where id = %s", (row[0],))
    conn.commit()

    return ApiKeyRecord(
        id=str(row[0]), provider=row[1], base_url=row[2], model=row[3], secret=secret
    )
```

- [ ] **Step 6: Jalankan tes**

Run: `cd apps/downloader && uv run pytest tests/test_crypto_interop.py -v`
Expected: PASS, tujuh tes lulus.

- [ ] **Step 7: Commit**

```bash
git add packages/db apps/downloader
git commit -m "feat(worker): cross-language BYOK credential unsealing with interop tests"
```

---

## Task 5: Prompt dan parser keluaran LLM

Parser adalah komponen paling rawan di seluruh sistem. LLM rutin membungkus JSON dalam pagar markdown, menambahkan prakata, memakai koma menggantung, atau mengembalikan angka sebagai string. Semuanya harus ditangani, bukan dianggap tidak akan terjadi.

**Files:**
- Create: `apps/downloader/app/prompts/__init__.py`, `apps/downloader/app/prompts/highlights_v1.py`
- Create: `apps/downloader/tests/fixtures/llm_malformed/*.txt`
- Test: `apps/downloader/tests/test_prompts.py`

**Interfaces:**
- Consumes: `Word` dari Task 2; `JobError`
- Produces:
  - `PROMPT_VERSION = "highlights_v1"`
  - `def build_prompt(words: list[Word], duration_sec: int, want: int = 10) -> str`
  - `@dataclass Candidate` dengan `start_sec, end_sec, score, title, hook_text, reason`
  - `def parse_candidates(raw: str, duration_sec: int) -> list[Candidate]`
  - `def slice_transcript(words: list[Word], start: float, end: float) -> str`

- [ ] **Step 1: Buat fixture keluaran cacat**

`apps/downloader/tests/fixtures/llm_malformed/fenced.txt`:
````
Tentu, ini hasil analisisnya:

```json
{"candidates":[{"start_sec":10,"end_sec":80,"score":0.9,"title":"Judul","hook_text":"Hook","reason":"Alasan"}]}
```
````

`apps/downloader/tests/fixtures/llm_malformed/prose_prefix.txt`:
```
Berikut sepuluh momen paling menarik dari podcast tersebut.
{"candidates":[{"start_sec":"10","end_sec":"80","score":"0.9","title":"Judul","hook_text":"Hook"}]}
```

`apps/downloader/tests/fixtures/llm_malformed/trailing_comma.txt`:
```
{"candidates":[{"start_sec":10,"end_sec":80,"score":0.9,"title":"Judul","hook_text":"Hook",},]}
```

`apps/downloader/tests/fixtures/llm_malformed/bare_array.txt`:
```
[{"start_sec":10,"end_sec":80,"score":0.9,"title":"Judul","hook_text":"Hook"}]
```

`apps/downloader/tests/fixtures/llm_malformed/no_json.txt`:
```
Maaf, saya tidak dapat menganalisis transkrip ini.
```

- [ ] **Step 2: Tulis tes yang gagal**

`apps/downloader/tests/test_prompts.py`:
```python
from pathlib import Path

import pytest

from app.errors import JobError
from app.prompts.highlights_v1 import (
    PROMPT_VERSION,
    build_prompt,
    parse_candidates,
    slice_transcript,
)
from app.providers.transcription import Word

MALFORMED = Path(__file__).parent / "fixtures" / "llm_malformed"

WORDS = [
    Word("halo", 0.0, 0.5), Word("dunia", 0.5, 1.0),
    Word("ini", 10.0, 10.3), Word("menarik", 10.3, 11.0),
    Word("sekali", 79.0, 79.5), Word("bukan", 79.5, 80.0),
]


def test_prompt_version_stabil():
    assert PROMPT_VERSION == "highlights_v1"


def test_build_prompt_memuat_transkrip_bertimestamp_dan_jumlah_diminta():
    p = build_prompt(WORDS, duration_sec=120, want=10)
    assert "10" in p
    assert "menarik" in p
    assert "JSON" in p
    assert "Bahasa Indonesia" in p


def test_build_prompt_menyatakan_batas_durasi_klip():
    p = build_prompt(WORDS, duration_sec=120)
    assert "30" in p and "90" in p


def test_slice_transcript_mengambil_kata_dalam_rentang():
    assert slice_transcript(WORDS, 10.0, 11.0) == "ini menarik"


def test_slice_transcript_rentang_kosong_menghasilkan_string_kosong():
    assert slice_transcript(WORDS, 200.0, 210.0) == ""


def test_parse_json_bersih():
    raw = '{"candidates":[{"start_sec":10,"end_sec":80,"score":0.9,"title":"J","hook_text":"H","reason":"R"}]}'
    c = parse_candidates(raw, duration_sec=120)
    assert len(c) == 1
    assert c[0].start_sec == 10.0
    assert c[0].end_sec == 80.0
    assert c[0].score == 0.9
    assert c[0].title == "J"
    assert c[0].hook_text == "H"
    assert c[0].reason == "R"


@pytest.mark.parametrize(
    "fixture", ["fenced.txt", "prose_prefix.txt", "trailing_comma.txt", "bare_array.txt"]
)
def test_parse_menangani_keluaran_cacat(fixture):
    c = parse_candidates((MALFORMED / fixture).read_text(), duration_sec=120)
    assert len(c) == 1
    assert c[0].start_sec == 10.0
    assert c[0].end_sec == 80.0
    assert c[0].score == pytest.approx(0.9)


def test_parse_tanpa_json_gagal_dengan_LLM_BAD_OUTPUT():
    with pytest.raises(JobError) as e:
        parse_candidates((MALFORMED / "no_json.txt").read_text(), duration_sec=120)
    assert e.value.code == "LLM_BAD_OUTPUT"


def test_kandidat_di_luar_durasi_dibuang():
    raw = ('{"candidates":['
           '{"start_sec":10,"end_sec":80,"score":0.9,"title":"ok","hook_text":"h"},'
           '{"start_sec":500,"end_sec":560,"score":0.9,"title":"lewat","hook_text":"h"}]}')
    c = parse_candidates(raw, duration_sec=120)
    assert [x.title for x in c] == ["ok"]


def test_kandidat_dengan_rentang_terbalik_dibuang():
    raw = ('{"candidates":['
           '{"start_sec":80,"end_sec":10,"score":0.9,"title":"terbalik","hook_text":"h"},'
           '{"start_sec":10,"end_sec":80,"score":0.9,"title":"ok","hook_text":"h"}]}')
    assert [x.title for x in parse_candidates(raw, 120)] == ["ok"]


def test_kandidat_terlalu_pendek_atau_panjang_dibuang():
    raw = ('{"candidates":['
           '{"start_sec":0,"end_sec":5,"score":0.9,"title":"pendek","hook_text":"h"},'
           '{"start_sec":0,"end_sec":119,"score":0.9,"title":"panjang","hook_text":"h"},'
           '{"start_sec":10,"end_sec":80,"score":0.9,"title":"ok","hook_text":"h"}]}')
    assert [x.title for x in parse_candidates(raw, 120)] == ["ok"]


def test_score_dijepit_ke_rentang_nol_satu():
    raw = ('{"candidates":['
           '{"start_sec":10,"end_sec":80,"score":7.5,"title":"a","hook_text":"h"},'
           '{"start_sec":10,"end_sec":81,"score":-1,"title":"b","hook_text":"h"}]}')
    c = parse_candidates(raw, 120)
    assert c[0].score == 1.0
    assert c[1].score == 0.0


def test_kandidat_diurutkan_dari_skor_tertinggi():
    raw = ('{"candidates":['
           '{"start_sec":10,"end_sec":80,"score":0.3,"title":"rendah","hook_text":"h"},'
           '{"start_sec":11,"end_sec":81,"score":0.9,"title":"tinggi","hook_text":"h"}]}')
    assert [x.title for x in parse_candidates(raw, 120)] == ["tinggi", "rendah"]


def test_semua_kandidat_tidak_valid_gagal_dengan_LLM_BAD_OUTPUT():
    raw = '{"candidates":[{"start_sec":500,"end_sec":560,"score":0.9,"title":"x","hook_text":"h"}]}'
    with pytest.raises(JobError) as e:
        parse_candidates(raw, duration_sec=120)
    assert e.value.code == "LLM_BAD_OUTPUT"


def test_field_wajib_yang_hilang_membuang_kandidat():
    raw = ('{"candidates":['
           '{"start_sec":10,"end_sec":80,"score":0.9},'
           '{"start_sec":11,"end_sec":81,"score":0.9,"title":"ok","hook_text":"h"}]}')
    assert [x.title for x in parse_candidates(raw, 120)] == ["ok"]
```

- [ ] **Step 3: Jalankan tes untuk memastikan gagal**

Run: `cd apps/downloader && uv run pytest tests/test_prompts.py -v`
Expected: FAIL — `app.prompts.highlights_v1` belum ada.

- [ ] **Step 4: Implementasikan**

`apps/downloader/app/prompts/__init__.py`: (berkas kosong)

`apps/downloader/app/prompts/highlights_v1.py`:
```python
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.errors import JobError
from app.providers.transcription import Word

PROMPT_VERSION = "highlights_v1"

MIN_CLIP_SEC = 30
MAX_CLIP_SEC = 90


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
- Durasi antara {MIN_CLIP_SEC} dan {MAX_CLIP_SEC} detik.

Untuk setiap segmen, tulis juga sebuah hook: satu kalimat pendek berbahasa
Indonesia yang ditampilkan di tiga detik pertama klip untuk menahan penonton.
Hook harus memancing rasa penasaran tanpa mengumbar jawabannya.

Balas HANYA dengan JSON, tanpa penjelasan apa pun di luar JSON, dengan bentuk:

{{"candidates":[
  {{"start_sec":<angka>,"end_sec":<angka>,"score":<0..1>,
    "title":"<judul singkat Bahasa Indonesia>",
    "hook_text":"<hook Bahasa Indonesia>",
    "reason":"<alasan singkat mengapa segmen ini menarik>"}}
]}}

Transkrip:
{_timestamped_transcript(words)}
"""


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)
_TRAILING_COMMA_RE = re.compile(r",\s*([}\]])")


def _extract_json(raw: str) -> object:
    """Menggali objek JSON dari keluaran LLM yang bisa berantakan.

    Diurutkan dari cara paling murah: apa adanya, isi pagar markdown, lalu
    potongan dari kurung pertama sampai terakhir. Koma menggantung dibersihkan
    di setiap percobaan.
    """
    candidates: list[str] = [raw.strip()]

    fenced = _FENCE_RE.search(raw)
    if fenced:
        candidates.append(fenced.group(1).strip())

    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start, end = raw.find(open_ch), raw.rfind(close_ch)
        if start != -1 and end > start:
            candidates.append(raw[start : end + 1])

    for text in candidates:
        for attempt in (text, _TRAILING_COMMA_RE.sub(r"\1", text)):
            try:
                return json.loads(attempt)
            except json.JSONDecodeError:
                continue

    raise JobError("LLM_BAD_OUTPUT", "tidak menemukan JSON pada keluaran LLM", terminal=False)


def _as_float(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def parse_candidates(raw: str, duration_sec: int) -> list[Candidate]:
    data = _extract_json(raw)
    items = data.get("candidates") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise JobError("LLM_BAD_OUTPUT", "keluaran LLM bukan daftar kandidat", terminal=False)

    out: list[Candidate] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        start = _as_float(item.get("start_sec"))
        end = _as_float(item.get("end_sec"))
        score = _as_float(item.get("score"))
        title = item.get("title")
        hook = item.get("hook_text")
        if start is None or end is None or score is None:
            continue
        if not isinstance(title, str) or not title.strip():
            continue
        if not isinstance(hook, str) or not hook.strip():
            continue
        if end <= start:
            continue
        if start < 0 or end > duration_sec:
            continue
        length = end - start
        if length < MIN_CLIP_SEC or length > MAX_CLIP_SEC:
            continue
        reason = item.get("reason")
        out.append(
            Candidate(
                start_sec=start,
                end_sec=end,
                score=max(0.0, min(1.0, score)),
                title=title.strip(),
                hook_text=hook.strip(),
                reason=reason.strip() if isinstance(reason, str) else None,
            )
        )

    if not out:
        raise JobError(
            "LLM_BAD_OUTPUT", "tidak ada kandidat yang lolos validasi", terminal=False
        )
    return sorted(out, key=lambda c: c.score, reverse=True)


def slice_transcript(words: list[Word], start: float, end: float) -> str:
    return " ".join(w.text.strip() for w in words if w.start >= start and w.end <= end).strip()
```

- [ ] **Step 5: Jalankan tes**

Run: `cd apps/downloader && uv run pytest tests/test_prompts.py -v`
Expected: PASS, delapan belas tes lulus.

- [ ] **Step 6: Commit**

```bash
git add apps/downloader
git commit -m "feat(worker): highlight prompt and defensive LLM output parser"
```

---

## Task 6: Adapter LLM dan handler analyze

**Files:**
- Create: `apps/downloader/app/providers/llm.py`, `apps/downloader/app/handlers/analyze.py`
- Create: `apps/downloader/tests/fixtures/llm_gemini_ok.json`, `llm_openai_ok.json`, `llm_anthropic_ok.json`
- Test: `apps/downloader/tests/test_llm.py`, `apps/downloader/tests/test_analyze_handler.py`

**Interfaces:**
- Consumes: `ApiKeyRecord`, `load_api_key` (Task 4); `build_prompt`, `parse_candidates`, `slice_transcript`, `Candidate`, `PROMPT_VERSION` (Task 5)
- Produces:
  - `def call_llm(key: ApiKeyRecord, prompt: str, *, http=None) -> str`
  - `def compute_input_hash(transcript_id: str, prompt_version: str, model: str) -> str`
  - `def handle_analyze(conn, job, *, storage=None, call=...) -> None`; payload `{"source_id": str, "project_id": str}`

- [ ] **Step 1: Buat fixture respons LLM**

`apps/downloader/tests/fixtures/llm_gemini_ok.json`:
```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          { "text": "{\"candidates\":[{\"start_sec\":10,\"end_sec\":80,\"score\":0.92,\"title\":\"Cara berhenti menunda\",\"hook_text\":\"Kebiasaan ini yang bikin kamu stuck\",\"reason\":\"Opini tajam dan langsung bisa dipakai\"}]}" }
        ]
      }
    }
  ]
}
```

`apps/downloader/tests/fixtures/llm_openai_ok.json`:
```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "{\"candidates\":[{\"start_sec\":10,\"end_sec\":80,\"score\":0.92,\"title\":\"Cara berhenti menunda\",\"hook_text\":\"Kebiasaan ini yang bikin kamu stuck\",\"reason\":\"Opini tajam dan langsung bisa dipakai\"}]}"
      }
    }
  ]
}
```

`apps/downloader/tests/fixtures/llm_anthropic_ok.json`:
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"candidates\":[{\"start_sec\":10,\"end_sec\":80,\"score\":0.92,\"title\":\"Cara berhenti menunda\",\"hook_text\":\"Kebiasaan ini yang bikin kamu stuck\",\"reason\":\"Opini tajam dan langsung bisa dipakai\"}]}"
    }
  ]
}
```

- [ ] **Step 2: Tulis tes yang gagal**

`apps/downloader/tests/test_llm.py`:
```python
import json
from pathlib import Path

import httpx
import pytest

from app.crypto import ApiKeyRecord
from app.errors import JobError
from app.providers.llm import call_llm

FIXTURES = Path(__file__).parent / "fixtures"


def _key(provider: str, base_url: str | None = None) -> ApiKeyRecord:
    return ApiKeyRecord(
        id="k1", provider=provider, base_url=base_url, model="model-x", secret="RAHASIA-KEY-999"
    )


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.mark.parametrize(
    "provider,fixture",
    [
        ("gemini", "llm_gemini_ok.json"),
        ("openai_compat", "llm_openai_ok.json"),
        ("anthropic_compat", "llm_anthropic_ok.json"),
    ],
)
def test_call_llm_mengekstrak_teks_dari_tiap_bentuk_respons(provider, fixture):
    body = json.loads((FIXTURES / fixture).read_text())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    text = call_llm(_key(provider, "https://contoh.test/v1"), "prompt", http=_client(handler))
    assert "Cara berhenti menunda" in text


def test_openai_compat_memakai_base_url_milik_user():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json=json.loads((FIXTURES / "llm_openai_ok.json").read_text()))

    call_llm(_key("openai_compat", "https://proxy.saya.test/v1"), "p", http=_client(handler))
    assert seen == ["https://proxy.saya.test/v1/chat/completions"]


def test_openai_compat_tanpa_base_url_ditolak():
    with pytest.raises(JobError) as e:
        call_llm(_key("openai_compat", None), "p", http=_client(lambda r: httpx.Response(200)))
    assert e.value.code == "BYOK_INVALID"
    assert e.value.terminal is True


@pytest.mark.parametrize("status", [401, 403])
def test_status_otentikasi_menjadi_BYOK_INVALID_terminal(status):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text="unauthorized")

    with pytest.raises(JobError) as e:
        call_llm(_key("gemini"), "p", http=_client(handler))
    assert e.value.code == "BYOK_INVALID"
    assert e.value.terminal is True


def test_kuota_habis_menjadi_BYOK_INVALID_terminal():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="quota exceeded")

    with pytest.raises(JobError) as e:
        call_llm(_key("gemini"), "p", http=_client(handler))
    assert e.value.code == "BYOK_INVALID"
    assert e.value.terminal is True


def test_kegagalan_server_dicoba_ulang():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    with pytest.raises(JobError) as e:
        call_llm(_key("gemini"), "p", http=_client(handler))
    assert e.value.terminal is False


def test_api_key_tidak_pernah_muncul_di_pesan_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="key RAHASIA-KEY-999 ditolak")

    with pytest.raises(JobError) as e:
        call_llm(_key("gemini"), "p", http=_client(handler))
    assert "RAHASIA-KEY-999" not in str(e.value)


def test_respons_tanpa_teks_gagal_LLM_BAD_OUTPUT():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": []})

    with pytest.raises(JobError) as e:
        call_llm(_key("openai_compat", "https://x.test/v1"), "p", http=_client(handler))
    assert e.value.code == "LLM_BAD_OUTPUT"
```

`apps/downloader/tests/test_analyze_handler.py`:
```python
import json
from unittest.mock import MagicMock

import pytest

from app.errors import JobError
from app.handlers.analyze import handle_analyze
from app.queue import Job

LLM_OUTPUT = json.dumps({
    "candidates": [
        {"start_sec": 10, "end_sec": 80, "score": 0.9, "title": "Satu",
         "hook_text": "Hook satu", "reason": "Alasan"},
        {"start_sec": 100, "end_sec": 170, "score": 0.7, "title": "Dua",
         "hook_text": "Hook dua", "reason": "Alasan"},
    ]
})

TRANSCRIPT = {
    "language": "id",
    "text": "...",
    "provider": "deepinfra",
    "model": "whisper-large-v3-turbo",
    "words": (
        [{"text": "kata", "start": float(i), "end": float(i) + 0.4} for i in range(0, 200)]
    ),
}


def _setup(conn) -> tuple[str, str, str]:
    uid = conn.execute(
        "insert into auth.users (email) values ('a@test.id') returning id"
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    sid = conn.execute(
        """
        insert into sources (kind, external_id, is_public, url_original, status, duration_sec)
        values ('youtube', 'analisis001', true, 'https://youtu.be/x', 'ready', 300)
        returning id"""
    ).fetchone()[0]
    conn.execute(
        """insert into transcripts (source_id, provider, model, language, r2_key, word_count)
           values (%s, 'deepinfra', 'whisper-large-v3-turbo', 'id', 'transcripts/t.json', 200)""",
        (sid,),
    )
    pid = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'p') returning id",
        (uid, sid),
    ).fetchone()[0]
    conn.execute(
        """insert into api_keys (user_id, provider, label, base_url, model,
                                 encrypted_key, key_iv, key_tag)
           values (%s, 'gemini', 'utama', null, 'gemini-2.5-flash', 'e', 'i', 't')""",
        (uid,),
    )
    conn.commit()
    return str(uid), str(sid), str(pid)


@pytest.fixture
def deps(tmp_path, monkeypatch):
    from app.crypto import ApiKeyRecord

    storage = MagicMock()
    storage.get_bytes.return_value = json.dumps(TRANSCRIPT).encode()
    monkeypatch.setattr(
        "app.handlers.analyze.load_api_key",
        lambda conn, uid, provider=None: ApiKeyRecord("k", "gemini", None, "gemini-2.5-flash", "s"),
    )
    return {"storage": storage, "call": lambda key, prompt, http=None: LLM_OUTPUT}


def test_menulis_kandidat_dan_mencatat_llm_run(conn, deps):
    uid, sid, pid = _setup(conn)
    handle_analyze(conn, Job("j1", "analyze", {"source_id": sid, "project_id": pid}, 1, 3, pid, uid), **deps)

    rows = conn.execute(
        "select title, hook_text, start_sec, end_sec, score, transcript_slice "
        "from clip_candidates where project_id = %s order by score desc", (pid,)
    ).fetchall()
    assert [r[0] for r in rows] == ["Satu", "Dua"]
    assert rows[0][1] == "Hook satu"
    assert float(rows[0][2]) == 10.0
    assert rows[0][5]  # potongan transkrip terisi

    run = conn.execute(
        "select provider, model, prompt_version, input_hash from llm_runs where source_id = %s",
        (sid,),
    ).fetchone()
    assert run[0] == "gemini"
    assert run[2] == "highlights_v1"
    assert len(run[3]) == 64


def test_kandidat_terhubung_ke_llm_run(conn, deps):
    uid, sid, pid = _setup(conn)
    handle_analyze(conn, Job("j2", "analyze", {"source_id": sid, "project_id": pid}, 1, 3, pid, uid), **deps)
    n = conn.execute(
        "select count(*) from clip_candidates c join llm_runs r on r.id = c.llm_run_id "
        "where c.project_id = %s", (pid,)
    ).fetchone()[0]
    assert n == 2


def test_cache_hit_tidak_memanggil_llm_lagi(conn, deps):
    uid, sid, pid = _setup(conn)
    handle_analyze(conn, Job("j3", "analyze", {"source_id": sid, "project_id": pid}, 1, 3, pid, uid), **deps)

    pid2 = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'p2') returning id",
        (uid, sid),
    ).fetchone()[0]
    conn.commit()

    calls = []
    deps["call"] = lambda key, prompt, http=None: calls.append(1) or LLM_OUTPUT
    handle_analyze(conn, Job("j4", "analyze", {"source_id": sid, "project_id": str(pid2)}, 1, 3, str(pid2), uid), **deps)

    assert calls == []
    assert conn.execute(
        "select count(*) from clip_candidates where project_id = %s", (pid2,)
    ).fetchone()[0] == 2
    assert conn.execute("select count(*) from llm_runs where source_id = %s", (sid,)).fetchone()[0] == 1


def test_transkrip_belum_ada_ditolak_terminal(conn, deps):
    uid, sid, pid = _setup(conn)
    conn.execute("delete from transcripts where source_id = %s", (sid,))
    conn.commit()
    with pytest.raises(JobError) as e:
        handle_analyze(conn, Job("j5", "analyze", {"source_id": sid, "project_id": pid}, 1, 3, pid, uid), **deps)
    assert e.value.terminal is True


def test_keluaran_llm_cacat_tidak_menulis_apa_pun(conn, deps):
    uid, sid, pid = _setup(conn)
    deps["call"] = lambda key, prompt, http=None: "maaf saya tidak bisa"
    with pytest.raises(JobError) as e:
        handle_analyze(conn, Job("j6", "analyze", {"source_id": sid, "project_id": pid}, 1, 3, pid, uid), **deps)
    assert e.value.code == "LLM_BAD_OUTPUT"
    assert conn.execute(
        "select count(*) from clip_candidates where project_id = %s", (pid,)
    ).fetchone()[0] == 0
    assert conn.execute("select count(*) from llm_runs where source_id = %s", (sid,)).fetchone()[0] == 0
```

- [ ] **Step 3: Jalankan tes untuk memastikan gagal**

Run: `cd apps/downloader && uv run pytest tests/test_llm.py tests/test_analyze_handler.py -v`
Expected: FAIL — modul belum ada.

- [ ] **Step 4: Tambahkan `get_bytes` ke Storage**

Tambahkan ke `apps/downloader/app/storage.py`:
```python
    def get_bytes(self, key: str) -> bytes:
        return self._s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
```

- [ ] **Step 5: Implementasikan adapter LLM**

`apps/downloader/app/providers/llm.py`:
```python
from __future__ import annotations

from typing import Any

import httpx

from app.crypto import ApiKeyRecord
from app.errors import JobError

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
ANTHROPIC_BASE = "https://api.anthropic.com/v1"
MAX_OUTPUT_TOKENS = 8192


def _request(key: ApiKeyRecord, prompt: str) -> tuple[str, dict[str, str], dict[str, Any]]:
    """Menyusun URL, header, dan body untuk provider yang dipilih user."""
    if key.provider == "gemini":
        base = (key.base_url or GEMINI_BASE).rstrip("/")
        return (
            f"{base}/models/{key.model}:generateContent",
            {"x-goog-api-key": key.secret, "content-type": "application/json"},
            {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.4,
                    "maxOutputTokens": MAX_OUTPUT_TOKENS,
                    "responseMimeType": "application/json",
                },
            },
        )

    if key.provider == "openai_compat":
        if not key.base_url:
            raise JobError("BYOK_INVALID", "base_url wajib diisi untuk openai_compat", terminal=True)
        return (
            f"{key.base_url.rstrip('/')}/chat/completions",
            {"authorization": f"Bearer {key.secret}", "content-type": "application/json"},
            {
                "model": key.model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.4,
                "max_tokens": MAX_OUTPUT_TOKENS,
                "response_format": {"type": "json_object"},
            },
        )

    if key.provider == "anthropic_compat":
        base = (key.base_url or ANTHROPIC_BASE).rstrip("/")
        return (
            f"{base}/messages",
            {
                "x-api-key": key.secret,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            {
                "model": key.model,
                "max_tokens": MAX_OUTPUT_TOKENS,
                "temperature": 0.4,
                "messages": [{"role": "user", "content": prompt}],
            },
        )

    raise JobError("BYOK_INVALID", f"provider tidak dikenal: {key.provider}", terminal=True)


def _extract_text(provider: str, body: dict[str, Any]) -> str:
    try:
        if provider == "gemini":
            return body["candidates"][0]["content"]["parts"][0]["text"]
        if provider == "openai_compat":
            return body["choices"][0]["message"]["content"]
        if provider == "anthropic_compat":
            return "".join(
                block["text"] for block in body["content"] if block.get("type") == "text"
            )
    except (KeyError, IndexError, TypeError):
        pass
    raise JobError("LLM_BAD_OUTPUT", f"respons {provider} tidak memuat teks", terminal=False)


def call_llm(key: ApiKeyRecord, prompt: str, *, http: httpx.Client | None = None) -> str:
    """Memanggil provider LLM milik user dan mengembalikan teks mentahnya.

    Badan respons error sengaja tidak pernah disertakan ke pesan exception:
    sebagian gateway memantulkan kembali kredensial di dalamnya.
    """
    url, headers, payload = _request(key, prompt)
    client = http or httpx.Client(timeout=180)
    resp = client.post(url, headers=headers, json=payload, timeout=180)

    if resp.status_code in (401, 403, 429):
        raise JobError(
            "BYOK_INVALID",
            f"provider {key.provider} menolak kredensial (HTTP {resp.status_code})",
            terminal=True,
        )
    if resp.status_code != 200:
        raise JobError(
            "LLM_BAD_OUTPUT",
            f"provider {key.provider} membalas HTTP {resp.status_code}",
            terminal=False,
        )
    return _extract_text(key.provider, resp.json())
```

- [ ] **Step 6: Implementasikan handler analyze**

`apps/downloader/app/handlers/analyze.py`:
```python
from __future__ import annotations

import hashlib
import json
from typing import Any, Callable

import psycopg

from app.crypto import ApiKeyRecord, load_api_key
from app.errors import JobError
from app.prompts.highlights_v1 import (
    PROMPT_VERSION,
    Candidate,
    build_prompt,
    parse_candidates,
    slice_transcript,
)
from app.providers.llm import call_llm as _call_llm
from app.providers.transcription import Word
from app.queue import Job, heartbeat
from app.storage import Storage, storage_from_env


def compute_input_hash(transcript_id: str, prompt_version: str, model: str) -> str:
    """Kunci cache analisis (spec §7 langkah 3). Transkrip, prompt, dan model
    yang sama selalu menghasilkan kunci yang sama, sehingga user kedua pada
    video publik yang sama tidak membayar apa pun."""
    return hashlib.sha256(
        "|".join([transcript_id, prompt_version, model]).encode("utf-8")
    ).hexdigest()


def _write_candidates(
    conn: psycopg.Connection,
    project_id: str,
    llm_run_id: str,
    candidates: list[Candidate],
    words: list[Word],
) -> None:
    for c in candidates:
        conn.execute(
            """
            insert into clip_candidates (project_id, llm_run_id, start_sec, end_sec,
                                         score, title, hook_text, reason, transcript_slice)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (project_id, llm_run_id, c.start_sec, c.end_sec, c.score, c.title,
             c.hook_text, c.reason, slice_transcript(words, c.start_sec, c.end_sec)),
        )
    conn.commit()


def _candidates_from_output(output: dict[str, Any], duration_sec: int) -> list[Candidate]:
    return parse_candidates(json.dumps(output), duration_sec)


def handle_analyze(
    conn: psycopg.Connection,
    job: Job,
    *,
    storage: Storage | None = None,
    call: Callable[..., str] = _call_llm,
) -> None:
    storage = storage or storage_from_env()
    source_id: str = job.payload["source_id"]
    project_id: str = job.payload["project_id"]

    src = conn.execute(
        "select duration_sec from sources where id = %s", (source_id,)
    ).fetchone()
    if src is None:
        raise JobError("INTERNAL", f"source {source_id} tidak ditemukan", terminal=True)
    duration_sec = int(src[0] or 0)

    tr = conn.execute(
        "select id, r2_key, model from transcripts where source_id = %s limit 1", (source_id,)
    ).fetchone()
    if tr is None:
        raise JobError("INTERNAL", "transkrip belum tersedia", terminal=True)
    transcript_id, transcript_key = str(tr[0]), tr[1]

    heartbeat(conn, job.id, 10)
    body = json.loads(storage.get_bytes(transcript_key).decode("utf-8"))
    words = [Word(w["text"], float(w["start"]), float(w["end"])) for w in body["words"]]

    key: ApiKeyRecord = load_api_key(conn, job.user_id or "")
    input_hash = compute_input_hash(transcript_id, PROMPT_VERSION, key.model)

    # Cache lapis LLM (spec §8). Cakupannya mengikuti sumber, sehingga hasil
    # pada sumber publik dapat dipakai bersama tanpa membocorkan sumber privat.
    cached = conn.execute(
        "select id, output from llm_runs where input_hash = %s", (input_hash,)
    ).fetchone()
    if cached:
        heartbeat(conn, job.id, 90)
        _write_candidates(
            conn, project_id, str(cached[0]),
            _candidates_from_output(cached[1], duration_sec), words,
        )
        return

    heartbeat(conn, job.id, 30)
    raw = call(key, build_prompt(words, duration_sec))

    heartbeat(conn, job.id, 70)
    candidates = parse_candidates(raw, duration_sec)  # melempar LLM_BAD_OUTPUT

    output = {
        "candidates": [
            {
                "start_sec": c.start_sec, "end_sec": c.end_sec, "score": c.score,
                "title": c.title, "hook_text": c.hook_text, "reason": c.reason,
            }
            for c in candidates
        ]
    }
    run = conn.execute(
        """
        insert into llm_runs (source_id, provider, model, prompt_version, input_hash, output)
        values (%s, %s, %s, %s, %s, %s::jsonb)
        on conflict (input_hash) do update set updated_at = now()
        returning id
        """,
        (source_id, key.provider, key.model, PROMPT_VERSION, input_hash, json.dumps(output)),
    ).fetchone()
    conn.commit()

    _write_candidates(conn, project_id, str(run[0]), candidates, words)
```

- [ ] **Step 7: Rantaikan transcribe ke analyze**

Di akhir `handle_transcribe` (`apps/downloader/app/handlers/transcribe.py`), setelah `conn.commit()`, tambahkan — dan juga pada jalur cache hit sebelum `return`:
```python
    from app.queue import enqueue

    enqueue(
        conn, "analyze",
        {"source_id": source_id, "project_id": job.payload["project_id"]},
        user_id=job.user_id, project_id=job.payload["project_id"],
    )
```

- [ ] **Step 8: Jalankan tes**

Run: `cd apps/downloader && uv run pytest tests/test_llm.py tests/test_analyze_handler.py -v`
Expected: PASS, delapan belas tes lulus.

- [ ] **Step 9: Commit**

```bash
git add apps/downloader
git commit -m "feat(worker): BYOK LLM adapter and analyze handler with run-level cache"
```

---

## Task 7: Handler fetch_segments

Fase 2 dari download dua fase. Menghemat sekitar 85% bandwidth karena hanya rentang terpilih yang diunduh.

**Files:**
- Create: `apps/downloader/app/handlers/fetch_segments.py`
- Modify: `apps/downloader/app/ytdlp.py` (tambah `download_section`)
- Modify: `apps/downloader/app/worker.py` (lengkapi registry handler)
- Test: `apps/downloader/tests/test_fetch_segments.py`

**Interfaces:**
- Consumes: `Storage`, `sha256_file`, `heartbeat`
- Produces:
  - `def download_section(url: str, start: float, end: float, dest: Path) -> Path`
  - `def handle_fetch_segments(conn, job, *, storage=None, download=..., workdir=None) -> None`; payload `{"source_id": str, "project_id": str, "ranges": [{"start_sec": float, "end_sec": float}]}`

- [ ] **Step 1: Tulis tes yang gagal**

`apps/downloader/tests/test_fetch_segments.py`:
```python
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.handlers.fetch_segments import SEGMENT_TTL_DAYS, handle_fetch_segments
from app.queue import Job


def _source(conn) -> str:
    sid = conn.execute(
        """
        insert into sources (kind, external_id, is_public, url_original, status, duration_sec)
        values ('youtube', 'segmen0001', true, 'https://youtu.be/x', 'ready', 600)
        returning id"""
    ).fetchone()[0]
    conn.commit()
    return str(sid)


def _project(conn, sid: str) -> str:
    uid = conn.execute(
        "insert into auth.users (email) values ('s@test.id') returning id"
    ).fetchone()[0]
    conn.execute("insert into profiles (user_id) values (%s)", (uid,))
    pid = conn.execute(
        "insert into projects (user_id, source_id, title) values (%s, %s, 'p') returning id",
        (uid, sid),
    ).fetchone()[0]
    conn.commit()
    return str(pid)


@pytest.fixture
def deps(tmp_path):
    storage = MagicMock()
    storage.exists.return_value = False
    calls = []

    def download(url, start, end, dest: Path):
        calls.append((start, end))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"video palsu")
        return dest

    return {"storage": storage, "download": download, "workdir": tmp_path, "_calls": calls}


def _job(sid: str, pid: str, ranges: list[dict]) -> Job:
    return Job("j", "fetch_segments",
               {"source_id": sid, "project_id": pid, "ranges": ranges}, 1, 3, pid, None)


def test_mengunduh_setiap_rentang_dan_mencatatnya(conn, deps):
    sid = _source(conn)
    pid = _project(conn, sid)
    ranges = [{"start_sec": 10, "end_sec": 80}, {"start_sec": 100, "end_sec": 170}]

    handle_fetch_segments(conn, _job(sid, pid, ranges),
                          **{k: v for k, v in deps.items() if not k.startswith("_")})

    assert deps["_calls"] == [(10.0, 80.0), (100.0, 170.0)]
    rows = conn.execute(
        "select start_sec, end_sec, r2_key, expires_at from media_segments "
        "where source_id = %s order by start_sec", (sid,)
    ).fetchall()
    assert len(rows) == 2
    assert rows[0][2].startswith("segments/")
    assert rows[0][3] > datetime.now(timezone.utc) + timedelta(days=SEGMENT_TTL_DAYS - 1)


def test_rentang_yang_sudah_ada_tidak_diunduh_ulang(conn, deps):
    sid = _source(conn)
    pid = _project(conn, sid)
    ranges = [{"start_sec": 10, "end_sec": 80}]

    clean = {k: v for k, v in deps.items() if not k.startswith("_")}
    handle_fetch_segments(conn, _job(sid, pid, ranges), **clean)
    handle_fetch_segments(conn, _job(sid, pid, ranges), **clean)

    assert deps["_calls"] == [(10.0, 80.0)]
    assert conn.execute(
        "select count(*) from media_segments where source_id = %s", (sid,)
    ).fetchone()[0] == 1


def test_rentang_di_luar_durasi_ditolak(conn, deps):
    from app.errors import JobError

    sid = _source(conn)
    pid = _project(conn, sid)
    clean = {k: v for k, v in deps.items() if not k.startswith("_")}

    with pytest.raises(JobError) as e:
        handle_fetch_segments(conn, _job(sid, pid, [{"start_sec": 500, "end_sec": 900}]), **clean)
    assert e.value.terminal is True
    assert deps["_calls"] == []


def test_daftar_rentang_kosong_ditolak(conn, deps):
    from app.errors import JobError

    sid = _source(conn)
    pid = _project(conn, sid)
    clean = {k: v for k, v in deps.items() if not k.startswith("_")}

    with pytest.raises(JobError) as e:
        handle_fetch_segments(conn, _job(sid, pid, []), **clean)
    assert e.value.terminal is True
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `cd apps/downloader && uv run pytest tests/test_fetch_segments.py -v`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Tambahkan `download_section` ke ytdlp**

Tambahkan ke `apps/downloader/app/ytdlp.py`:
```python
def download_section(url: str, start: float, end: float, dest: Path) -> Path:
    """Mengunduh satu rentang waktu saja (fase 2, spec §3.1).

    --force-keyframes-at-cuts memaksa yt-dlp memotong tepat di batas yang
    diminta alih-alih di keyframe terdekat, sehingga awal klip tidak meleset.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = _run([
        "yt-dlp",
        "--download-sections", f"*{start:.3f}-{end:.3f}",
        "--force-keyframes-at-cuts",
        "-f", "bestvideo[height<=1080][vcodec^=avc1]+bestaudio/best[height<=1080]",
        "--merge-output-format", "mp4",
        "--no-playlist", "--no-warnings",
        "-o", str(dest), url,
    ])
    if proc.returncode != 0:
        raise classify_ytdlp_error(proc.stderr)
    if not dest.exists():
        raise JobError("INTERNAL", "yt-dlp selesai tanpa menghasilkan segmen")
    return dest
```

Format sengaja dibatasi ke H.264 (`avc1`) tinggi maksimal 1080p karena WebCodecs di browser mendekode H.264 secara hardware di seluruh platform, sementara AV1 belum merata. Ini menghindari transcoding di server.

- [ ] **Step 4: Implementasikan handler**

`apps/downloader/app/handlers/fetch_segments.py`:
```python
from __future__ import annotations

import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import psycopg

from app.errors import JobError
from app.ffmpeg import sha256_file
from app.queue import Job, heartbeat
from app.storage import Storage, storage_from_env
from app.ytdlp import download_section as _download_section

SEGMENT_TTL_DAYS = 7  # Spec §8.2


def handle_fetch_segments(
    conn: psycopg.Connection,
    job: Job,
    *,
    storage: Storage | None = None,
    download: Callable[..., Path] = _download_section,
    workdir: Path | None = None,
) -> None:
    storage = storage or storage_from_env()
    source_id: str = job.payload["source_id"]
    ranges = job.payload.get("ranges") or []
    if not ranges:
        raise JobError("INTERNAL", "daftar rentang kosong", terminal=True)

    row = conn.execute(
        "select url_original, duration_sec from sources where id = %s", (source_id,)
    ).fetchone()
    if row is None:
        raise JobError("INTERNAL", f"source {source_id} tidak ditemukan", terminal=True)
    url, duration_sec = row[0], int(row[1] or 0)

    for r in ranges:
        start, end = float(r["start_sec"]), float(r["end_sec"])
        if end <= start or start < 0 or (duration_sec and end > duration_sec):
            raise JobError(
                "INTERNAL", f"rentang {start}-{end} di luar durasi {duration_sec}", terminal=True
            )

    tmp_root = workdir or Path(tempfile.mkdtemp(prefix="cc-segments-"))
    total = len(ranges)

    for i, r in enumerate(ranges):
        start, end = float(r["start_sec"]), float(r["end_sec"])

        existing = conn.execute(
            "select id from media_segments where source_id = %s and start_sec = %s and end_sec = %s",
            (source_id, start, end),
        ).fetchone()
        if existing:
            heartbeat(conn, job.id, (i + 1) * 100 // total)
            continue

        dest = tmp_root / f"{source_id}-{start:.0f}-{end:.0f}.mp4"
        download(url, start, end, dest)
        digest = sha256_file(dest)
        key = f"segments/{digest}.mp4"

        if not storage.exists(key):
            storage.put_file(key, dest, "video/mp4")

        conn.execute(
            """
            insert into media_segments (source_id, start_sec, end_sec, r2_key, bytes, expires_at)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (source_id, start_sec, end_sec) do nothing
            """,
            (source_id, start, end, key, dest.stat().st_size,
             datetime.now(timezone.utc) + timedelta(days=SEGMENT_TTL_DAYS)),
        )
        conn.commit()
        heartbeat(conn, job.id, (i + 1) * 100 // total)
```

- [ ] **Step 5: Lengkapi registry handler di worker**

Di `apps/downloader/app/worker.py`, fungsi `main`, gunakan registry lengkap:
```python
    from app.handlers.analyze import handle_analyze
    from app.handlers.fetch_segments import handle_fetch_segments
    from app.handlers.ingest import handle_ingest
    from app.handlers.transcribe import handle_transcribe

    handlers: dict[str, Handler] = {
        "ingest": handle_ingest,
        "transcribe": handle_transcribe,
        "analyze": handle_analyze,
        "fetch_segments": handle_fetch_segments,
    }
```

- [ ] **Step 6: Jalankan seluruh tes worker**

Run: `cd apps/downloader && uv run pytest -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/downloader
git commit -m "feat(worker): ranged segment fetching with per-range cache"
```

---

## Task 8: Web — pengelolaan API key BYOK

**Files:**
- Create: `apps/web/lib/apiKeys.ts`, `apps/web/app/api/keys/route.ts`, `apps/web/app/api/keys/[id]/route.ts`, `apps/web/app/settings/keys/page.tsx`, `apps/web/components/ApiKeyForm.tsx`
- Test: `apps/web/test/apiKeys.test.ts`

**Interfaces:**
- Consumes: `sealApiKey` dari `@klipmatic/db`
- Produces:
  - `async function saveApiKey(sql, userId, input): Promise<{ id: string }>`
  - `async function listApiKeys(sql, userId): Promise<PublicApiKey[]>` — `PublicApiKey` tidak pernah memuat medan kredensial
  - `async function deleteApiKey(sql, userId, id): Promise<boolean>`

- [ ] **Step 1: Tulis tes yang gagal**

`apps/web/test/apiKeys.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from 'vitest'
import type postgres from 'postgres'
import { openApiKey } from '../../../packages/db/src/crypto'
import { freshDb, makeUser } from '../../../packages/db/test/helpers'
import { deleteApiKey, listApiKeys, saveApiKey } from '../lib/apiKeys'

const MASTER = Buffer.alloc(32, 7).toString('base64')
let sql: postgres.Sql
let alice: string
let bob: string

beforeAll(async () => {
  sql = await freshDb()
  alice = await makeUser(sql, 'alice@test.id')
  bob = await makeUser(sql, 'bob@test.id')
})
afterAll(async () => { await sql.end() })

const INPUT = {
  provider: 'openai_compat' as const,
  label: 'Groq saya',
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'llama-3.3-70b-versatile',
  secret: 'gsk_rahasia_sekali_123456',
}

test('menyimpan key dalam bentuk terenkripsi, bukan plaintext', async () => {
  const { id } = await saveApiKey(sql, alice, INPUT, MASTER)
  const [row] = await sql`
    select encrypted_key, key_iv, key_tag from api_keys where id = ${id}`
  expect(row!.encrypted_key).not.toContain('gsk_rahasia')
  expect(openApiKey(
    { encryptedKey: row!.encrypted_key, keyIv: row!.key_iv, keyTag: row!.key_tag },
    MASTER,
  )).toBe(INPUT.secret)
})

test('daftar key tidak pernah memuat medan kredensial', async () => {
  const keys = await listApiKeys(sql, alice)
  expect(keys.length).toBeGreaterThan(0)
  const serialized = JSON.stringify(keys)
  expect(serialized).not.toContain('gsk_rahasia')
  for (const k of keys) {
    expect(Object.keys(k)).toEqual(
      expect.arrayContaining(['id', 'provider', 'label', 'model']),
    )
    expect(Object.keys(k)).not.toContain('encryptedKey')
    expect(Object.keys(k)).not.toContain('secret')
  }
})

test('user hanya melihat key miliknya', async () => {
  await saveApiKey(sql, bob, { ...INPUT, label: 'punya bob' }, MASTER)
  const aliceKeys = await listApiKeys(sql, alice)
  expect(aliceKeys.every((k) => k.label !== 'punya bob')).toBe(true)
})

test('openai_compat tanpa baseUrl ditolak', async () => {
  await expect(
    saveApiKey(sql, alice, { ...INPUT, baseUrl: '' }, MASTER),
  ).rejects.toThrow(/base URL/i)
})

test('secret kosong ditolak', async () => {
  await expect(
    saveApiKey(sql, alice, { ...INPUT, secret: '' }, MASTER),
  ).rejects.toThrow()
})

test('provider tidak dikenal ditolak', async () => {
  await expect(
    saveApiKey(sql, alice, { ...INPUT, provider: 'palsu' as never }, MASTER),
  ).rejects.toThrow(/provider/i)
})

test('menghapus key milik user lain tidak berpengaruh', async () => {
  const { id } = await saveApiKey(sql, alice, { ...INPUT, label: 'target' }, MASTER)
  expect(await deleteApiKey(sql, bob, id)).toBe(false)
  expect(await deleteApiKey(sql, alice, id)).toBe(true)
})
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `bun run test apps/web/test/apiKeys.test.ts`
Expected: FAIL — `lib/apiKeys` belum ada.

- [ ] **Step 3: Implementasikan**

`apps/web/lib/apiKeys.ts`:
```ts
import type { Sql } from 'postgres'
import { sealApiKey } from '@klipmatic/db'

export const PROVIDERS = ['gemini', 'openai_compat', 'anthropic_compat'] as const
export type Provider = (typeof PROVIDERS)[number]

export interface ApiKeyInput {
  provider: Provider
  label: string
  baseUrl: string | null
  model: string
  secret: string
}

/** Bentuk yang aman dikirim ke browser. Sengaja tanpa medan kredensial. */
export interface PublicApiKey {
  id: string
  provider: Provider
  label: string
  baseUrl: string | null
  model: string
  lastUsedAt: string | null
}

export async function saveApiKey(
  sql: Sql,
  userId: string,
  input: ApiKeyInput,
  masterKey = process.env.BYOK_MASTER_KEY!,
): Promise<{ id: string }> {
  if (!PROVIDERS.includes(input.provider)) {
    throw new Error(`Provider tidak dikenal: ${input.provider}`)
  }
  if (!input.secret) throw new Error('API key tidak boleh kosong')
  if (!input.model.trim()) throw new Error('Nama model wajib diisi')
  if (input.provider === 'openai_compat' && !input.baseUrl?.trim()) {
    throw new Error('Base URL wajib diisi untuk provider OpenAI-compatible')
  }

  const sealed = sealApiKey(input.secret, masterKey)
  const [row] = await sql`
    insert into api_keys (user_id, provider, label, base_url, model,
                          encrypted_key, key_iv, key_tag)
    values (${userId}, ${input.provider}, ${input.label},
            ${input.baseUrl || null}, ${input.model},
            ${sealed.encryptedKey}, ${sealed.keyIv}, ${sealed.keyTag})
    returning id
  `
  return { id: row!.id as string }
}

export async function listApiKeys(sql: Sql, userId: string): Promise<PublicApiKey[]> {
  const rows = await sql`
    select id, provider, label, base_url, model, last_used_at
      from api_keys where user_id = ${userId}
     order by created_at desc
  `
  return rows.map((r) => ({
    id: r.id as string,
    provider: r.provider as Provider,
    label: r.label as string,
    baseUrl: (r.base_url as string | null) ?? null,
    model: r.model as string,
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
  }))
}

export async function deleteApiKey(sql: Sql, userId: string, id: string): Promise<boolean> {
  const rows = await sql`
    delete from api_keys where id = ${id} and user_id = ${userId} returning id`
  return rows.length > 0
}
```

- [ ] **Step 4: Buat route API dan halaman**

`apps/web/app/api/keys/route.ts`:
```ts
import { NextResponse } from 'next/server'
import postgres from 'postgres'
import { listApiKeys, saveApiKey } from '@/lib/apiKeys'
import { supabaseServer } from '@/lib/supabase/server'

const sql = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false })

async function requireUser() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Silakan masuk dulu.' }, { status: 401 })
  return NextResponse.json({ keys: await listApiKeys(sql, user.id) })
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Silakan masuk dulu.' }, { status: 401 })
  try {
    const body = await req.json()
    const result = await saveApiKey(sql, user.id, {
      provider: body.provider,
      label: body.label ?? 'Tanpa nama',
      baseUrl: body.baseUrl ?? null,
      model: body.model ?? '',
      secret: body.secret ?? '',
    })
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    // Pesan validasi aman ditampilkan; ia tidak pernah memuat nilai key.
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
```

`apps/web/app/api/keys/[id]/route.ts`:
```ts
import { NextResponse } from 'next/server'
import postgres from 'postgres'
import { deleteApiKey } from '@/lib/apiKeys'
import { supabaseServer } from '@/lib/supabase/server'

const sql = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false })

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Silakan masuk dulu.' }, { status: 401 })

  const { id } = await ctx.params
  const ok = await deleteApiKey(sql, user.id, id)
  return NextResponse.json({ deleted: ok }, { status: ok ? 200 : 404 })
}
```

`apps/web/components/ApiKeyForm.tsx`:
```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PROVIDERS, type Provider } from '@/lib/apiKeys'

const LABELS: Record<Provider, string> = {
  gemini: 'Google Gemini',
  openai_compat: 'OpenAI-compatible (OpenAI, Groq, OpenRouter, Ollama, ...)',
  anthropic_compat: 'Anthropic-compatible',
}

export function ApiKeyForm() {
  const router = useRouter()
  const [provider, setProvider] = useState<Provider>('gemini')
  const [form, setForm] = useState({ label: '', baseUrl: '', model: '', secret: '' })
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, ...form }),
    })
    if (!res.ok) {
      setError((await res.json()).error ?? 'Gagal menyimpan.')
      return
    }
    setForm({ label: '', baseUrl: '', model: '', secret: '' })
    router.refresh()
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="provider">Provider</label>
      <select
        id="provider"
        value={provider}
        onChange={(e) => setProvider(e.target.value as Provider)}
      >
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>{LABELS[p]}</option>
        ))}
      </select>

      <label htmlFor="label">Nama pengenal</label>
      <input
        id="label" value={form.label} required
        onChange={(e) => setForm({ ...form, label: e.target.value })}
      />

      {provider !== 'gemini' && (
        <>
          <label htmlFor="baseUrl">
            Base URL {provider === 'openai_compat' ? '(wajib)' : '(opsional)'}
          </label>
          <input
            id="baseUrl" value={form.baseUrl}
            placeholder="https://api.groq.com/openai/v1"
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          />
        </>
      )}

      <label htmlFor="model">Nama model</label>
      <input
        id="model" value={form.model} required placeholder="gemini-2.5-flash"
        onChange={(e) => setForm({ ...form, model: e.target.value })}
      />

      <label htmlFor="secret">API key</label>
      <input
        id="secret" type="password" value={form.secret} required autoComplete="off"
        onChange={(e) => setForm({ ...form, secret: e.target.value })}
      />
      <p>Key disimpan terenkripsi dan tidak pernah ditampilkan kembali.</p>

      <button type="submit">Simpan</button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
```

`apps/web/app/settings/keys/page.tsx`:
```tsx
import postgres from 'postgres'
import { ApiKeyForm } from '@/components/ApiKeyForm'
import { listApiKeys } from '@/lib/apiKeys'
import { supabaseServer } from '@/lib/supabase/server'

const sql = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false })

export default async function KeysPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <main><p>Silakan masuk dulu.</p></main>

  const keys = await listApiKeys(sql, user.id)

  return (
    <main>
      <h1>API Key</h1>
      <p>
        Klipmatic memakai API key milikmu sendiri untuk memilih klip menarik,
        sehingga biaya AI-nya kamu yang tentukan.
      </p>

      <h2>Key tersimpan</h2>
      {keys.length === 0 ? (
        <p>Belum ada key. Tambahkan satu di bawah untuk mulai menganalisis video.</p>
      ) : (
        <ul>
          {keys.map((k) => (
            <li key={k.id}>
              <strong>{k.label}</strong> — {k.provider} / {k.model}
              {k.lastUsedAt && <span> (terakhir dipakai {k.lastUsedAt})</span>}
            </li>
          ))}
        </ul>
      )}

      <h2>Tambah key</h2>
      <ApiKeyForm />
    </main>
  )
}
```

- [ ] **Step 5: Jalankan tes**

Run: `bun run test apps/web/test/apiKeys.test.ts`
Expected: PASS, tujuh tes lulus.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): BYOK API key management with encrypted storage"
```

---

## Task 9: Web — halaman kandidat klip

Deliverable akhir P1.

**Files:**
- Create: `apps/web/lib/candidates.ts`, `apps/web/components/CandidateList.tsx`
- Modify: `apps/web/app/projects/[id]/page.tsx`
- Test: `apps/web/test/candidates.test.ts`

**Interfaces:**
- Consumes: tabel `clip_candidates`
- Produces:
  - `interface CandidateView { id, startSec, endSec, score, title, hookText, reason, transcriptSlice }`
  - `async function listCandidates(sql, userId, projectId): Promise<CandidateView[]>`
  - `function formatRange(startSec: number, endSec: number): string`

- [ ] **Step 1: Tulis tes yang gagal**

`apps/web/test/candidates.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from 'vitest'
import type postgres from 'postgres'
import { freshDb, makeUser } from '../../../packages/db/test/helpers'
import { formatRange, listCandidates } from '../lib/candidates'

let sql: postgres.Sql
let alice: string
let bob: string
let projectId: string

beforeAll(async () => {
  sql = await freshDb()
  alice = await makeUser(sql, 'alice@test.id')
  bob = await makeUser(sql, 'bob@test.id')

  const [src] = await sql`
    insert into sources (kind, external_id, is_public, url_original, status, duration_sec)
    values ('youtube', 'kandidat001', true, 'https://youtu.be/x', 'ready', 600)
    returning id`
  const [proj] = await sql`
    insert into projects (user_id, source_id, title)
    values (${alice}, ${src!.id}, 'p') returning id`
  projectId = proj!.id as string

  for (const [score, title] of [[0.5, 'Sedang'], [0.9, 'Tinggi'], [0.2, 'Rendah']] as const) {
    await sql`
      insert into clip_candidates (project_id, start_sec, end_sec, score, title,
                                   hook_text, reason, transcript_slice)
      values (${projectId}, 10, 80, ${score}, ${title}, ${'hook ' + title},
              'alasan', 'potongan transkrip')`
  }
})
afterAll(async () => { await sql.end() })

test('mengembalikan kandidat terurut dari skor tertinggi', async () => {
  const rows = await listCandidates(sql, alice, projectId)
  expect(rows.map((r) => r.title)).toEqual(['Tinggi', 'Sedang', 'Rendah'])
})

test('angka dikembalikan sebagai number, bukan string', async () => {
  const [first] = await listCandidates(sql, alice, projectId)
  expect(typeof first!.score).toBe('number')
  expect(typeof first!.startSec).toBe('number')
  expect(first!.score).toBeCloseTo(0.9)
})

test('user lain tidak mendapat kandidat apa pun', async () => {
  expect(await listCandidates(sql, bob, projectId)).toEqual([])
})

test('proyek tidak dikenal menghasilkan daftar kosong, bukan error', async () => {
  const rows = await listCandidates(sql, alice, '00000000-0000-0000-0000-000000000000')
  expect(rows).toEqual([])
})

test.each([
  [0, 65, '0:00 – 1:05 (65 detik)'],
  [10, 80, '0:10 – 1:20 (70 detik)'],
  [3600, 3665, '60:00 – 61:05 (65 detik)'],
])('formatRange(%i, %i)', (start, end, expected) => {
  expect(formatRange(start, end)).toBe(expected)
})
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `bun run test apps/web/test/candidates.test.ts`
Expected: FAIL — `lib/candidates` belum ada.

- [ ] **Step 3: Implementasikan**

`apps/web/lib/candidates.ts`:
```ts
import type { Sql } from 'postgres'

export interface CandidateView {
  id: string
  startSec: number
  endSec: number
  score: number
  title: string
  hookText: string
  reason: string | null
  transcriptSlice: string
}

/**
 * Filter kepemilikan ditulis eksplisit lewat join ke projects. Route ini
 * memakai koneksi pemilik tabel yang melewati RLS, jadi RLS tidak boleh
 * dijadikan satu-satunya penjaga di jalur ini.
 */
export async function listCandidates(
  sql: Sql,
  userId: string,
  projectId: string,
): Promise<CandidateView[]> {
  const rows = await sql`
    select c.id, c.start_sec, c.end_sec, c.score, c.title, c.hook_text,
           c.reason, c.transcript_slice
      from clip_candidates c
      join projects p on p.id = c.project_id
     where c.project_id = ${projectId} and p.user_id = ${userId}
     order by c.score desc, c.start_sec asc
  `
  return rows.map((r) => ({
    id: r.id as string,
    startSec: Number(r.start_sec),
    endSec: Number(r.end_sec),
    score: Number(r.score),
    title: r.title as string,
    hookText: r.hook_text as string,
    reason: (r.reason as string | null) ?? null,
    transcriptSlice: r.transcript_slice as string,
  }))
}

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatRange(startSec: number, endSec: number): string {
  return `${mmss(startSec)} – ${mmss(endSec)} (${Math.round(endSec - startSec)} detik)`
}
```

`apps/web/components/CandidateList.tsx`:
```tsx
import { type CandidateView, formatRange } from '@/lib/candidates'

export function CandidateList({ candidates }: { candidates: CandidateView[] }) {
  if (candidates.length === 0) {
    return <p>Belum ada kandidat klip. Analisis mungkin masih berjalan.</p>
  }

  return (
    <ol>
      {candidates.map((c) => (
        <li key={c.id}>
          <h3>{c.title}</h3>
          <p><strong>Hook:</strong> {c.hookText}</p>
          <p>{formatRange(c.startSec, c.endSec)} · skor {Math.round(c.score * 100)}</p>
          {c.reason && <p><em>{c.reason}</em></p>}
          <details>
            <summary>Lihat kutipan transkrip</summary>
            <p>{c.transcriptSlice}</p>
          </details>
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 4: Perbarui halaman proyek**

`apps/web/app/projects/[id]/page.tsx`:
```tsx
import postgres from 'postgres'
import { CandidateList } from '@/components/CandidateList'
import { JobProgress } from '@/components/JobProgress'
import { listCandidates } from '@/lib/candidates'
import { supabaseServer } from '@/lib/supabase/server'

const sql = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false })

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ job?: string }>
}) {
  const { id } = await params
  const { job } = await searchParams

  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <main><p>Silakan masuk dulu.</p></main>

  const candidates = await listCandidates(sql, user.id, id)

  return (
    <main>
      <h1>Kandidat klip</h1>
      {job && candidates.length === 0 && <JobProgress jobId={job} />}
      <CandidateList candidates={candidates} />
    </main>
  )
}
```

- [ ] **Step 5: Jalankan seluruh tes**

Run: `bun run test`
Expected: PASS.

Run: `cd apps/downloader && uv run pytest -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): clip candidate list page"
```

---

## Task 10: Healthcheck kanari, lifecycle R2, dan E2E nightly

Spec §9.2 menyebut kerusakan extractor yt-dlp sebagai risiko operasional nomor satu. Tujuannya agar operator tahu sebelum user mengeluh.

**Files:**
- Create: `apps/downloader/scripts/canary.py`
- Create: `apps/downloader/scripts/r2_lifecycle.py`
- Create: `.github/workflows/ci.yml`, `.github/workflows/nightly.yml`
- Test: `apps/downloader/tests/test_canary.py`

**Interfaces:**
- Consumes: `probe` dari P0 Task 8
- Produces:
  - `def run_canary(urls: list[str], probe_fn=...) -> list[CanaryResult]`
  - `@dataclass CanaryResult` dengan `url: str`, `ok: bool`, `error_code: str | None`
  - `def apply_lifecycle(storage) -> None`

- [ ] **Step 1: Tulis tes yang gagal**

`apps/downloader/tests/test_canary.py`:
```python
from app.errors import JobError
from scripts.canary import CanaryResult, run_canary
from app.ytdlp import SourceMeta

META = SourceMeta("judul", "channel", 120, None, "public")


def test_semua_url_sehat():
    results = run_canary(["https://a", "https://b"], probe_fn=lambda url: META)
    assert results == [
        CanaryResult("https://a", True, None),
        CanaryResult("https://b", True, None),
    ]


def test_satu_url_rusak_dilaporkan_tanpa_menghentikan_sisanya():
    def probe(url: str) -> SourceMeta:
        if url == "https://rusak":
            raise JobError("SOURCE_BLOCKED", "diblokir", terminal=False)
        return META

    results = run_canary(["https://rusak", "https://ok"], probe_fn=probe)
    assert results[0].ok is False
    assert results[0].error_code == "SOURCE_BLOCKED"
    assert results[1].ok is True


def test_exception_tak_terduga_dilaporkan_sebagai_INTERNAL():
    def probe(url: str) -> SourceMeta:
        raise RuntimeError("yt-dlp menghilang")

    results = run_canary(["https://x"], probe_fn=probe)
    assert results[0].ok is False
    assert results[0].error_code == "INTERNAL"
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `cd apps/downloader && uv run pytest tests/test_canary.py -v`
Expected: FAIL — `scripts.canary` belum ada.

- [ ] **Step 3: Implementasikan kanari**

`apps/downloader/scripts/__init__.py`: (berkas kosong)

`apps/downloader/scripts/canary.py`:
```python
"""Healthcheck harian untuk extractor yt-dlp (spec §9.2).

Kerusakan extractor adalah risiko operasional nomor satu proyek ini. Skrip ini
memastikan operator mengetahuinya sebelum user melapor.

Pakai:
    uv run python -m scripts.canary
Keluar dengan kode 1 bila ada URL yang gagal, sehingga cron atau CI menandainya.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Callable

from app.errors import JobError
from app.ytdlp import SourceMeta
from app.ytdlp import probe as _probe

# URL publik stabil, satu per platform yang didukung.
CANARY_URLS = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.tiktok.com/@tiktok/video/7106594312292453675",
]


@dataclass(frozen=True)
class CanaryResult:
    url: str
    ok: bool
    error_code: str | None


def run_canary(
    urls: list[str], probe_fn: Callable[[str], SourceMeta] = _probe
) -> list[CanaryResult]:
    results: list[CanaryResult] = []
    for url in urls:
        try:
            probe_fn(url)
            results.append(CanaryResult(url, True, None))
        except JobError as e:
            results.append(CanaryResult(url, False, e.code))
        except Exception:  # noqa: BLE001 — kanari tidak boleh ikut mati
            results.append(CanaryResult(url, False, "INTERNAL"))
    return results


def main() -> int:
    results = run_canary(CANARY_URLS)
    for r in results:
        print(f"{'OK  ' if r.ok else 'GAGAL'} {r.url} {r.error_code or ''}")
    failed = [r for r in results if not r.ok]
    if failed:
        print(f"\n{len(failed)} dari {len(results)} URL kanari gagal. "
              f"Periksa apakah yt-dlp perlu diperbarui.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Implementasikan lifecycle R2**

`apps/downloader/scripts/r2_lifecycle.py`:
```python
"""Menerapkan aturan lifecycle bucket sesuai spec §8.2.

Dijalankan sekali saat penyiapan, dan lagi setiap kali aturannya berubah.
"""

from __future__ import annotations

from app.storage import storage_from_env

RULES = {
    "Rules": [
        {
            "ID": "audio-30-hari",
            "Filter": {"Prefix": "audio/"},
            "Status": "Enabled",
            "Expiration": {"Days": 30},
        },
        {
            "ID": "segmen-7-hari",
            "Filter": {"Prefix": "segments/"},
            "Status": "Enabled",
            "Expiration": {"Days": 7},
        },
        # transcripts/ sengaja tidak punya aturan kedaluwarsa: ukurannya kecil
        # dan ia adalah lapis cache paling berharga.
    ]
}


def main() -> None:
    storage = storage_from_env()
    storage._s3.put_bucket_lifecycle_configuration(  # noqa: SLF001
        Bucket=storage.bucket, LifecycleConfiguration=RULES
    )
    print(f"aturan lifecycle diterapkan ke bucket {storage.bucket}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Buat workflow CI**

`.github/workflows/ci.yml`:
```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: klipmatic
        ports: ["55432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 2s --health-retries 15
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with: { bun-version: latest }
      - run: bun install
      - run: bun run test

      - uses: astral-sh/setup-uv@v4
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg
      - run: uv sync
        working-directory: apps/downloader
      - run: uv run pytest -v
        working-directory: apps/downloader
        env:
          TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:55432/klipmatic
```

Tes storage otomatis dilewati di CI karena `R2_ENDPOINT` tidak diset, sesuai penjaga `pytest.mark.skipif` di P0 Task 9.

`.github/workflows/nightly.yml`:
```yaml
name: Nightly

# Dipisahkan dari CI karena menyentuh jaringan dan karenanya tidak stabil.
# Kegagalan di sini adalah sinyal operasional, bukan penghalang merge.
on:
  schedule: [{ cron: '0 21 * * *' }]   # 04:00 WIB
  workflow_dispatch:

jobs:
  canary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
      - run: uv sync
        working-directory: apps/downloader
      - name: Healthcheck extractor yt-dlp
        run: uv run python -m scripts.canary
        working-directory: apps/downloader
```

- [ ] **Step 6: Jalankan tes**

Run: `cd apps/downloader && uv run pytest tests/test_canary.py -v`
Expected: PASS, tiga tes lulus.

- [ ] **Step 7: Verifikasi manual end-to-end**

1. Terapkan lifecycle: `cd apps/downloader && uv run python -m scripts.r2_lifecycle`
2. Jalankan kanari: `uv run python -m scripts.canary` — kedua URL harus OK
3. Jalankan web dan worker
4. Simpan satu API key di `/settings/keys`
5. Tempel URL podcast Bahasa Indonesia berdurasi kira-kira satu jam
6. Amati progress berjalan melewati ingest, transcribe, dan analyze
7. Konfirmasi sepuluh kandidat klip muncul dalam waktu di bawah tiga menit
8. Baca kutipan transkrip pada tiga kandidat teratas — pastikan Bahasa Indonesianya layak pakai
9. Dari akun kedua, tempel URL yang sama — kandidat harus muncul dalam sepuluh detik tanpa panggilan API baru

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ops): yt-dlp canary healthcheck, R2 lifecycle rules, and CI workflows"
```

---

## Definition of Done — P1

- [ ] `bun run test` lulus di seluruh workspace
- [ ] `cd apps/downloader && uv run pytest` lulus
- [ ] ADR 0001 terisi dengan hasil pengukuran nyata, dan konstanta `PRIMARY` mengikutinya
- [ ] Tes interop kripto membuktikan Python dapat membuka segel yang dibuat TypeScript
- [ ] Parser LLM lulus seluruh fixture keluaran cacat
- [ ] Tidak ada plaintext API key yang muncul di log, pesan error, maupun respons API
- [ ] Verifikasi manual Task 10 Step 7 berhasil, termasuk cache hit oleh user kedua
- [ ] Kualitas transkrip Bahasa Indonesia diverifikasi manual pada tiga video uji (spec §12)

---

## Setelah P1

Deliverable P1 adalah daftar kandidat klip — belum ada berkas video yang dihasilkan. Ini disengaja: bagian tersulit dan paling menentukan, yaitu kualitas pemilihan segmen, diverifikasi lebih dulu.

Sebelum menulis rencana P2 (engine browser dan Editor A), lakukan verifikasi kualitatif pada lima sampai sepuluh video Indonesia yang nyata dan jawab pertanyaan ini: **apakah kandidat yang dipilih memang menarik?** Bila belum, perbaikannya ada di prompt dan pemilihan model, bukan di engine rendering. Memperbaikinya sekarang jauh lebih murah daripada setelah empat minggu membangun engine browser.
