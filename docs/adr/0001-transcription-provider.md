# ADR 0001: Provider transkripsi

**Tanggal:** 2026-07-27
**Status:** Sebagian diterima. Perbandingan DeepInfra vs Groq masih **PENDING**.

## Konteks

Spec §5.1 memilih DeepInfra sebagai primary karena harganya sekitar sepertiga
Groq (USD 0,012 vs USD 0,036 per jam audio). Pilihan itu bersyarat pada
dukungan word-level timestamp, yang wajib untuk caption karaoke (P2) dan
Editor C (P3).

Selain itu muncul pertanyaan apakah kebutuhan transkripsi dapat disatukan ke
Sumopod, yang sudah menjadi penyedia VPS proyek ini.

## Temuan 1: Sumopod tidak menyediakan transkripsi

Sumopod menjalankan gateway OpenAI-compatible di `https://ai.sumopod.com/v1`
(terkonfirmasi: `/v1/models` membalas 401, bukan 404). Katalog modelnya
diperiksa pada 2026-07-27 dan berisi **47 model teks serta 3 model embedding,
tanpa satu pun model audio.** Tidak ada `whisper`, tidak ada model transkripsi
dalam bentuk apa pun.

**Konsekuensi:** Sumopod tidak dapat menggantikan penyedia transkripsi. Ia
tetap sangat cocok untuk langkah pemilihan highlight, dan sudah didukung hari
ini lewat jenis provider `openai_compat` tanpa perubahan kode.

Biaya langkah LLM lewat Sumopod, dihitung untuk transkrip podcast satu jam
(sekitar 16.000 token masuk, 1.500 token keluar):

| Model | Perkiraan biaya per video |
|---|---|
| `MiniMax-M2.7-highspeed` | ~USD 0,0007 |
| `gpt-5-nano` | ~USD 0,0014 |
| `deepseek-v4-flash` | ~USD 0,0030 |
| `gemini/gemini-3.1-flash-lite` | ~USD 0,0063 |

## Temuan 2: perbandingan DeepInfra vs Groq belum diukur

Spike memerlukan API key kedua penyedia, yang belum tersedia saat P1
dikerjakan. Yang belum terjawab: apakah DeepInfra mengembalikan word-level
timestamp melalui `timestamp_granularities: ["word"]`.

## Keputusan

**Provider transkripsi dikonfigurasi lewat environment, bukan konstanta di
source.** Adapter membaca daftar provider beserta urutan fallback dari env,
sehingga mengganti penyedia adalah perubahan konfigurasi, bukan perubahan
kode.

Ini mengubah sifat pertanyaan yang tersisa: memilih penyedia tidak lagi
memerlukan commit, jadi spike dapat dijalankan kapan saja tanpa memblokir
P1. Rantai default di `.env.example` diset `deepinfra,groq` sesuai spec, dan
akan dikonfirmasi atau dibalik setelah pengukuran.

## Konsekuensi

- Fixture transkripsi yang dipakai tes P1 **disusun manual** dari bentuk
  respons OpenAI-compatible `verbose_json`, bukan rekaman panggilan nyata.
  Berkasnya diberi field `_fixture_origin` yang menyatakan hal itu secara
  eksplisit agar tidak keliru dianggap rekaman.
- Setelah key tersedia, jalankan `scripts/spike_transcription.py` untuk
  merekam fixture asli, lalu perbarui ADR ini dengan hasil pengukuran.
- Rantai fallback tetap ada apa pun hasilnya, karena penyedia mana pun bisa
  mengalami gangguan.

## Yang harus dilakukan untuk menutup ADR ini

1. Sediakan `TRANSCRIBE_PROVIDERS` beserta key masing-masing di `.env`.
2. Jalankan `uv run python scripts/spike_transcription.py <audio.opus>` dengan
   sampel audio Bahasa Indonesia berdurasi 2-3 menit.
3. Isi tabel hasil di bawah, lalu ubah status ADR menjadi Diterima.

| Provider | HTTP | Array `words` | Field per kata | Kualitas Bahasa Indonesia |
|---|---|---|---|---|
| DeepInfra | belum diukur | belum diukur | belum diukur | belum diukur |
| Groq | belum diukur | belum diukur | belum diukur | belum diukur |
