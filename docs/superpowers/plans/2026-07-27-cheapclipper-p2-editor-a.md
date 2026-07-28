# CheapClipper P2 — Engine Browser + Editor A

## Task 1: Kontrak engine

- Tambah workspace `@cheapclipper/engine`.
- Definisikan dan validasi `EditSpecV1`.
- Implementasikan geometri crop, caption grouping, dan canvas compositor.
- Tambah unit test deterministik.

## Task 2: Orkestrasi clip

- Implementasikan create/load/update clip dengan ownership filter.
- Enqueue `fetch_segments` saat draft dibuat.
- Tambah API create, poll/read, dan update.
- Buat presigned URL R2 hanya setelah ownership check.

## Task 3: Editor

- Tambah tombol Edit pada candidate list.
- Tambah halaman `/clips/[id]`.
- Implementasikan polling segment, canvas preview, playback, seek, crop focus,
  caption controls, save, dan status.

## Task 4: Export dan auto-focus

- Gunakan Mediabunny Conversion untuk MP4 H.264/AAC.
- Terapkan compositor yang sama pada setiap decoded frame.
- Tambah capability check dan progress.
- Tambah MediaPipe face-based auto focus opsional.

## Task 5: Hardening

- Security/data tests lintas user.
- Engine tests dan component tests.
- Full TypeScript/Python regression, typecheck, dan production build.
- Dokumentasikan requirement browser dan flow P2.
