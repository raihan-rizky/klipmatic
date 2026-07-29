# CheapClipper

CheapClipper mengubah video panjang menjadi kandidat klip pendek dengan
caption/transkripsi bertimestamp dan analisis LLM. Status development saat
ini sudah sampai akhir P2: alur URL → ingest → transcribe → analyze →
candidate → editor browser → export MP4 tersedia.

Untuk YouTube, pipeline memakai strategi hybrid: caption Indonesia dicoba
lebih dulu dan divalidasi berdasarkan jumlah kata serta coverage durasi.
Kalau layak, audio penuh tidak perlu diunduh dan biaya transkripsi menjadi
nol. DeepInfra/Groq otomatis menjadi fallback; keduanya tetap menjadi jalur
utama untuk TikTok dan Google Drive.

P2 editor sudah memakai timeline multi-track dengan trim, split, auto-ripple,
layer video/audio/caption, undo/redo selama tab aktif, serta autosave. Preview
9:16, crop/focus wajah opsional, caption karaoke, dan export MP4 H.264/AAC
membaca edit spec timeline yang sama. Candidate segment tetap menjadi batas
source fase ini; upload media, transitions, dan effects belum tersedia.

Preview dapat dipakai pada browser modern. Export MP4 membutuhkan WebCodecs
`VideoEncoder` dan, bila audio aktif, `AudioEncoder`; Chrome atau Edge terbaru
tetap menjadi target utama. Device tanpa encoder yang kompatibel masih dapat
preview dan menyimpan edit, tetapi cloud-render fallback baru masuk P5.

Bila caption YouTube hanya mempunyai timestamp estimasi, worker
men-transcribe ulang **segment terpilih saja** sebelum editor membacanya.
DeepInfra dicoba lebih dulu dan Groq menjadi fallback. Kalau keduanya belum
dikonfigurasi atau sedang gagal, editor tetap terbuka memakai caption estimasi;
segment video tidak ikut gagal.

Untuk analisis highlight selama development, `NEBIUS_API_KEY` menjadi default
operator sementara melalui endpoint OpenAI-compatible Nebius. Selama env ini
terisi, worker mendahulukannya atas BYOK user; kosongkan untuk kembali ke key
terenkripsi dari halaman Settings.

## Prasyarat

- Bun 1.3+
- Docker Desktop
- Python 3.11+ dan [uv](https://docs.astral.sh/uv/)
- FFmpeg dan yt-dlp untuk menjalankan worker langsung di host
- Project Supabase untuk auth dan Realtime
- Bucket Cloudflare R2, atau MinIO lokal

## Setup lokal

```powershell
Copy-Item .env.example .env
bun install
bun run db:up
```

Isi minimal konfigurasi Supabase dan `BYOK_MASTER_KEY` di `.env`. Untuk
menjalankan pipeline AI sungguhan, isi juga key provider transkripsi. Nilai
`BYOK_MASTER_KEY` harus berupa 32 byte dalam base64.

Aktifkan lifecycle dan CORS bucket agar editor browser dapat membaca signed
segment tanpa mengekspos credential:

```powershell
Set-Location apps/downloader
uv run python -m scripts.r2_lifecycle
Set-Location ../..
```

Jalankan web:

```powershell
bun run dev
```

Jalankan worker dari terminal lain:

```powershell
Set-Location apps/downloader
uv sync
uv run python -m app.worker
```

Web tersedia di `http://localhost:3000`, PostgreSQL di port `55432`, dan
console MinIO di `http://localhost:9001`.

## Quality checks

```powershell
bun run test
bun run typecheck
bun run build
Set-Location apps/downloader
uv run pytest -v
```

CI menjalankan keempat check tersebut. Tes storage Python aktif ketika
`R2_ENDPOINT` tersedia; workflow CI standar tidak menyalakan MinIO.

## Verifikasi E2E

Dengan PostgreSQL, MinIO, FFmpeg, dan yt-dlp aktif:

```powershell
Set-Location apps/downloader
uv run python -m scripts.e2e_ingest
uv run python -m scripts.e2e_pipeline
```

`e2e_pipeline` memakai transcription dan output LLM palsu agar tidak
mengeluarkan biaya, tetapi ingest, FFmpeg, storage, queue, database, dan cache
tetap nyata. Sebelum P1 ditutup, jalankan `scripts/spike_transcription.py`
dengan key DeepInfra dan Groq serta validasi kualitas pada video Indonesia
nyata seperti yang dijelaskan di `docs/adr/0001-transcription-provider.md`.
