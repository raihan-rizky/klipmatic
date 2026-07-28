# ADR 0002: Caption YouTube sebagai jalur transkripsi pertama

**Tanggal:** 2026-07-27  
**Status:** Diterima

## Konteks

Pipeline awal selalu mengunduh audio penuh dan mengirimkannya ke provider
transkripsi. Banyak video YouTube sudah mempunyai caption manual atau
otomatis yang cukup baik untuk pemilihan highlight. Membayar transkripsi
ulang pada video tersebut menambah waktu, bandwidth, dan biaya tanpa
menambah nilai pada fase analisis.

Caption YouTube tidak selalu memiliki timestamp kata yang presisi. Karena itu
caption tidak boleh diasumsikan cukup untuk caption karaoke di editor P2.

## Keputusan

Untuk sumber YouTube, ingest mencoba caption Bahasa Indonesia sebelum
mengunduh audio. Track manual dan otomatis diambil lewat yt-dlp dalam format
JSON3, dinormalisasi ke kontrak `TranscriptResult`, lalu diterima hanya bila:

- bahasa masuk daftar `YOUTUBE_CAPTION_LANGS`;
- jumlah kata memenuhi `YOUTUBE_CAPTION_MIN_WORDS`; dan
- coverage cue memenuhi `YOUTUBE_CAPTION_MIN_COVERAGE`.

Timestamp yang diturunkan dari cue disimpan dengan
`timing_precision = "estimated"`. Jika caption tidak ada, rusak, atau gagal
validasi, pipeline lama berjalan tanpa perubahan: audio diunduh, diekstrak,
dan ditranskripsi melalui DeepInfra dengan fallback Groq.

TikTok dan Google Drive langsung memakai jalur audio karena tidak memiliki
kontrak caption yang setara.

## Konsekuensi

- Video YouTube dengan caption layak tidak mengunduh audio penuh dan memiliki
  biaya transkripsi USD 0.
- DeepInfra dan Groq tetap wajib untuk fallback serta sumber non-YouTube.
- P2 membaca `timing_precision`. Saat user memilih klip dari caption estimasi,
  worker mengekstrak audio dan men-transcribe ulang hanya rentang tersebut,
  lalu menyimpan word timestamp relatif di `clip-transcripts/{clip_id}.json`.
- Bila precision pass gagal, segment tetap dipublikasikan dan editor memakai
  caption estimasi sebagai graceful fallback.
- Perubahan threshold cukup dilakukan lewat environment tanpa deploy kode.
