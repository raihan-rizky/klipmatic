# CheapClipper — Desain P0 + P1: Ingest & Pipeline AI

**Tanggal:** 2026-07-27
**Status:** Disetujui untuk implementasi
**Cakupan dokumen:** Sub-project P0 (Fondasi & Ingest) dan P1 (Pipeline AI)

---

## 1. Ringkasan

CheapClipper adalah SaaS yang mengubah video panjang menjadi klip pendek vertikal (9:16) berisi hook viral untuk YouTube Shorts, TikTok, dan Instagram Reels — dilengkapi editor video berbasis web.

Pembeda utamanya adalah **struktur biaya**. Kompetitor (Opus Clip, Klap, Vizard) menjalankan seluruh pipeline di server sehingga biaya komputasi naik linear terhadap jumlah user, memaksa harga langganan di kisaran USD 29/bulan. CheapClipper memindahkan tahap termahal — computer vision dan encoding video — ke browser user, dan menerapkan caching agresif berbasis sumber video. Hasilnya biaya marjinal di bawah Rp350 per video baru dan mendekati Rp0 untuk video yang sudah pernah diproses user lain.

Dokumen ini menspesifikasikan P0 dan P1: seluruh jalur server dari URL sampai daftar kandidat klip berskor. Rendering video dan editor tidak termasuk (lihat §11).

---

## 2. Konteks & Batasan

### 2.1 Target pasar

Indonesia. Ini bukan detail kosmetik — ia mengubah tiga keputusan teknis:

1. **Model transkripsi harus kelas besar.** Akurasi Whisper untuk Bahasa Indonesia pada model kecil (`base`, `small`) tidak layak pakai: banyak kesalahan pada nama orang, angka, dan campuran istilah Indonesia-Inggris yang lazim dalam podcast lokal. Wajib `whisper-large-v3-turbo`. Ini yang mendorong transkripsi ke server, bukan browser.
2. **Payment gateway bukan Stripe.** Midtrans atau Xendit (QRIS, GoPay, OVO, DANA, Virtual Account bank). Relevan untuk P5, dicatat di sini agar model data user tidak mengasumsikan Stripe.
3. **Google OAuth adalah metode login utama.** Email/password tetap disediakan sebagai cadangan.

### 2.2 Referensi yang dipelajari

| Proyek | Yang diambil |
|---|---|
| [jipraks/yt-short-clipper](https://github.com/jipraks/yt-short-clipper) | Referensi awal user. Pipeline dasar, yt-dlp + Deno untuk bot-detection. |
| [fralapo/clippyme](https://github.com/fralapo/clippyme) | Active-speaker detection (YOLOv8 + MediaPipe mouth-aspect-ratio), pola *compose-on-download*, fused FFmpeg passes, normalisasi audio EBU R128. |
| [FujiwaraChoki/supoclip](https://github.com/FujiwaraChoki/supoclip) | Next.js + FastAPI + Postgres, LLM multi-provider. |
| [m-hoseyny/teek](https://github.com/m-hoseyny/teek) | Next.js + FastAPI, transkripsi bisa diganti provider. |
| [Augani/openreel-video](https://github.com/Augani/openreel-video) | Arsitektur editor browser: React + Zustand + Mediabunny + WebCodecs + WebGPU, state action-based, persist ke IndexedDB. Rujukan untuk P2-P4. |

Semua proyek serupa memakai pola yang sama: Next.js/React di depan, FastAPI Python di belakang, Postgres, Docker Compose. CheapClipper mengikuti pola itu tetapi memindahkan CV dan encoding ke client.

### 2.3 Batasan yang diterima secara sadar

**Legalitas sumber video.** Mengunduh dari YouTube dan TikTok melanggar Terms of Service platform tersebut. Ini keputusan produk yang diambil sadar oleh pemilik proyek. Konsekuensi operasional yang harus dikelola:

- IP datacenter rutin diblokir. Sumopod (Indonesia) berisiko lebih rendah dibanding Hetzner/OVH, tetapi tidak kebal.
- Extractor yt-dlp dapat rusak sewaktu-waktu ketika platform mengubah sistemnya. Ini risiko operasional nomor satu proyek ini (mitigasi di §9.2).
- Jika volume menyebabkan pemblokiran, langkah berikutnya adalah proxy residensial (~USD 3-8/GB), yang akan menjadi komponen biaya terbesar. Rencana ini belum dieksekusi di P0/P1.

**Ketergantungan pada kapabilitas device user.** Mulai P2, rendering terjadi di browser dan membutuhkan WebGPU serta RAM 8 GB. Device di bawah itu memerlukan jalur fallback berbayar (P5). Tidak berdampak pada P0/P1.

---

## 3. Arsitektur: Pembagian Client/Server

Prinsip pembagian: **server memegang *pemahaman*, client memegang *penglihatan dan perakitan*.**

| Tahap | Lokasi | Alasan |
|---|---|---|
| Download (yt-dlp) | Server | Butuh IP bersih dan Deno runtime; browser terhalang CORS. I/O bound, CPU mendekati nol. |
| Ekstrak audio 16 kHz mono | Server | ~10 detik CPU untuk video 1 jam. Menyederhanakan client secara signifikan. |
| Transkripsi | Server | Bahasa Indonesia butuh model besar. API ~Rp200/jam lebih murah daripada memaksa user mengunduh model 800 MB. |
| Pemilihan highlight (LLM) | Server | BYOK. Key user tidak boleh pernah masuk ke JavaScript browser. Server berperan sebagai proxy: enkripsi key, rate limit, dan prompt dapat diperbaiki tanpa deploy ulang client. |
| Ranged download potongan video | Server | Lanjutan yt-dlp. Menghemat ~85% bandwidth. |
| Deteksi wajah & active-speaker | **Client** | Penghematan terbesar. CV per-frame adalah operasi termahal di server (~10-20 menit CPU per video); di browser dengan MediaPipe GPU delegate hampir gratis. |
| Preview real-time | **Client** | Wajib. Round-trip ke server membuat editor tidak dapat dipakai. |
| Render final | **Client** | WebCodecs hardware encode gratis. Server render hanya fallback berbayar. |
| Auth, jobs, storage, billing | Server | Supabase + R2 + Postgres. |

**Biaya marjinal per video baru:** transkripsi (~Rp200) + bandwidth. LLM Rp0 (BYOK), CV Rp0 (client), render Rp0 (client).

### 3.1 Optimasi: download dua fase

Video lengkap tidak pernah diunduh utuh.

1. **Fase 1** — `yt-dlp -f bestaudio` mengambil audio saja. Podcast 1 jam ≈ 40 MB.
2. Transkripsi dan analisis LLM berjalan atas audio tersebut.
3. **Fase 2** — setelah user memilih klip, `yt-dlp --download-sections "*12:30-13:45" --force-keyframes-at-cuts` mengambil **hanya rentang terpilih**. Sepuluh klip × 90 detik = 15 menit video, bukan 60 menit.

Menghemat sekitar 85% bandwidth server, dan user melihat hasil analisis dalam hitungan detik alih-alih menunggu unduhan 1 GB.

---

## 4. Stack

```
apps/
  web/          Next.js 15 (App Router) + TypeScript. ~90% produk.
  downloader/   FastAPI. yt-dlp + ffmpeg ekstrak audio + ranged download. Kecil.
packages/
  engine/       (P2) TS: timeline, style-spec, komposit WebGPU, export Mediabunny
  ai/           TS: adapter Gemini / OpenAI-compatible / Anthropic-compatible
  db/           Drizzle schema + migrasi
  shared/       Tipe & konstanta lintas paket
```

Monorepo: **Turborepo**. Package manager & script runner: **Bun**. Runtime Next.js tetap **Node** (Next belum berjalan penuh di runtime Bun); service TS standalone boleh memakai runtime Bun.

| Komponen | Pilihan | Alasan penolakan alternatif |
|---|---|---|
| ORM | **Drizzle** | Prisma memerlukan `DIRECT_URL` terpisah karena pgbouncer Supabase, engine binary memberatkan cold start, dan schema-nya bukan SQL. Drizzle SQL-first, selaras dengan RLS, cold start mendekati nol. |
| Database & Auth | **Supabase** (Postgres + Auth + Realtime) | — |
| Object storage | **Cloudflare R2** | Supabase Storage menagih egress; R2 tidak. Untuk beban video, ini penghematan terbesar. Supabase Storage tidak dipakai sama sekali. |
| Queue | **Tabel Postgres + `FOR UPDATE SKIP LOCKED`** | Redis/BullMQ menambah service tanpa manfaat pada volume awal. Job video berjalan lama dan jumlahnya kecil. Satu sumber kebenaran, mudah di-debug. Migrasi ke Redis dipertimbangkan di atas 100 job/menit. |
| Progress real-time | **Supabase Realtime** (`postgres_changes`) | Menghapus kebutuhan Redis pub/sub. Satu service lebih sedikit. |
| Hosting worker | **Sumopod** (Indonesia) | IP Indonesia jauh lebih jarang diblokir YouTube dibanding Hetzner/OVH. Bonus latensi rendah untuk user Indonesia. Spesifikasi belum diketahui; worker dirancang hardware-agnostic. |

---

## 5. Layanan Eksternal & Biaya

### 5.1 Transkripsi

| Provider | Harga/menit | Harga/jam | Peran |
|---|---|---|---|
| **DeepInfra** `whisper-large-v3-turbo` | ~USD 0,0002 | ~USD 0,012 (≈Rp200) | **Primary** |
| **Groq** `whisper-large-v3-turbo` | ~USD 0,0006 | ~USD 0,036 (≈Rp600) | **Fallback** |

Keduanya OpenAI-compatible pada endpoint `/audio/transcriptions`, sehingga satu adapter cukup — hanya `base_url` dan API key yang berbeda.

Whisper lokal (server maupun browser) tidak dipakai di P0/P1.

**Spike wajib hari pertama:** verifikasi DeepInfra mengembalikan word-level timestamp melalui `timestamp_granularities: ["word"]`. Word-level timestamp adalah syarat mutlak untuk caption karaoke (P2) dan Editor C (P3). Jika tidak didukung, primary bergeser permanen ke Groq. Selisih biaya Rp400 per video, tidak mengubah kelayakan proyek. Hasil spike dicatat di ADR.

### 5.2 LLM (pemilihan highlight)

**Bring Your Own Key.** User memasukkan API key sendiri untuk salah satu dari tiga jenis provider:

| Jenis | Contoh |
|---|---|
| `gemini` | Google Gemini API |
| `openai_compat` | OpenAI, Groq, DeepInfra, OpenRouter, Ollama, atau endpoint apa pun berbentuk OpenAI |
| `anthropic_compat` | Anthropic Claude atau endpoint kompatibel |

Untuk `openai_compat` dan `anthropic_compat`, user mengisi `base_url` dan nama model sendiri. Biaya LLM sepenuhnya ditanggung user; nol bagi operator.

### 5.3 Estimasi biaya bulanan operator

| Komponen | Biaya |
|---|---|
| Sumopod VPS (download + ekstrak audio; I/O bound) | USD 10-20 |
| Cloudflare R2 (~50 GB rolling, auto-delete) | ~USD 1 (egress USD 0) |
| Supabase (free → Pro saat diperlukan) | USD 0-25 |
| Transkripsi | ~USD 0,012 per video baru |
| LLM, CV, render | USD 0 |
| **Total tetap** | **USD 11-46/bulan** |

Satu-satunya biaya yang tumbuh bersama jumlah user adalah bandwidth VPS, dan itu sudah ditekan ~85% oleh download dua fase.

---

## 6. Model Data

### 6.1 Konsep inti: pemisahan `sources` dan `projects`

Ide yang membuat seluruh desain ini murah: **sumber video dipisahkan dari proyek user.**

Bila 50 user meng-clip episode podcast yang sama, itu satu baris `sources`, satu `transcripts`, satu kali download — tetapi 50 baris `projects`. User kedua hingga kelimapuluh berbiaya Rp0.

Untuk pasar Indonesia ini bukan skenario hipotetis; konten viral dibagikan dan di-clip beramai-ramai, sehingga cache hit rate diperkirakan tinggi.

### 6.2 Tabel

Semua tabel memakai `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`, dan `updated_at timestamptz`.

**`profiles`** — perluasan `auth.users` Supabase.
```
user_id      uuid  PK, FK → auth.users(id) on delete cascade
display_name text
locale       text  not null default 'id'
```

**`api_keys`** — kredensial BYOK milik user.
```
user_id        uuid  FK → profiles(user_id) on delete cascade
provider       text  not null  CHECK IN ('gemini','openai_compat','anthropic_compat')
label          text  not null
base_url       text                     -- null untuk 'gemini'
model          text  not null
encrypted_key  bytea not null           -- AES-256-GCM
key_iv         bytea not null
key_tag        bytea not null
last_used_at   timestamptz
```
Kunci master enkripsi berada di environment variable server, tidak pernah di database. Nilai key yang sudah didekripsi **tidak pernah** dikirim ke client, tidak pernah masuk log, dan tidak pernah muncul di respons error.

**`sources`** — sumber media kanonik. Tabel kunci untuk caching.
```
kind            text  not null  CHECK IN ('youtube','tiktok','gdrive','other')
external_id     text  not null           -- ID kanonik hasil normalisasi URL
is_public       bool  not null
owner_user_id   uuid  FK → profiles(user_id)   -- WAJIB jika is_public = false
url_original    text  not null
title           text
channel         text
duration_sec    int
thumbnail_url   text
audio_r2_key    text
audio_sha256    text
status          text  not null  CHECK IN ('pending','ready','failed')
error_code      text

UNIQUE (kind, external_id) WHERE is_public
UNIQUE (kind, external_id, owner_user_id) WHERE NOT is_public
INDEX  (audio_sha256)
```

**`transcripts`** — cache transkripsi.
```
source_id   uuid  not null FK → sources(id) on delete cascade
provider    text  not null
model       text  not null
language    text
r2_key      text  not null        -- JSON dengan word-level timestamp
word_count  int
cost_usd    numeric(10,6)

UNIQUE (source_id, model)
```

**`llm_runs`** — cache analisis highlight.
```
source_id       uuid  not null FK → sources(id) on delete cascade
provider        text  not null
model           text  not null
prompt_version  text  not null
input_hash      text  not null    -- sha256(transcript_id | prompt_version | model | params)
output          jsonb not null
cost_usd        numeric(10,6)

UNIQUE (input_hash)
```
Tabel ini sengaja **tidak** memiliki `project_id`. Entri cache dimiliki oleh `source`, bukan oleh proyek, agar hasil analisis dapat dipakai ulang lintas user pada sumber publik. Keterkaitan ke proyek terjadi lewat `clip_candidates.llm_run_id`. Konsekuensinya, menghapus satu proyek tidak menghapus entri cache yang mungkin dipakai user lain.

**`projects`**
```
user_id    uuid  not null FK → profiles(user_id) on delete cascade
source_id  uuid  not null FK → sources(id)
title      text  not null
settings   jsonb not null default '{}'
```

**`clip_candidates`**
```
project_id        uuid  not null FK → projects(id) on delete cascade
llm_run_id        uuid  FK → llm_runs(id)
start_sec         numeric(10,3) not null
end_sec           numeric(10,3) not null
score             numeric(4,3)  not null    -- 0.000 – 1.000
title             text not null
hook_text         text not null
reason            text                       -- alasan LLM, ditampilkan ke user
transcript_slice  text not null

CHECK (end_sec > start_sec)
```

**`media_segments`** — cache potongan video hasil ranged download.
```
source_id   uuid  not null FK → sources(id) on delete cascade
start_sec   numeric(10,3) not null
end_sec     numeric(10,3) not null
r2_key      text  not null
bytes       bigint
expires_at  timestamptz not null

UNIQUE (source_id, start_sec, end_sec)
```

**`clips`** — disiapkan di P0 karena `edit_spec` adalah kontrak antara server dan engine browser; baru terisi di P2.
```
project_id     uuid  not null FK → projects(id) on delete cascade
candidate_id   uuid  FK → clip_candidates(id)
edit_spec      jsonb not null default '{}'
render_status  text  not null default 'draft'
                     CHECK IN ('draft','rendering','done','failed')
output_r2_key  text
duration_sec   numeric(10,3)
```
`edit_spec` adalah **style-spec bersama**: satu sumber kebenaran yang dibaca oleh preview browser maupun renderer. Satu JSON, dua renderer. Skema detailnya ditetapkan di spec P2.

**`jobs`**
```
type        text  not null CHECK IN ('ingest','transcribe','analyze','fetch_segments')
payload     jsonb not null
status      text  not null default 'queued'
                  CHECK IN ('queued','running','done','failed','dead')
priority    int   not null default 0
attempts    int   not null default 0
max_attempts int  not null default 3
run_after   timestamptz not null default now()
locked_at   timestamptz
locked_by   text
progress    int   not null default 0     -- 0-100
error_code  text
error_msg   text
user_id     uuid  FK → profiles(user_id)
project_id  uuid  FK → projects(id) on delete cascade

INDEX (status, run_after, priority DESC)
```

### 6.3 Row Level Security

RLS diaktifkan pada seluruh tabel. Aturan yang tidak boleh dilanggar:

- `projects`, `clips`, `clip_candidates`, `api_keys`, `jobs`: hanya pemilik (`user_id = auth.uid()`) yang dapat membaca dan menulis.
- `sources`: dapat dibaca bila `is_public = true`, **atau** `owner_user_id = auth.uid()`. Tidak ada pengecualian.
- `transcripts`, `media_segments`, dan `llm_runs`: dapat dibaca bila `source_id` yang bersangkutan dapat dibaca oleh user tersebut menurut aturan di atas. Ketiganya mewarisi cakupan privasi dari `sources`, sehingga cache dapat dipakai bersama pada sumber publik tanpa membocorkan apa pun pada sumber privat.
- `api_keys`: kolom `encrypted_key`, `key_iv`, dan `key_tag` tidak pernah masuk ke `SELECT` mana pun yang dilayani ke client. Akses hanya lewat service role di server.

Penegakan berada di lapisan database, bukan hanya logika aplikasi.

---

## 7. Alur Job

```
[1] ingest
      Normalisasi URL → (kind, external_id, is_public)
      Cek sources → HIT & status='ready'? lewati.
      MISS? yt-dlp -f bestaudio
            → ffmpeg → opus 16 kHz mono (~40 MB/jam)
            → hitung sha256 → unggah R2 → sources.status = 'ready'

[2] transcribe
      Cek transcripts(source_id, model) → HIT? lewati.
      MISS? DeepInfra → jika gagal, Groq
            → simpan JSON word-level ke R2 → catat cost_usd

[3] analyze
      input_hash = sha256(transcript_id | prompt_version | model | params)
      Cek llm_runs(input_hash) → HIT? pakai ulang (menghemat uang USER)
      MISS? panggil provider BYOK → parse → tulis clip_candidates

───────────── user memilih klip di UI ─────────────

[4] fetch_segments
      Cek media_segments → MISS? yt-dlp --download-sections
            --force-keyframes-at-cuts → R2, set expires_at

───────────── mulai di sini, semuanya di browser (P2) ─────────────

[5] client
      Ambil segmen dari R2 (egress USD 0) → MediaPipe active-speaker
      → editor → render WebCodecs → unduh
```

### 7.1 Mekanika queue

Pengambilan job:
```sql
UPDATE jobs SET status='running', locked_at=now(), locked_by=$1, attempts=attempts+1
WHERE id = (
  SELECT id FROM jobs
  WHERE status='queued' AND run_after <= now()
  ORDER BY priority DESC, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

- **Heartbeat:** worker memperbarui `locked_at` setiap 30 detik selama job berjalan.
- **Reaper:** proses terjadwal mengembalikan job dengan `status='running'` dan `locked_at` lebih tua dari 5 menit ke `status='queued'`. Ini menangani worker yang mati mendadak.
- **Retry:** exponential backoff melalui `run_after` (1 menit, 5 menit, 25 menit). Setelah `max_attempts`, status menjadi `dead`.
- **Error terminal** (video privat, geo-block, key BYOK tidak valid) langsung `failed` tanpa retry.
- **Progress:** worker menulis kolom `progress`; Supabase Realtime `postgres_changes` mendorong perubahan ke browser. Tanpa Redis.

---

## 8. Strategi Caching

| Lapis | Kunci | TTL | Yang dihemat |
|---|---|---|---|
| **Media** (R2 + `sources`) | `(kind, external_id)`, sekunder `audio_sha256` | audio 30 hari, segmen 7 hari | Bandwidth dan pemanggilan yt-dlp |
| **Transkrip** (`transcripts`) | `(source_id, model)` | permanen — transkrip immutable | Biaya API operator. Penghemat terbesar. |
| **LLM** (`llm_runs`) | `input_hash`, dengan cakupan mengikuti `sources` | permanen | Uang user (BYOK). Pada sumber publik, dipakai bersama lintas user. Fitur retensi. |
| **CDN** | key content-addressed, `Cache-Control: public, max-age=31536000, immutable` | — | Egress R2 |
| **Client** | OPFS (segmen), IndexedDB (`edit_spec`), Cache API (wasm MediaPipe) | — | Unduh ulang dan kerja ulang setelah refresh |

### 8.1 Aturan privasi cache

Ini persyaratan keamanan, bukan optimasi:

- Sumber publik (YouTube/TikTok publik) → `is_public = true`, cache **global** lintas user.
- Sumber privat (Google Drive, video unlisted) → `is_public = false` dengan `owner_user_id` terisi, cache **hanya untuk user tersebut**.
- Tidak boleh ada kebocoran antar user dalam kondisi apa pun. Ditegakkan lewat RLS Supabase (§6.3) dan diverifikasi oleh tes keamanan khusus (§10).

Dedupe sekunder melalui `audio_sha256` menangkap kasus video sama yang diakses lewat URL berbeda.

### 8.2 Lifecycle R2

Aturan lifecycle bucket:
- `audio/` → hapus setelah 30 hari sejak akses terakhir.
- `segments/` → hapus setelah 7 hari (`media_segments.expires_at` dijaga sinkron).
- `transcripts/` → tidak pernah dihapus otomatis; ukurannya kecil dan nilainya tinggi.

---

## 9. Penanganan Error

Semua error yang terlihat user memakai Bahasa Indonesia yang jelas. Output stderr mentah tidak pernah ditampilkan.

### 9.1 Tabel penanganan

| Kondisi | `error_code` | Penanganan | Pesan user |
|---|---|---|---|
| yt-dlp terkena bot-detection | `SOURCE_BLOCKED` | Retry dengan cookie pool, lalu backoff | "YouTube sedang memblokir permintaan kami. Coba lagi beberapa menit lagi." |
| Video privat / dihapus | `SOURCE_UNAVAILABLE` | Terminal, tanpa retry | "Video tidak dapat diakses. Pastikan videonya publik." |
| Geo-block | `SOURCE_GEOBLOCKED` | Terminal | "Video ini dibatasi untuk wilayah tertentu." |
| Batasan usia | `SOURCE_AGE_RESTRICTED` | Terminal | "Video ini punya batasan usia dan tidak bisa diproses." |
| Durasi melebihi batas | `SOURCE_TOO_LONG` | Terminal | "Video melebihi durasi maksimum (4 jam)." |
| Provider transkripsi gagal | `TRANSCRIBE_FAILED` | Fallback DeepInfra → Groq, lalu retry | "Transkripsi gagal, sedang dicoba ulang." |
| Key BYOK tidak valid / kuota habis | `BYOK_INVALID` | Terminal, **tidak dihitung sebagai retry** | "API key kamu ditolak provider. Periksa di halaman Pengaturan." |
| LLM mengembalikan JSON cacat | `LLM_BAD_OUTPUT` | Retry maksimal 2× dengan prompt perbaikan, lalu gagal | "AI memberi jawaban yang tidak terbaca. Coba model lain." |
| Worker mati di tengah job | `WORKER_LOST` | Reaper mengembalikan ke antrian | (tidak terlihat user; progress berlanjut) |

### 9.2 Risiko operasional utama: kerusakan extractor yt-dlp

Ini titik kegagalan tunggal yang paling mungkin melumpuhkan produk. Mitigasi wajib ada sejak P0:

- Versi yt-dlp **di-pin**, dengan jalur update cepat yang tidak memerlukan rilis aplikasi penuh.
- **Healthcheck harian** terhadap sekumpulan URL kanari (YouTube, TikTok, Google Drive). Kegagalan memicu alert ke operator.
- Tujuannya: operator mengetahui kerusakan sebelum user melaporkannya.

---

## 10. Strategi Testing

**Unit** — logika murni, berjalan pada setiap commit:
- Normalisasi URL → bentuk kanonik (`youtu.be/x`, `youtube.com/watch?v=x`, `youtube.com/shorts/x` harus menghasilkan `external_id` identik)
- Derivasi kunci cache dan `input_hash`
- State machine job
- Enkripsi dan dekripsi key BYOK
- Slicing transkrip berdasarkan rentang waktu
- **Parser output LLM → kandidat klip.** Komponen paling rawan; LLM kerap mengembalikan JSON cacat. Diuji dengan fixture respons buruk yang nyata.

**Integrasi** — Postgres lokal dan MinIO sebagai pengganti R2:
- **Concurrency queue:** lima worker memperebutkan dua puluh job; tidak boleh ada job diproses dua kali. `SKIP LOCKED` mudah salah pakai, jadi ini wajib.
- **Idempotensi:** menjalankan ulang job tidak menggandakan baris dan tidak menagih dua kali.
- **Reaper:** worker yang mati di tengah jalan membuat job kembali ke antrian, bukan menggantung.

**Keamanan** — kelas tes tersendiri, bukan opsional:
- Sumber privat milik user A tidak pernah terbaca atau terpakai oleh user B. Diuji melalui RLS dengan dua JWT berbeda, mencakup `sources`, `transcripts`, `media_segments`, dan `llm_runs`.
- Sebaliknya, pada sumber publik cache **harus** kena: user B menempel URL yang sama dengan user A tidak boleh memicu pemanggilan API baru. Diuji sebagai pasangan dari tes di atas, agar penguatan privasi tidak diam-diam mematikan penghematan biaya.
- Key BYOK tidak pernah muncul di respons API mana pun, termasuk payload error dan log.

**Kontrak eksternal** — respons asli DeepInfra, Groq, dan yt-dlp direkam sekali sebagai fixture lalu diputar ulang. **CI tidak pernah memanggil jaringan.**

**End-to-end** — satu happy path terhadap video YouTube publik pendek yang nyata. Dijalankan **nightly**, bukan per-commit; dependensi eksternal terlalu tidak stabil untuk menjadi gerbang merge.

---

## 11. Cakupan

### 11.1 Termasuk dalam spec ini (P0 + P1)

- Monorepo Turborepo + Bun; kerangka aplikasi Next.js 15; schema dan migrasi Drizzle
- Auth Supabase: Google OAuth dan email/password
- Manajemen key BYOK: CRUD beserta enkripsi AES-256-GCM
- Service `downloader` (FastAPI): normalisasi URL, ingest audio, ranged segment
- Job queue, worker loop, reaper, dan progress via Supabase Realtime
- Integrasi R2 beserta aturan lifecycle
- Adapter transkripsi (DeepInfra primary → Groq fallback) dan spike word-timestamp
- Adapter LLM tiga provider, prompt, dan parsing kandidat
- Caching lapis media, transkrip, dan LLM; beserta RLS privasi
- UI: tempel URL → progress live → daftar sepuluh kandidat klip berskor lengkap dengan kutipan transkrip dan hook

### 11.2 Tidak termasuk

Rendering video, editor, WebCodecs, MediaPipe, Mediabunny (semuanya P2) · billing dan sistem kredit (P5) · auto-upload ke TikTok/YouTube (P5) · cloud render fallback (P5) · whisper di browser · dukungan tim dan multi-seat.

**Konsekuensi yang diterima secara sadar:** pada akhir spec ini belum ada satu pun file video yang dihasilkan. Outputnya adalah daftar kandidat klip di layar. Ini disengaja — bagian tersulit dan paling menentukan (kualitas pemilihan segmen) diverifikasi lebih dulu, sebelum investasi empat minggu membangun engine browser.

### 11.3 Peta jalan lengkap (konteks)

| Fase | Isi | Perkiraan |
|---|---|---|
| **P0** | Fondasi & Ingest | 2 minggu |
| **P1** | Pipeline AI | 2 minggu |
| **P2** | Engine browser + Editor A (preview, crop, caption, export) | 4 minggu |
| **P3** | Editor C — berbasis transkrip, penghapusan filler otomatis | 3 minggu |
| **P4** | Editor B — timeline multi-track, musik, transisi | 4 minggu |
| **P5** | Billing (Midtrans/Xendit) dan distribusi | 3 minggu |

MVP yang dapat dijual adalah P0 + P1 + P2.

---

## 12. Kriteria Sukses

| Kriteria | Target |
|---|---|
| Podcast Indonesia 1 jam → sepuluh kandidat berskor | < 3 menit |
| User kedua menempel URL yang sama | < 10 detik, biaya Rp0 |
| Biaya marjinal per video baru | < Rp350 |
| Kualitas transkrip Bahasa Indonesia | Layak pakai, diverifikasi manual pada tiga video uji |
| Kebocoran sumber privat antar user | 0 — tes keamanan lulus |
| Job terduplikasi di bawah beban concurrent | 0 — tes concurrency lulus |

---

## 13. Keputusan Terbuka

Satu hal yang sengaja belum ditetapkan:

**Spesifikasi Sumopod belum diketahui** (jumlah vCPU, RAM, ketersediaan GPU, kuota bandwidth). Worker karenanya dirancang hardware-agnostic dan tidak mengasumsikan GPU. Karena P0/P1 hanya melakukan download dan ekstraksi audio — keduanya I/O bound — spesifikasi rendah sekalipun memadai. Yang perlu diverifikasi sebelum peluncuran adalah **kuota bandwidth**, karena itulah satu-satunya sumber daya server yang tumbuh bersama jumlah user.

Semua keputusan lain dalam dokumen ini sudah final untuk cakupan P0 + P1.
