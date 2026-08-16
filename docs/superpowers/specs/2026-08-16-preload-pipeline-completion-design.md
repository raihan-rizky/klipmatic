# Desain: Penyelesaian Preload Pipeline 9:16

Tanggal: 2026-08-16
Status: disetujui untuk implementasi

## Tujuan

Menutup celah pada implementasi preload preview 9:16 agar migration production
terpasang, status render tampil secara live, dan klik kandidat memakai preview
yang sudah dirender tanpa menunggu pembuatan klip baru.

## Perubahan

1. **Database production**
   - Tambahkan `preview_status` dan `preview_r2_key` ke schema Drizzle.
   - Daftarkan migration `0003_candidate_preview_renders` pada metadata Drizzle
     agar `drizzle-kit migrate` menjalankannya di production.

2. **Lifecycle render**
   - Worker menetapkan kandidat ke `rendering` sebelum proses download/render.
   - Kandidat berakhir pada `ready` dengan key R2, atau `failed` bila kandidat
     tersebut gagal; kegagalan satu kandidat tidak menghentikan batch.

3. **Pembaruan hasil di browser**
   - Halaman proyek memonitor job `render_previews` selain thumbnail job.
   - Selama render aktif, hasil kandidat diperbarui secara berkala/realtime;
     setelah job terminal, polling dihentikan.
   - Data kandidat yang baru membuat modal memakai URL preview pre-render,
     bukan fallback `createPreviewClip`.

4. **Modal portrait**
   - Preview pre-render ditampilkan dalam wadah 9:16.
   - Pembukaan dari card memicu playback best-effort melalui user gesture.
   - Jalur fallback menunjukkan loading state 9:16.

## Acceptance criteria

- Production migration runner mengenali migration `0003`.
- UI dapat menunjukkan `pending`, `rendering`, `ready`, dan `failed` dari data
  nyata.
- Kandidat yang sudah `ready` dapat dibuka tanpa request pembuatan clip.
- Preview tampil portrait dan mulai diputar bila kebijakan browser mengizinkan.
- Regression tests mencakup setiap gap; Python, web tests, dan typecheck lulus.
