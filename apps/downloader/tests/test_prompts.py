import logging
from pathlib import Path

import pytest

from app.errors import JobError
from app.prompts.highlights_v1 import (
    MAX_CLIP_SEC,
    MIN_CLIP_SEC,
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


def _envelope(*items: str) -> str:
    return '{"candidates":[' + ",".join(items) + "]}"


def test_prompt_version_stabil():
    assert PROMPT_VERSION == "highlights_v1"


def test_build_prompt_memuat_transkrip_bertimestamp_dan_jumlah_diminta():
    p = build_prompt(WORDS, duration_sec=120, want=10)
    # "10" saja tidak membuktikan apa pun: penanda "[10s]" dan duration_sec
    # juga memuatnya. Instruksinya yang harus diperiksa utuh.
    assert "pilih 10 segmen" in p
    assert "menarik" in p
    assert "JSON" in p


def test_build_prompt_menghormati_jumlah_yang_diminta_pemanggil():
    p = build_prompt(WORDS, duration_sec=120, want=3)
    assert "pilih 3 segmen" in p
    assert "pilih 10 segmen" not in p


def test_build_prompt_mewajibkan_judul_dan_hook_bahasa_indonesia():
    # Placeholder JSON juga memuat frasa "Bahasa Indonesia", jadi kalimat
    # instruksinya yang dicocokkan, bukan sekadar frasanya.
    assert (
        "Judul dan hook wajib ditulis dalam Bahasa Indonesia"
        in build_prompt(WORDS, duration_sec=120)
    )


def test_build_prompt_menyatakan_score_bukan_persen():
    p = build_prompt(WORDS, duration_sec=120)
    assert "Nilai score adalah bilangan desimal antara 0 dan 1, bukan persen." in p


def test_build_prompt_menandai_waktu_pada_transkrip():
    assert "[10s]" in build_prompt(WORDS, duration_sec=120)


def test_build_prompt_menyatakan_batas_durasi_klip():
    p = build_prompt(WORDS, duration_sec=120)
    assert str(MIN_CLIP_SEC) in p and str(MAX_CLIP_SEC) in p
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
    c = parse_candidates((MALFORMED / fixture).read_text(encoding="utf-8"), duration_sec=120)
    assert len(c) == 1
    assert c[0].start_sec == 10.0
    assert c[0].end_sec == 80.0
    assert c[0].score == pytest.approx(0.9)


def test_parse_tanpa_json_gagal_dengan_LLM_BAD_OUTPUT():
    with pytest.raises(JobError) as e:
        parse_candidates((MALFORMED / "no_json.txt").read_text(encoding="utf-8"), duration_sec=120)
    assert e.value.code == "LLM_BAD_OUTPUT"


def test_parse_string_kosong_gagal_dengan_LLM_BAD_OUTPUT():
    with pytest.raises(JobError) as e:
        parse_candidates("   ", duration_sec=120)
    assert e.value.code == "LLM_BAD_OUTPUT"


def test_LLM_BAD_OUTPUT_tidak_terminal_agar_bisa_dicoba_ulang():
    with pytest.raises(JobError) as e:
        parse_candidates("bukan json", duration_sec=120)
    assert e.value.terminal is False


def test_parse_pagar_dengan_label_huruf_besar():
    # Prakata sengaja memuat { dan [ agar potongan kurung pertama-terakhir
    # ikut gagal; hanya jalur pagar markdown yang bisa menyelamatkan kasus ini.
    raw = (
        "Formatnya {seperti ini} dengan [contoh] ya:\n\n"
        "```JSON\n"
        + _envelope('{"start_sec":10,"end_sec":80,"score":0.9,"title":"besar","hook_text":"h"}')
        + "\n```\n"
    )
    assert [x.title for x in parse_candidates(raw, 120)] == ["besar"]


def test_parse_pagar_dengan_label_bahasa_lain():
    raw = (
        "Contoh {objek} dan [daftar] dulu:\n\n"
        "```javascript\n"
        + _envelope('{"start_sec":10,"end_sec":80,"score":0.9,"title":"js","hook_text":"h"}')
        + "\n```\n"
    )
    assert [x.title for x in parse_candidates(raw, 120)] == ["js"]


def test_parse_candidates_berupa_objek_tunggal():
    raw = '{"candidates":{"start_sec":10,"end_sec":80,"score":0.9,"title":"tunggal","hook_text":"h"}}'
    assert [x.title for x in parse_candidates(raw, 120)] == ["tunggal"]


def test_parse_objek_kandidat_telanjang_tanpa_amplop():
    raw = '{"start_sec":10,"end_sec":80,"score":0.9,"title":"telanjang","hook_text":"h"}'
    assert [x.title for x in parse_candidates(raw, 120)] == ["telanjang"]


def test_parse_amplop_dengan_nama_kunci_lain():
    raw = '{"clips":[{"start_sec":10,"end_sec":80,"score":0.9,"title":"alias","hook_text":"h"}]}'
    assert [x.title for x in parse_candidates(raw, 120)] == ["alias"]


def test_amplop_bernama_dipilih_walau_ada_daftar_lain_lebih_dulu():
    # Daftar "notes" muncul duluan dalam urutan kunci. Tanpa daftar nama amplop
    # yang dikenal, fallback "daftar objek pertama" akan memilih notes.
    raw = (
        '{"notes":[{"catatan":"abaikan aku"}],'
        '"candidates":[{"start_sec":10,"end_sec":80,"score":0.9,'
        '"title":"amplop","hook_text":"h"}]}'
    )
    assert [x.title for x in parse_candidates(raw, 120)] == ["amplop"]


def test_amplop_dengan_kunci_tak_dikenal_diselamatkan_fallback():
    # "bagian" sengaja bukan anggota daftar nama amplop yang dikenal, jadi
    # hanya fallback daftar-objek-pertama yang bisa menyelamatkannya.
    raw = '{"bagian":[{"start_sec":10,"end_sec":80,"score":0.9,"title":"fallback","hook_text":"h"}]}'
    assert [x.title for x in parse_candidates(raw, 120)] == ["fallback"]


def test_koma_menggantung_di_dalam_string_tidak_dirusak():
    raw = (
        '{"candidates":[{"start_sec":10,"end_sec":80,"score":0.9,'
        '"title":"Uang, } bukan segalanya","hook_text":"Hook",},]}'
    )
    c = parse_candidates(raw, 120)
    assert [x.title for x in c] == ["Uang, } bukan segalanya"]


def test_kandidat_di_luar_durasi_dibuang():
    raw = _envelope(
        '{"start_sec":10,"end_sec":80,"score":0.9,"title":"ok","hook_text":"h"}',
        '{"start_sec":500,"end_sec":560,"score":0.9,"title":"lewat","hook_text":"h"}',
    )
    assert [x.title for x in parse_candidates(raw, duration_sec=120)] == ["ok"]


def test_kandidat_dengan_rentang_terbalik_dibuang():
    # Jarak mutlak 80..10 adalah 70 detik, sah bila panjang dihitung dengan
    # abs(); kandidat ini harus tetap dibuang karena arahnya terbalik.
    raw = _envelope(
        '{"start_sec":80,"end_sec":10,"score":0.9,"title":"terbalik","hook_text":"h"}',
        '{"start_sec":10,"end_sec":80,"score":0.9,"title":"ok","hook_text":"h"}',
    )
    assert MIN_CLIP_SEC <= 70 <= MAX_CLIP_SEC
    assert [x.title for x in parse_candidates(raw, 120)] == ["ok"]


def test_kandidat_dengan_start_negatif_dibuang():
    # Panjang 60 detik dan end masih di dalam durasi, jadi tidak ada
    # pemeriksaan lain yang menolaknya selain batas bawah start.
    raw = _envelope(
        '{"start_sec":-20,"end_sec":40,"score":0.9,"title":"negatif","hook_text":"h"}',
        '{"start_sec":10,"end_sec":80,"score":0.9,"title":"ok","hook_text":"h"}',
    )
    assert [x.title for x in parse_candidates(raw, duration_sec=120)] == ["ok"]


def test_kandidat_terlalu_pendek_atau_panjang_dibuang():
    raw = _envelope(
        '{"start_sec":0,"end_sec":5,"score":0.9,"title":"pendek","hook_text":"h"}',
        '{"start_sec":0,"end_sec":119,"score":0.9,"title":"panjang","hook_text":"h"}',
        '{"start_sec":10,"end_sec":80,"score":0.9,"title":"ok","hook_text":"h"}',
    )
    assert [x.title for x in parse_candidates(raw, 120)] == ["ok"]


def test_score_dijepit_ke_rentang_nol_satu():
    raw = _envelope(
        '{"start_sec":10,"end_sec":80,"score":7.5,"title":"a","hook_text":"h"}',
        '{"start_sec":10,"end_sec":81,"score":-1,"title":"b","hook_text":"h"}',
    )
    c = parse_candidates(raw, 120)
    assert c[0].score == 1.0
    assert c[1].score == 0.0


def test_score_persen_dinormalkan_ke_rentang_nol_satu():
    raw = _envelope(
        '{"start_sec":10,"end_sec":80,"score":92,"title":"a","hook_text":"h"}',
        '{"start_sec":10,"end_sec":81,"score":100,"title":"b","hook_text":"h"}',
        '{"start_sec":10,"end_sec":82,"score":"85%","title":"c","hook_text":"h"}',
    )
    scores = {x.title: x.score for x in parse_candidates(raw, 120)}
    assert scores["a"] == pytest.approx(0.92)
    assert scores["b"] == pytest.approx(1.0)
    assert scores["c"] == pytest.approx(0.85)


def test_score_nol_sampai_satu_tidak_diubah():
    raw = _envelope('{"start_sec":10,"end_sec":80,"score":1,"title":"a","hook_text":"h"}')
    assert parse_candidates(raw, 120)[0].score == 1.0


def test_score_sepuluh_tidak_dibaca_sebagai_persen():
    # Model yang memakai skala 1..10 memberi 10 pada pilihan terbaiknya.
    # Membacanya sebagai 10% akan melempar kandidat terbaik ke urutan buncit.
    raw = _envelope(
        '{"start_sec":10,"end_sec":80,"score":10,"title":"terbaik","hook_text":"h"}',
        '{"start_sec":11,"end_sec":81,"score":9,"title":"kedua","hook_text":"h"}',
        '{"start_sec":12,"end_sec":82,"score":8,"title":"ketiga","hook_text":"h"}',
    )
    c = parse_candidates(raw, 120)
    assert c[0].title == "terbaik"
    assert c[0].score == pytest.approx(1.0)


def test_score_persen_eksplisit_sepuluh_tetap_dibagi_seratus():
    raw = _envelope('{"start_sec":10,"end_sec":80,"score":"10%","title":"a","hook_text":"h"}')
    assert parse_candidates(raw, 120)[0].score == pytest.approx(0.1)


def test_kandidat_dengan_angka_tak_hingga_atau_nan_dibuang():
    raw = _envelope(
        '{"start_sec":10,"end_sec":80,"score":NaN,"title":"nan","hook_text":"h"}',
        '{"start_sec":Infinity,"end_sec":80,"score":0.9,"title":"inf","hook_text":"h"}',
        '{"start_sec":10,"end_sec":-Infinity,"score":0.9,"title":"neg","hook_text":"h"}',
        '{"start_sec":11,"end_sec":81,"score":0.5,"title":"ok","hook_text":"h"}',
    )
    assert [x.title for x in parse_candidates(raw, 120)] == ["ok"]


def test_kandidat_diurutkan_dari_skor_tertinggi():
    raw = _envelope(
        '{"start_sec":10,"end_sec":80,"score":0.3,"title":"rendah","hook_text":"h"}',
        '{"start_sec":11,"end_sec":81,"score":0.9,"title":"tinggi","hook_text":"h"}',
    )
    assert [x.title for x in parse_candidates(raw, 120)] == ["tinggi", "rendah"]


def test_semua_kandidat_tidak_valid_gagal_dengan_LLM_BAD_OUTPUT():
    raw = '{"candidates":[{"start_sec":500,"end_sec":560,"score":0.9,"title":"x","hook_text":"h"}]}'
    with pytest.raises(JobError) as e:
        parse_candidates(raw, duration_sec=120)
    assert e.value.code == "LLM_BAD_OUTPUT"


def test_field_wajib_yang_hilang_membuang_kandidat():
    raw = _envelope(
        '{"start_sec":10,"end_sec":80,"score":0.9}',
        '{"start_sec":11,"end_sec":81,"score":0.9,"title":"ok","hook_text":"h"}',
    )
    assert [x.title for x in parse_candidates(raw, 120)] == ["ok"]


@pytest.mark.parametrize(
    "rusak",
    [
        '"title":null,"hook_text":"h"',
        '"hook_text":"h"',
        '"title":123,"hook_text":"h"',
        '"title":"","hook_text":"h"',
        '"title":"   ","hook_text":"h"',
    ],
    ids=["title_null", "title_hilang", "title_bukan_string", "title_kosong", "title_spasi"],
)
def test_title_tidak_layak_tampil_membuang_kandidat(rusak):
    # hook_text sengaja selalu sah agar hanya cabang title yang diuji.
    raw = _envelope(
        '{"start_sec":10,"end_sec":80,"score":0.9,' + rusak + "}",
        '{"start_sec":11,"end_sec":81,"score":0.9,"title":"ok","hook_text":"h"}',
    )
    assert [x.title for x in parse_candidates(raw, 120)] == ["ok"]


@pytest.mark.parametrize(
    "rusak",
    [
        '"title":"t","hook_text":null',
        '"title":"t"',
        '"title":"t","hook_text":123',
        '"title":"t","hook_text":""',
        '"title":"t","hook_text":"  \\t "',
    ],
    ids=["hook_null", "hook_hilang", "hook_bukan_string", "hook_kosong", "hook_spasi"],
)
def test_hook_tidak_layak_tampil_membuang_kandidat(rusak):
    # title sengaja selalu sah agar hanya cabang hook_text yang diuji.
    raw = _envelope(
        '{"start_sec":10,"end_sec":80,"score":0.9,' + rusak + "}",
        '{"start_sec":11,"end_sec":81,"score":0.9,"title":"ok","hook_text":"h"}',
    )
    assert [x.title for x in parse_candidates(raw, 120)] == ["ok"]


def test_spasi_pinggir_pada_teks_tampilan_dipangkas():
    raw = _envelope(
        '{"start_sec":10,"end_sec":80,"score":0.9,"title":"  Judul  ",'
        '"hook_text":"\\n Hook \\t","reason":"  Alasan  "}'
    )
    c = parse_candidates(raw, 120)[0]
    assert c.title == "Judul"
    assert c.hook_text == "Hook"
    assert c.reason == "Alasan"


def test_reason_opsional_bernilai_none():
    raw = _envelope('{"start_sec":10,"end_sec":80,"score":0.9,"title":"t","hook_text":"h"}')
    assert parse_candidates(raw, 120)[0].reason is None


def test_reason_bukan_string_menjadi_none():
    raw = _envelope(
        '{"start_sec":10,"end_sec":80,"score":0.9,"title":"t","hook_text":"h","reason":42}'
    )
    assert parse_candidates(raw, 120)[0].reason is None


def test_pesan_error_tidak_menyalin_keluaran_mentah():
    """Keluaran LLM bisa memuat kutipan transkrip; pesan error tidak boleh membocorkannya."""
    rahasia = "nomor rekening 1234567890"
    with pytest.raises(JobError) as e:
        parse_candidates(f"Maaf, {rahasia}, saya gagal.", duration_sec=120)
    assert rahasia not in str(e.value)


def test_log_kandidat_dibuang_hanya_mencatat_jumlah(caplog):
    """Log worker tersimpan lebih lama dari job; isi kandidat LLM memuat materi user."""
    rahasia = "nomor rekening 1234567890"
    raw = _envelope(
        '{"start_sec":0,"end_sec":5,"score":0.9,"title":"' + rahasia + '","hook_text":"h"}',
        '{"start_sec":10,"end_sec":80,"score":0.9,"title":"ok","hook_text":"h"}',
    )
    with caplog.at_level(logging.WARNING, logger="app.prompts.highlights_v1"):
        assert [x.title for x in parse_candidates(raw, 120)] == ["ok"]

    pesan = [r.getMessage() for r in caplog.records]
    assert any("1 dari 2" in m for m in pesan), pesan
    assert all(rahasia not in m for m in pesan)
