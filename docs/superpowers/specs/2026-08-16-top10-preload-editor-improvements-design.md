# Desain: Top-10 Preload, 9:16 Face-Crop, Face Detection, Scoring, dan Responsiveness

Tanggal: 2026-08-16
Status: disetujui

## Status sub-proyek

- Sub-proyek 1 (fix editor playback): **selesai** — commit 6c80136
- Sub-proyek 2+3 (preload pipeline + face-crop): **selesai** — commit 396082e..7a698e7
- Sub-proyek 4 (scoring): belum dimulai
- Sub-proyek 5 (UI responsiveness): belum dimulai

## Konteks

Empat masalah berdiri sendiri tapi saling mendukung:

1. **Editor playback berhenti <2 detik setelah play.** Bug, bukan desain — harus
   diselesaikan lewat systematic-debugging sebelum fitur lain disentuh, karena
   preload dan UI tidak ada gunanya kalau preview editor rusak.
2. **Kandidat top-10 tidak di-preload.** Setiap klik membayar latensi penuh
   `createPreviewClip` + polling. Preview juga bermain di rasio sumber (16:9),
   bukan 9:16.
3. **Face detection lemah.** MediaPipe JS short-range, satu frame saat klik,
   `null` kalau wajah tidak ada, tidak berjalan otomatis.
4. **Segmen kandidat dipilih buruk.** Prompt `highlights_v1` memilih segmen
   yang sering tidak berdiri sendiri atau mulai di tengah kalimat.

Permintaan pengguna yang disetujui: pre-render semua 10 preview clip di worker
dengan deteksi wajah Python yang lebih baik, crop 9:16, preload supaya klik
instan; perbaiki pemilihan segmen; UI mobile-first dengan loading state dan
micro-interactions; performa render editor.

## Arsitektur inti (Sub-proyek 2 + 3: preload + face-crop)

**Keputusan:** render preview terjadi di worker, bukan browser.

### Alur baru

```
analyze selesai
  → enqueue satu job `render_previews` per project
  → worker loop 10 kandidat:
      download section (ytdlp.download_section, range candidate)
      → extract N frame (0.5 fps, maks ~16 frame)
      → deteksi wajah (MediaPipe Python atau SCRFD) per frame
      → pilih focus X: median center dari frame berwajah; fallback 0.5
      → smooth (EMA) supaya crop tidak lompat
      → FFmpeg crop 9:16 + scale 720x1280 + libx264 veryfast crf 28 + AAC
      → upload R2 key `previews/{project_id}/{candidate_id}.mp4`
      → update clip_candidates: preview_status='ready', preview_r2_key
  → selesai; modal tidak pernah menunggu
```

### Perubahan database

Migrasi baru menambah kolom pada `clip_candidates`:

- `preview_status text not null default 'pending'` — pending | rendering | ready | failed
- `preview_r2_key text`

R2 lifecycle rule baru untuk folder `previews/` (TTL sama dengan segments, 7 hari).

### Perubahan worker (`apps/downloader`)

- Handler baru `app/handlers/render_previews.py`.
- Enqueue dari `handle_analyze` setelah `_write_candidates`, mengikuti pola
  enqueue `prepare_thumbnails`.
- Dependency baru: `mediapipe` (Python) sebagai default. SCRFD/InsightFace
  jadi opsi berikutnya kalau kualitas kurang — keputusan model difinalkan saat
  implementasi dengan uji pada 3-5 video sampel.
- FFmpeg helper baru `crop_vertical(src, dst, focus_x)`: crop window 9:16
  berpusat pada `focus_x * width`, clamp ke tepi.
- Konsumsi concurrency: render previews dijalankan sequential dalam satu job
  (10 kandidat × ~5-15 detik). Job heartbeat tiap kandidat supaya tidak
  dianggap mati oleh reaper.

### Perubahan web

- `apps/web/lib/candidates.ts`: expose `previewStatus` dan `previewUrl` dari
  query yang sudah ada (join tambahan).
- `apps/web/app/api/clips/[id]/preview/route.ts`: kalau `preview_r2_key`
  siap, kembalikan signed URL langsung tanpa menyentuh segment.
- `CandidatePreviewModal`: kalau `previewStatus === 'ready'`, langsung tampilkan
  `<video>` tanpa tombol idle.
- `CandidateList`: badge kecil atau shimmer saat preview masih rendering;
  klik tetap membuka modal (polling tetap jalan sebagai fallback).

### 9:16 di semua tempat

Preview clip menjadi sumber baru untuk editor: rasio sudah 9:16, jadi crop
editor opsional (zoom/focus), bukan koreksi rasio. Tidak ada perubahan pada
pipeline export karena edit spec membaca asset apa pun.

## Sub-proyek 1: Fix editor playback (bug)

Gejala: play jalan <2 detik lalu berhenti. Ditangani dengan skill
`superpowers:systematic-debugging` sebelum sub-proyek lain mulai.

Hipotesis awal (bukan kesimpulan):

- `spec.timeline.duration` lebih panjang dari durasi media aktual; saat media
  mencapai akhir, `play()` restart dari 0 atau `readyState` turun → controller
  memanggil `handleStall`.
- Drift tolerance 0.08s di `timelinePlayback.ts` terlalu ketat untuk media
  yang buffer lambat; seek berulang memicu pause.
- Signed URL habis / CORS saat media pool di-recreate.

Tidak ada perubahan desain di sini; hasil debugging menentukan fix.

## Sub-proyek 4: Perbaikan pemilihan segmen (scoring)

Masalah yang dilaporkan: segmen dipilih buruk — sering tidak berdiri sendiri,
mulai di tengah kalimat, atau hook lemah.

Perubahan pada `apps/downloader/app/prompts/highlights_v1.py`:

1. **Prompt v2** (`PROMPT_VERSION = "highlights_v2"`):
   - Tambahkan kriteria eksplisit: segmen harus dimulai dan berakhir pada
     batas kalimat utuh; tidak boleh memotong di tengah argumen.
   - Larang segmen yang hanya berisi intro/outro/channel promo.
   - Wajibkan alasan (`reason`) menyebut elemen viral spesifik (kejutan,
     konflik, payoff), bukan alasan generik.
   - Contoh 2 kandidat baik dan 2 buruk (few-shot) untuk mengurangi pilihan
     acak.
2. **Validasi struktural di `parse_candidates`** (kode, bukan prompt):
   - Snap `start_sec` ke word boundary terdekat dari transkrip; geser mundur
     sampai awal kalimat (heuristic: kata pertama setelah jeda >400ms atau
     kata kapital pertama setelah titik).
   - Buang kandidat yang overlap >30% dengan kandidat ber-score lebih tinggi.
   - Buang kandidat dengan speech density <50% dari durasi (banyak diam).
3. **Cache invalidasi:** `input_hash` sudah dipakai untuk cache LLM. Kenaikan
   `PROMPT_VERSION` otomatis membatalkan cache lama.

## Sub-proyek 5: UI responsiveness

Lingkup yang disetujui: editor rendering performance, mobile-first layout,
micro-interactions, perceived speed via loading states.

### Mobile-first

- `CandidateList`: grid 1 kolom di <xl, kartu lebih rapat, thumbnail 16:9
  penuh tanpa padding berlebih.
- `CandidatePreviewModal`: footer navigasi sticky di bawah, video max-height
  viewport mobile, tombol prev/next selalu icon di layar kecil.
- Editor: panel inspector jadi bottom-sheet di mobile (atau collapse), bukan
  sidebar yang memaksa scroll horizontal.

### Loading states

- Kartu kandidat: shimmer thumbnail saat `thumbnailStatus === 'pending'`,
  badge "Menyiapkan preview…" saat `previewStatus === 'rendering'`.
- Modal: skeleton 9:16 saat polling, bukan poster + spinner.

### Editor rendering performance

- Throttle redraw canvas ke max 30fps saat preview tidak playing (hemat CPU).
- Memoize `mediaEntries` dan `timelineContext` sudah ada; tambah `useMemo`
  untuk hasil `evaluateTransitions` yang saat ini dihitung tiap frame.
- Playhead slider: update via `requestAnimationFrame` coalesce, bukan tiap
  event `onChange`.

### Micro-interactions

- Hover card: scale thumbnail + shadow (sudah ada, dipertahankan).
- Transition tombol play/pause di editor: icon swap dengan fade 150ms.
- Tidak ada animasi yang menunda interaksi (semua <200ms, non-blocking).

## Urutan implementasi

1. **Sub-proyek 1** — fix editor playback (systematic-debugging).
2. **Sub-proyek 2+3** — preload pipeline + face-crop (satu spec, satu plan).
3. **Sub-proyek 4** — prompt v2 + validasi struktural.
4. **Sub-proyek 5** — UI pass terakhir supaya loading state sesuai dengan
   preload pipeline yang sudah jadi.

Tiap sub-proyek mendapat plan terpisah via skill `writing-plans`.

## Risiko dan mitigasi

- **Biaya worker naik 10x per project** (10 render). Mitigasi: encode sangat
  cepat (veryfast crf 28, 720p), total ~1-2 menit per project. Bisa
  dikonfigurasi ulang ke top-3 bila biaya jadi masalah.
- **MediaPipe Python tidak punya model sebaik SCRFD.** Mitigasi: uji A/B pada
  3-5 video sebelum finalisasi; SCRFD butuh `insightface` + `onnxruntime`,
  lebih berat di Docker tapi tidak butuh GPU.
- **Signed URL R2 untuk preview** punya TTL pendek. Tidak berubah dari
  perilaku segment saat ini; modal tetap fallback ke polling.
- **Migrasi kolom baru** pada tabel yang sudah ada datanya: default
  `preview_status='pending'` aman untuk baris lama.

## Out of scope

- Cloud-render fallback (sudah dijadwalkan P5 di README).
- Upload media custom, transitions lanjutan, effects.
- Perubahan pada export pipeline selama edit spec tidak berubah bentuk.
