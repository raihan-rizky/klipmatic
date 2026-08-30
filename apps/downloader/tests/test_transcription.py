import json
import logging
from pathlib import Path
from typing import ClassVar

import httpx
import pytest

from app.errors import JobError
from app.providers.transcription import (
    ProviderConfig,
    TranscriptResult,
    cache_model,
    estimate_cost,
    load_providers,
    parse_response,
    transcribe,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("TRANSCRIBE_PROVIDERS", "deepinfra,groq")
    monkeypatch.setenv("TRANSCRIBE_DEEPINFRA_URL", "https://deepinfra.test/v1/audio")
    monkeypatch.setenv("TRANSCRIBE_DEEPINFRA_KEY", "RAHASIA-DEEPINFRA-123")
    monkeypatch.setenv("TRANSCRIBE_DEEPINFRA_MODEL", "openai/whisper-large-v3-turbo")
    monkeypatch.setenv("TRANSCRIBE_DEEPINFRA_USD_PER_MIN", "0.0002")
    monkeypatch.setenv("TRANSCRIBE_GROQ_URL", "https://groq.test/v1/audio")
    monkeypatch.setenv("TRANSCRIBE_GROQ_KEY", "RAHASIA-GROQ-456")
    monkeypatch.setenv("TRANSCRIBE_GROQ_MODEL", "whisper-large-v3-turbo")
    monkeypatch.setenv("TRANSCRIBE_GROQ_USD_PER_MIN", "0.0006")
    monkeypatch.setenv("TRANSCRIBE_CACHE_MODEL", "whisper-large-v3-turbo")


# --- konfigurasi ---------------------------------------------------------


def test_load_providers_membaca_urutan_dari_env(env):
    got = load_providers()
    assert [p.name for p in got] == ["deepinfra", "groq"]
    assert got[0].url == "https://deepinfra.test/v1/audio"
    assert got[0].model == "openai/whisper-large-v3-turbo"
    assert got[0].usd_per_min == 0.0002


def test_urutan_provider_dapat_dibalik_tanpa_ubah_kode(env, monkeypatch):
    monkeypatch.setenv("TRANSCRIBE_PROVIDERS", "groq,deepinfra")
    assert [p.name for p in load_providers()] == ["groq", "deepinfra"]


def test_provider_dengan_konfigurasi_tidak_lengkap_dilewati(env, monkeypatch):
    monkeypatch.setenv("TRANSCRIBE_PROVIDERS", "deepinfra,belumdiisi")
    assert [p.name for p in load_providers()] == ["deepinfra"]


def test_tanpa_provider_sama_sekali_gagal_dengan_pesan_jelas(monkeypatch):
    monkeypatch.setenv("TRANSCRIBE_PROVIDERS", "")
    with pytest.raises(JobError) as e:
        load_providers()
    assert e.value.code == "TRANSCRIBE_FAILED"
    assert "TRANSCRIBE_PROVIDERS" in str(e.value)


def test_cache_model_stabil_lintas_provider(env):
    # Kunci cache transkrip adalah (source_id, model). Bila nilainya mengikuti
    # id model tiap penyedia, fallback ke penyedia lain akan meleset dari cache
    # dan menagih ulang. Karena itu dipakai nama logis yang sama.
    assert cache_model() == "whisper-large-v3-turbo"


# --- parsing -------------------------------------------------------------


@pytest.mark.parametrize("fixture", ["deepinfra_ok.json", "groq_ok.json"])
def test_parse_response_menghasilkan_word_timestamp(fixture, env):
    result = parse_response("apa saja", _fixture(fixture), cache_model())
    assert isinstance(result, TranscriptResult)
    assert result.text.strip()
    assert len(result.words) > 0
    first = result.words[0]
    assert first.text.strip()
    assert first.end > first.start


@pytest.mark.parametrize("fixture", ["deepinfra_ok.json", "groq_ok.json"])
def test_word_timestamp_menaik_monoton(fixture, env):
    result = parse_response("apa saja", _fixture(fixture), cache_model())
    for a, b in zip(result.words, result.words[1:]):
        assert b.start >= a.start


def test_parse_response_menolak_respons_tanpa_words(env):
    with pytest.raises(JobError) as e:
        parse_response("deepinfra", {"text": "halo", "language": "id"}, cache_model())
    assert e.value.code == "TRANSCRIBE_FAILED"


def test_parse_response_memakai_nama_model_cache_bukan_model_provider(env):
    result = parse_response("deepinfra", _fixture("deepinfra_ok.json"), cache_model())
    assert result.model == "whisper-large-v3-turbo"


# --- biaya ---------------------------------------------------------------


def test_estimate_cost_sebanding_dengan_durasi(env):
    cfg = load_providers()[0]
    satu_jam = estimate_cost(cfg, 3600)
    dua_jam = estimate_cost(cfg, 7200)
    assert 0 < satu_jam < 0.10
    assert abs(dua_jam - satu_jam * 2) < 1e-9


# --- rantai fallback -----------------------------------------------------


def test_transcribe_memakai_provider_pertama_saat_berhasil(env, tmp_path: Path):
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json=_fixture("deepinfra_ok.json"))

    result = transcribe(audio, 60, http=_client(handler))
    assert result.provider == "deepinfra"
    assert seen == ["https://deepinfra.test/v1/audio"]


def test_transcribe_jatuh_ke_provider_berikutnya_saat_yang_pertama_gagal(env, tmp_path: Path):
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if len(seen) == 1:
            return httpx.Response(503, text="layanan tidak tersedia")
        return httpx.Response(200, json=_fixture("groq_ok.json"))

    result = transcribe(audio, 60, http=_client(handler))
    assert result.provider == "groq"
    assert seen == ["https://deepinfra.test/v1/audio", "https://groq.test/v1/audio"]


def test_biaya_mengikuti_provider_yang_benar_benar_dipakai(env, tmp_path: Path):
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")
    n = []

    def handler(request: httpx.Request) -> httpx.Response:
        n.append(1)
        if len(n) == 1:
            return httpx.Response(503, text="down")
        return httpx.Response(200, json=_fixture("groq_ok.json"))

    result = transcribe(audio, 3600, http=_client(handler))
    # Tarif Groq, bukan DeepInfra: 0.0006 per menit x 60 menit.
    assert result.cost_usd == pytest.approx(0.036)


def test_provider_yang_tidak_mengembalikan_word_timestamp_dianggap_gagal(env, tmp_path: Path):
    """Tanpa word timestamp, caption karaoke dan Editor C tidak mungkin.
    Lebih baik jatuh ke provider berikutnya daripada menyimpan transkrip
    yang tidak dapat dipakai tahap berikutnya."""
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")
    n = []

    def handler(request: httpx.Request) -> httpx.Response:
        n.append(1)
        if len(n) == 1:
            return httpx.Response(200, json={"text": "halo", "language": "id"})
        return httpx.Response(200, json=_fixture("groq_ok.json"))

    result = transcribe(audio, 60, http=_client(handler))
    assert result.provider == "groq"


def test_transcribe_gagal_bila_semua_provider_gagal(env, tmp_path: Path):
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="meledak")

    with pytest.raises(JobError) as e:
        transcribe(audio, 60, http=_client(handler))
    assert e.value.code == "TRANSCRIBE_FAILED"
    assert e.value.terminal is False


def test_api_key_tidak_bocor_ke_pesan_error(env, tmp_path: Path):
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="unauthorized: key RAHASIA-DEEPINFRA-123 ditolak")

    with pytest.raises(JobError) as e:
        transcribe(audio, 60, http=_client(handler))
    assert "RAHASIA" not in str(e.value)


def test_api_key_dikirim_sebagai_bearer(env, tmp_path: Path):
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("authorization", ""))
        return httpx.Response(200, json=_fixture("deepinfra_ok.json"))

    transcribe(audio, 60, http=_client(handler))
    assert seen == ["Bearer RAHASIA-DEEPINFRA-123"]


def test_providers_dapat_disuntikkan_untuk_pengujian(env, tmp_path: Path):
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")
    custom = [
        ProviderConfig(
            name="sendiri",
            url="https://custom.test/v1/audio",
            key="k",
            model="m",
            usd_per_min=0.001,
        )
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://custom.test/v1/audio"
        return httpx.Response(200, json=_fixture("groq_ok.json"))

    result = transcribe(audio, 60, http=_client(handler), providers=custom)
    assert result.provider == "sendiri"


def test_transcribe_logs_each_fallback_attempt_without_secrets(
    env, tmp_path: Path, caplog
):
    caplog.set_level(logging.INFO)
    audio = tmp_path / "private-audio.opus"
    audio.write_bytes(b"x")
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503, text="RAHASIA-DEEPINFRA-123")
        return httpx.Response(200, json=_fixture("groq_ok.json"))

    transcribe(audio, 60, http=_client(handler))

    events = [
        (record.event_name, record.event_fields)
        for record in caplog.records
        if getattr(record, "event_name", "").startswith("provider.request.")
    ]
    assert [name for name, _fields in events] == [
        "provider.request.failed",
        "provider.request.completed",
    ]
    assert [fields["provider"] for _name, fields in events] == [
        "deepinfra",
        "groq",
    ]
    assert events[-1][1]["result_count"] > 0
    assert "RAHASIA" not in caplog.text
    assert "private-audio" not in caplog.text


def test_transcribe_default_memakai_backend_lokal_tanpa_api_key(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("TRANSCRIBE_PROVIDERS", raising=False)
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"x")

    def local_fn(audio_path, duration_sec, env=None):
        assert audio_path == audio
        assert duration_sec == 60
        return TranscriptResult(
            language="id",
            text="halo lokal",
            words=[],
            provider="local_whisper",
            model="small",
            cost_usd=0.0,
        )

    result = transcribe(audio, 60, local_fn=local_fn)
    assert result.provider == "local_whisper"
    assert result.cost_usd == 0.0


def test_local_transcribe_mengubah_word_timestamp_model():
    from app.providers.local_transcription import transcribe_local

    class WordToken:
        def __init__(self, word, start, end):
            self.word, self.start, self.end = word, start, end

    class Segment:
        text = " halo dunia "
        start = 0.0
        end = 2.0
        words: ClassVar[list[WordToken]] = [
            WordToken(" halo", 0.0, 0.8),
            WordToken(" dunia", 0.8, 2.0),
        ]

    class Model:
        def transcribe(self, audio, **kwargs):
            return iter([Segment()]), type("Info", (), {"language": "id"})()

    result = transcribe_local(Path("audio.opus"), 2, model=Model())
    assert result.provider == "local_whisper"
    assert result.cost_usd == 0.0
    assert [word.text for word in result.words] == ["halo", "dunia"]
