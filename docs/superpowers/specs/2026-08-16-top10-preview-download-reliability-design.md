# Top-10 Preview Download Reliability Design

Tanggal: 2026-08-16  
Status: disetujui

## Masalah

Sesudah analisis menghasilkan sepuluh kandidat, worker saat ini menjalankan dua
job yang masing-masing mengunduh media dari sumber yang sama:

1. `render_previews` mengunduh seluruh rentang setiap kandidat untuk membuat
   preview 9:16;
2. `prepare_thumbnails` langsung mengunduh satu detik dari setiap kandidat
   untuk membuat thumbnail 16:9.

Satu analisis karena itu memicu sampai dua puluh invocation `yt-dlp`. Pada
project `085468cf-e6a6-4571-92b2-6c9753c4ce9f`, request beruntun ini menghasilkan
temporary `SOURCE_BLOCKED`: seluruh sepuluh preview gagal, sembilan dari sepuluh
thumbnail gagal, tetapi kedua batch job tetap ditandai `done`. Request diagnostik
yang sama berhasil setelah cooldown, sehingga runtime Deno, FFmpeg, format H.264,
dan source-nya sendiri bukan root cause permanen.

## Keputusan

Gunakan `render_previews` sebagai satu-satunya pipeline media Top-10. Setiap
kandidat diunduh sekali, lalu segment lokal yang sama dipakai untuk menghasilkan
dua output:

- thumbnail 16:9 WebP untuk candidate card;
- preview video 9:16 face-cropped untuk modal dan editor.

`analyze` tidak lagi enqueue `prepare_thumbnails`. Handler dan job type lama
tetap tersedia agar job yang sudah telanjur ada tidak menjadi unknown job selama
deployment, tetapi tidak dipakai untuk analisis baru.

## Alur data

```text
analyze selesai
  -> enqueue render_previews sekali
  -> untuk setiap kandidat Top-10 yang belum lengkap:
       download section sekali
       -> extract thumbnail 16:9 -> upload -> thumbnail_status=ready
       -> sample frames -> face focus -> crop 9:16 -> upload
       -> preview_status=ready
  -> jika ada kegagalan SOURCE_BLOCKED sementara:
       pertahankan output kandidat yang sudah ready
       -> tandai kandidat terdampak failed
       -> raise retryable JobError setelah batch
       -> queue mengulang hanya kandidat/output yang belum ready
```

Segment sementara tidak diunggah sebagai artefak baru dan tetap dihapus bersama
work directory setelah job selesai.

## Komponen

### `analyze`

`_write_candidates` hanya membuat satu active `render_previews` job per project.
Enqueue `prepare_thumbnails` dihapus. Deduplikasi active job yang sudah ada tetap
berlaku untuk retry analisis.

### `render_previews`

Query tetap mengambil ranked Top-10, tetapi handler menentukan kebutuhan output
per kandidat dari `thumbnail_status` dan `preview_status`:

- kedua output ready: kandidat dilewati tanpa download;
- salah satu output belum ready: download sekali dan hanya buat output yang
  belum ready;
- keduanya belum ready: satu download dipakai untuk keduanya.

Thumbnail memakai helper `extract_thumbnail` yang sudah ada, content-addressed
key `candidate-thumbnails/{sha256}.webp`, dan content type `image/webp`.
Preview mempertahankan pipeline MediaPipe dan FFmpeg yang sekarang.

### Retry dan pacing

`SOURCE_BLOCKED` adalah error sementara. Download setiap kandidat mendapat retry
lokal terbatas dengan exponential backoff dan jitter. Pacing juga diberikan di
antara kandidat agar invocation tidak menjadi burst rapat dari satu IP worker.
Nilai delay dibuat kecil dan injectable supaya unit test deterministik dan tidak
benar-benar tidur.

Jika retry lokal habis, handler melanjutkan kandidat lain agar satu kandidat
tidak memblokir semua output. Setelah batch selesai, keberadaan satu atau lebih
`SOURCE_BLOCKED` menyebabkan handler melempar `JobError` non-terminal. Queue lalu
menjalankan ulang job sesuai policy yang sudah ada. Pada attempt berikutnya,
output berstatus `ready` dilewati sehingga bandwidth yang sudah berhasil tidak
dibayar lagi.

Error permanen seperti source unavailable tetap menandai kandidat `failed` dan
tidak diubah menjadi retryable. Error thumbnail non-source tidak membatalkan
pembuatan preview kandidat yang sama, dan sebaliknya.

### Observability

Event `preview.failed` dan `thumbnail.failed` tetap menggunakan structured safe
fields tanpa source URL atau raw stderr. Saat batch meminta retry, log job-level
menunjukkan `SOURCE_BLOCKED` melalui queue yang sudah ada. Job tidak boleh lagi
berstatus `done` ketika masih ada kegagalan source sementara yang belum habis
retry policy-nya.

### Web pipeline wiring

Web saat ini memakai `prepare_thumbnails` sebagai penanda stage terakhir pada
`JobProgress`, `latestThumbnailJobStatus`, dan `projectViewState`. Ketiga wiring
tersebut dipindahkan ke `render_previews` supaya halaman tetap menunggu satu
pipeline gabungan yang baru dan reload ketika job itu terminal. Nama helper dan
argumen state diubah menjadi preview-oriented agar kontraknya tidak misleading.
Ini perubahan orchestration tanpa perubahan copy atau layout visual.

## Recovery project yang terdampak

Setelah worker baru aktif, project
`085468cf-e6a6-4571-92b2-6c9753c4ce9f` direcovery secara targeted:

1. enqueue satu `render_previews` job baru untuk project dan owner yang sama;
2. handler melewati output yang sudah ready;
3. tunggu job mencapai terminal state;
4. verifikasi seluruh Top-10 memiliki `thumbnail_status='ready'` dan
   `preview_status='ready'`.

Job `fetch_segments` milik interaksi editor tidak dimutasi sebagai bagian dari
recovery ini; queue retry existing tetap menanganinya.

## Testing

Regression coverage wajib membuktikan:

1. `analyze` hanya enqueue `render_previews`, bukan `prepare_thumbnails`;
2. satu kandidat yang butuh dua output hanya memanggil download sekali;
3. thumbnail dan preview sama-sama menjadi ready dari segment yang sama;
4. kandidat yang kedua output-nya sudah ready dilewati tanpa download;
5. output ready tidak dibuat ulang ketika job retry;
6. `SOURCE_BLOCKED` memakai retry lokal, lalu memicu retry job bila masih gagal;
7. error permanen satu kandidat tidak membatalkan kandidat lain;
8. log tetap tidak membocorkan raw stderr atau URL;
9. web progress dan result gate mengikuti `render_previews`, bukan job thumbnail;
10. focused downloader/web tests, Ruff, type-check, dan full relevant suite lulus.

Verifikasi runtime menggunakan worker Docker hasil rebuild dan project nyata yang
terdampak. Sukses berarti status Top-10 seluruhnya ready, object thumbnail dan
preview dapat dibaca dari storage, serta log tidak memuat burst kegagalan
`download_section` yang sama.

## Non-goals

- Cookie pool, residential proxy, atau bypass autentikasi YouTube.
- Perubahan model face detection, crop, scoring kandidat, atau visual UI.
- Penyimpanan ulang raw segment Top-10 di R2.
- Menghapus schema/job type `prepare_thumbnails` dalam perubahan ini.

## Risiko dan mitigasi

- Retry menambah waktu saat YouTube benar-benar membatasi worker. Ini diterima
  karena output akhirnya ready lebih penting daripada job cepat tetapi palsu
  `done`.
- Deployment bisa menyisakan `prepare_thumbnails` job lama. Handler lama tetap
  terdaftar sehingga job tersebut aman selesai; analisis baru tidak menambahnya.
- Partial success bisa meninggalkan salah satu output ready. Status per-output
  menjadi checkpoint, sehingga retry melengkapi bagian yang hilang tanpa
  mengganti output yang sudah sukses.
