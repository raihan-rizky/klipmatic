import json
import logging
from pathlib import Path

import httpx
import pytest

from app.crypto import ApiKeyRecord
from app.errors import JobError
from app.providers.llm import (
    NEBIUS_BASE,
    NEBIUS_DEFAULT_MODEL,
    call_llm,
    nebius_key_from_env,
)

FIXTURES = Path(__file__).parent / "fixtures"

SECRET = "RAHASIA-KEY-999"


def _key(provider: str, base_url: str | None = None) -> ApiKeyRecord:
    return ApiKeyRecord(
        id="k1", provider=provider, base_url=base_url, model="model-x", secret=SECRET
    )


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize(
    "provider,fixture",
    [
        ("gemini", "llm_gemini_ok.json"),
        ("openai_compat", "llm_openai_ok.json"),
        ("anthropic_compat", "llm_anthropic_ok.json"),
    ],
)
def test_call_llm_mengekstrak_teks_dari_tiap_bentuk_respons(provider, fixture):
    body = _fixture(fixture)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    text = call_llm(_key(provider, "https://contoh.test/v1"), "prompt", http=_client(handler))
    assert "Cara berhenti menunda" in text


def test_nebius_env_menjadi_openai_compatible_tanpa_membocorkan_key():
    rec = nebius_key_from_env({"NEBIUS_API_KEY": "nebius-rahasia"})
    assert rec is not None
    assert rec.provider == "openai_compat"
    assert rec.base_url == NEBIUS_BASE
    assert rec.model == NEBIUS_DEFAULT_MODEL
    assert "nebius-rahasia" not in repr(rec)


def test_nebius_env_dapat_mengganti_model_dan_endpoint():
    rec = nebius_key_from_env(
        {
            "NEBIUS_API_KEY": "k",
            "NEBIUS_BASE_URL": "https://region.nebius.test/v1",
            "NEBIUS_MODEL": "model-khusus",
        }
    )
    assert rec is not None
    assert rec.base_url == "https://region.nebius.test/v1"
    assert rec.model == "model-khusus"


def test_nebius_env_kosong_mengembalikan_none():
    assert nebius_key_from_env({}) is None
    assert nebius_key_from_env({"NEBIUS_API_KEY": "   "}) is None


def test_openai_compat_memakai_base_url_milik_user():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json=_fixture("llm_openai_ok.json"))

    call_llm(_key("openai_compat", "https://ai.sumopod.com/v1"), "p", http=_client(handler))
    assert seen == ["https://ai.sumopod.com/v1/chat/completions"]


def test_base_url_dengan_slash_di_akhir_tidak_menghasilkan_slash_ganda():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json=_fixture("llm_openai_ok.json"))

    call_llm(_key("openai_compat", "https://ai.sumopod.com/v1/"), "p", http=_client(handler))
    assert seen == ["https://ai.sumopod.com/v1/chat/completions"]


def test_openai_compat_tanpa_base_url_ditolak():
    with pytest.raises(JobError) as e:
        call_llm(_key("openai_compat", None), "p", http=_client(lambda r: httpx.Response(200)))
    assert e.value.code == "BYOK_INVALID"
    assert e.value.terminal is True


def test_gemini_memakai_endpoint_generate_content_dan_header_key():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-goog-api-key")
        return httpx.Response(200, json=_fixture("llm_gemini_ok.json"))

    call_llm(_key("gemini"), "p", http=_client(handler))
    assert seen["url"].endswith("/models/model-x:generateContent")
    assert seen["key"] == SECRET


def test_anthropic_mengirim_header_versi():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["version"] = request.headers.get("anthropic-version")
        seen["key"] = request.headers.get("x-api-key")
        return httpx.Response(200, json=_fixture("llm_anthropic_ok.json"))

    call_llm(_key("anthropic_compat"), "p", http=_client(handler))
    assert seen["version"]
    assert seen["key"] == SECRET


@pytest.mark.parametrize("status", [401, 403])
def test_status_otentikasi_menjadi_BYOK_INVALID_terminal(status):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text="unauthorized")

    with pytest.raises(JobError) as e:
        call_llm(_key("gemini"), "p", http=_client(handler))
    assert e.value.code == "BYOK_INVALID"
    assert e.value.terminal is True


def test_kuota_habis_menjadi_BYOK_INVALID_terminal():
    """429 dari provider BYOK berarti kuota user habis, bukan sistem kita
    kelebihan beban. Mencoba ulang hanya membuang percobaan dan menunda
    pesan yang seharusnya user lihat."""

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
        return httpx.Response(401, text=f"key {SECRET} ditolak")

    with pytest.raises(JobError) as e:
        call_llm(_key("gemini"), "p", http=_client(handler))
    assert SECRET not in str(e.value)


def test_respons_tanpa_teks_gagal_LLM_BAD_OUTPUT():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": []})

    with pytest.raises(JobError) as e:
        call_llm(_key("openai_compat", "https://x.test/v1"), "p", http=_client(handler))
    assert e.value.code == "LLM_BAD_OUTPUT"


def test_gemini_yang_diblokir_safety_filter_gagal_LLM_BAD_OUTPUT():
    """Gemini membalas 200 dengan finishReason SAFETY dan tanpa parts.
    Tanpa penanganan ini, pengaksesan parts[0] melempar IndexError yang
    berujung ke kode INTERNAL, bukan pesan yang berguna bagi user."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"candidates": [{"finishReason": "SAFETY", "index": 0}]},
        )

    with pytest.raises(JobError) as e:
        call_llm(_key("gemini"), "p", http=_client(handler))
    assert e.value.code == "LLM_BAD_OUTPUT"


def test_provider_tidak_dikenal_ditolak_terminal():
    with pytest.raises(JobError) as e:
        call_llm(_key("provider_karangan"), "p", http=_client(lambda r: httpx.Response(200)))
    assert e.value.code == "BYOK_INVALID"
    assert e.value.terminal is True


def test_call_llm_logs_safe_provider_success(caplog):
    caplog.set_level(logging.INFO)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_fixture("llm_gemini_ok.json"))

    call_llm(
        _key("gemini"),
        "private prompt with secret",
        http=_client(handler),
    )

    record = next(
        record
        for record in caplog.records
        if getattr(record, "event_name", None) == "provider.request.completed"
    )
    assert record.event_fields["provider"] == "gemini"
    assert record.event_fields["operation"] == "generate"
    assert record.event_fields["status_code"] == 200
    assert "private prompt" not in caplog.text
    assert SECRET not in caplog.text
