# Desain: Editor Page Overhaul — Wayfinding, Feedback, Shortcut, Performa, dan Paritas Mobile

Tanggal: 2026-08-23
Status: disetujui

## Konteks

Halaman editor (`app/clips/[id]` + `components/editor/*`) sudah berfungsi:
playback engine stabil, autosave jalan, undo/redo ada, media library lengkap.
Tapi lima keluhan pengguna muncul saat pemakaian nyata:

1. **UX membingungkan** — peran panel tidak jelas, alur transitions berbelit,
   feedback muncul di bawah halaman yang tidak terlihat, shortcut tersembunyi.
2. **Lag** — redraw canvas boros, re-render React berlebihan.
3. **Visual tidak responsif di mobile** — panel memaksa scroll, target sentuh
   kecil, transport bisa hilang dari layar.
4. **Layout & polish** — tidak ada identitas visual antar panel.
5. **Interaksi timeline** — split/trim/drag berfungsi tapi tanpa affordance.

Pendekatan yang disetujui: **Approach C — structured polish + wayfinding**.
Skeleton 3-region dipertahankan (media | preview | inspector, timeline di
bawah); setiap pain point ditangani struktural tanpa menyentuh command layer
engine (`@klipmatic/engine`) maupun pipeline export.

Paritas perangkat: **equal parity** — desktop dan mobile didesain setara.

## Bagian 1 — Wayfinding & peran panel

### Header panel

Setiap region dapat header ramping persisten:

| Region | Header |
|---|---|
| Media rail | "Media" + readout kuota (`usedBytes / limitBytes`) |
| Inspector | Judul dinamis dari seleksi (lihat bawah) |
| Preview | Tetap tanpa chrome — video adalah hero |

Komponen baru `PanelHeader` (judul + slot aksi kanan), dipakai ketiga region
desktop; versi mobile menempel di atas sheet.

### Judul inspector kontekstual

Inspector menampilkan judul sesuai `TimelineSelection`:

- `{ kind: 'clip' }` → `Clip · {assetName}` (+ hint: "Geser di canvas untuk memindah / resize")
- `{ kind: 'track' }` → `Track · {trackName}`
- `{ kind: 'transition' }` → `Transition · {type}`
- `{ kind: 'joint' }` → `Cut point` (popover langsung muncul, lihat bawah)
- null → `Editor`

Di bawah judul: satu baris hint muted yang menjelaskan apa yang bisa dilakukan
pada seleksi aktif.

### Struktur isi inspector

Saat ini `LayerInspector` menampilkan kontrol track generik di atas kartu clip.
Urutan baru:

1. Kartu kontekstual seleksi (`AssetInspector` / `TransitionInspector`)
   selalu paling atas.
2. Kontrol sekunder layer (rename, duplikat, hapus) dalam accordion
   "Layer settings", collapsed default kecuali seleksi adalah track.

Empty state actionable: "Pilih clip di timeline untuk mengedit, atau drop media
ke preview." dengan dua tombol pintas (pilih clip pertama / buka Media).

### Transitions tanpa detour

Masalah: klik joint hanya menyeleksi lalu menyuruh buka tab Transitions.

Solusi: klik joint membuka **popover inline di titik potong** pada timeline:

- Grid tombol 3 tipe transition (`fade`, `cross-dissolve`, `dip-to-black`
  — dari `TRANSITION_TYPES` engine).
- Slider durasi (clamp `joint.maxDuration`, step frame).
- Tombol Add → dispatch `addTransition` + seleksi pindah ke transition baru.
- Esc/klik luar menutup tanpa menambahkan.

Tab Transitions di library tetap ada untuk browse + drag ke tepi clip
(`clip-edge` target tetap via drag). Popover hanya menangani `between-clips`.

## Bagian 2 — Feedback visibility

### Toast stack di atas preview

Komponen baru `EditorToasts`: stack absolut `top-right` di dalam container
preview (di atas canvas, pointer-events-none kecuali pada toast).

- Success/info (autosave tersimpan, wajah terdeteksi, media siap): auto-dismiss
  4 detik, tombol tutup manual.
- Warning (asset expiring): tetap toast tapi durasi lebih lama (8 detik).
- Maksimal 3 toast tampil; sisanya antre.
- `role="status"` + `aria-live="polite"` dipertahankan di container.

Semua pemanggilan `setNotice(...)` diganti API `showToast(message, tone)`.

### Error banner persisten

Error yang butuh aksi (ekspor gagal, stall playback, simpan gagal) TIDAK boleh
auto-dismiss: menjadi banner `tone="danger"` yang menempel **tepat di atas
transport bar** preview. Berisi pesan + aksi retry bila relevan. Hilang hanya
saat kondisi error beres atau user dismiss setelah masalah selesai.

### Konsolidasi header

`EditorActionBar` (kotak floating di bawah halaman) **dihapus**. Isinya pindah:

- Chip status simpan di header diberi warna: muted = saved, amber = unsaved/
  saving, merah = error (dengan tombol retry inline yang sudah ada).
- Tombol **Ekspor MP4** pindah ke header kanan. Saat exporting: label progress
  % menggantikan label tombol + Progress bar tipis di bawah header full-width.
- Peringatan export unsupported jadi badge warning di header dengan tooltip
  alasan (klik membuka popover penjelasan).

Hasil: tidak ada lagi kotak aksi terpisah di bawah workspace; halaman editor =
workspace penuh.

## Bagian 3 — Shortcut & discoverability

### Handler global

Keydown handler pindah dari `<section>` timeline ke `ClipEditor`
(satu `useEffect` di window). Guard: abaikan bila target adalah input/textarea/
select/contentEditable. Keys:

| Key | Aksi |
|---|---|
| Space | Play/pause |
| S | Split di playhead |
| Delete / Backspace | Hapus clip terpilih |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Shift+Z | Redo |
| ← / → | Step 1 frame (Shift = 1 detik) |
| Home / End | Lompat ke awal/akhir timeline |
| ? | Buka cheat sheet |

Logika pemilihan target split/delete tetap membaca `selected` state; handler
baru hanya delegasi ke callback yang sama seperti sekarang (perilaku keyboard
timeline lama dihapus supaya tidak double-fire).

### Cheat sheet overlay

- Komponen `ShortcutHelpDialog` (Dialog existing): daftar shortcut dua kolom,
  dikelompokkan Playback / Editing / Navigasi.
- Dibuka via `?` dan ikon keyboard baru di TimelineToolbar.
- Hint one-time (localStorage `klipmatic-shortcut-hint-dismissed`) berupa pill
  kecil di ujung toolbar: "Tekan ? untuk shortcut" dengan tombol ×.

### Tooltip kbd

Button toolbar play/split/delete/undo/redo/zoom mendapat tooltip (Tooltip
component existing) berisi nama + kbd hint ("Split — S").

## Bagian 4 — Performa

Mengimplementasikan Sub-proyek 5 dari spec 2026-08-16 plus temuan audit kode:

1. **Memoisasi transition per frame.** `evaluateTransitions(spec, outputTime)`
   saat ini dieksekusi di setiap `drawFrame`. Diekstrak ke helper dengan cache
   keyed oleh `(spec identity, quantized time bucket 1/frame)`; invalidasi
   otomatis saat spec berganti referensi.
2. **Throttle redraw saat pause.** Saat `playing === false`, redraw dibatasi
   maksimal ~30fps dan dilewati bila tidak ada perubahan (cek identitas
   spec/playhead/seleksi). Saat playing, loop rAF controller tetap menggambar
   tiap frame tanpa throttle tambahan.
3. **rAF coalescing playhead.** Update `onTime` dari controller dan event
   `onChange` slider dialirkan lewat satu sink `requestAnimationFrame`; React
   state `playhead` commit maksimal sekali per frame. Nilai terakhir selalu
   menang.
4. **Stabilisasi context.** Di `ClipEditor`, `timelineContext` membuat ulang
   `Object.fromEntries` setiap tick polling upload (identitas `assets` berubah).
   Asset map di-memoize per daftar id→metadata sehingga referensi stabil bila
   isi tidak berubah. Hal sama untuk `previewAssets`.
5. **Dep effect sempit.** Effect pembuat playback controller di
   `TimelinePreview` bergantung pada `spec/timelineContext/timelineWords`;
   dipastikan objek-objek tersebut stabil (poin 4) sehingga controller tidak
   di-teardown saat state tak relevan berubah.

Target terukur: scrubbing saat pause ≤1 draw per frame; tidak ada teardown
controller saat drag slider/upload poll; interaksi tetap responsif selama
playback.

## Bagian 5 — Paritas mobile

### Layout stacked (< lg)

Urutan vertikal: preview → timeline → tab bar sticky dengan dua sheet
full-height (**Media**, **Inspector**) ber-header sticky (menggantikan Sheet
generik sekarang). Tab bar memakai segmented control; sheet menutup dengan
swipe-down atau tombol ×.

### Transport sticky mobile

Transport bar (play, time, scrubber) `sticky bottom-0` pada viewport mobile —
tidak pernah scroll keluar layar. Di desktop posisi tetap di bawah preview
seperti sekarang.

### Target sentuh

Audit semua kontrol editor ke ≥44×44px: joint target, ikon transition di
timeline, tombol zoom, tab media, chip header, tombol tutup toast/popover.
Trim handle sudah 44px — dipertahankan.

### Pinch-zoom & scroll

`touch-action: pan-x pinch-zoom` pada `.timeline-scroll` dipertahankan; zoom
button mendapat padding sentuh lebih besar tanpa mengubah ukuran visual ikon.

## Bagian 6 — Error handling

- Semua async action (save/export/upload/deteksi wajah) tetap try/catch;
  jalur error kini selalu berujung ke error banner persisten (Bagian 2),
  bukan notice success yang salah tempat.
- Toast error tidak dipakai untuk failure yang butuh aksi user — hanya banner.
- Stall playback: banner + tombol "Coba putar lagi" yang memanggil
  controller seek+play.

## Testing

Framework: vitest + testing-library (sudah ada di `apps/web/test`).

- Update `TimelineEditor.test.tsx` — popover joint, handler global key.
- Update `MediaLibrary.test.tsx` — header kuota, tab sheet mobile.
- Test baru:
  - `EditorToasts` — auto-dismiss, max stack, aria-live.
  - Shortcut handler — space/s/delete/undo/? ; abaikan saat fokus di input.
  - Joint popover — pilih tipe, clamp durasi, Add dispatch command benar.
  - Helper throttled redraw & rAF sink sebagai unit pure.
  - Header konsolidasi — status chip warna, tombol ekspor pindah.
- Fixture editor (`editorFixtures.ts`) diperluas bila perlu.
- Verifikasi manual: desktop Chrome (scrub sambil playing, undo beruntun),
  mobile viewport DevTools iPhone SE (stacked layout, transport sticky,
  semua target ≥44px).

## Out of scope

- Perubahan `@klipmatic/engine` (command system, composite renderer).
- Fitur editing baru (effects, keyframe, multi-select clip).
- Pipeline export & worker.
- Halaman lain di luar `/clips/[id]`.

## Risiko & mitigasi

- **Handler keyboard global bisa bentrok dengan Radix Dialog** (Space/Esc).
  Mitigasi: guard `event.defaultPrevented` + cek dialog open state.
- **Toast menutupi canvas di layar kecil.** Mitigasi: toast mobile pindah ke
  bawah transport, max-width 90vw.
- **Throttle pause-redraw bisa membuat frame basi setelah media load lambat.**
  Mitigasi: event `loadeddata` tetap memicu redraw paksa (sudah ada lewat
  `redrawLoadedFrame`), bypass throttle.
- **Perubahan luas menyentuh banyak test.** Mitigasi: helper diekstrak pure
  agar testable; perubahan komponen bertahap per bagian desain.
