# Klipmatic — Video Editor Timeline Foundation

**Tanggal:** 2026-07-28

**Status:** Disetujui untuk dokumentasi

**Cakupan:** fase 1 fondasi timeline multi-layer, trim, split, ripple, dan autosave

## Outcome

Editor klip berubah dari workspace berbasis card menjadi video editor dengan
preview utama, inspector, dan timeline multi-track. User dapat memangkas
candidate segment secara non-destructive, membelah klip, menghapus bagian
dengan auto-ripple, serta mengatur layer pada desktop, tablet, dan mobile.

Fase ini memakai candidate segment yang sudah tersedia sebagai media source.
User belum dapat mengunggah asset baru atau memperpanjang range ke luar
candidate.

## Batas Fase

Fase 1 mencakup:

- timeline multi-track;
- layer video, audio, dan caption;
- add empty layer, rename, reorder, hide atau mute, lock, duplicate, dan
  delete layer;
- playhead, ruler, selection, zoom, snapping, trim, split, dan delete;
- auto-ripple untuk structural edit pada primary video sequence;
- undo dan redo selama tab aktif;
- autosave edit spec;
- preview dan export yang membaca timeline spec yang sama;
- migrasi otomatis dari edit spec v1;
- full editing pada desktop, tablet, dan mobile.

Fase 1 tidak mencakup:

- upload atau asset library;
- media di luar candidate segment;
- transitions;
- filters, effects, atau keyframes;
- cloud render;
- realtime collaboration;
- persistent undo history setelah refresh.

## Architecture

Satu normalized `EditSpecV2` menjadi source of truth untuk timeline UI,
preview, autosave, dan export. UI mengirim command ke pure timeline engine.
Engine mengembalikan spec baru yang valid; component React tidak melakukan
ripple math atau time mapping sendiri.

Unit utama:

- `TimelineEditor` mengoordinasikan playhead, zoom, selection, dan command;
- `TimelineTrack` merender satu row layer;
- `TimelineClip` menangani selection, drag, dan trim handles;
- `TimelineToolbar` menyediakan transport, undo, redo, split, zoom, dan snap;
- `LayerInspector` menangani properties layer dan selected clip;
- timeline engine menangani normalization, migration, trim, split, ripple,
  mapping waktu, stacking, dan duration calculation;
- preview adapter memetakan output playhead ke media source time;
- export adapter mengonsumsi timeline mapping yang sama dan merebase timestamp.

Setiap unit berkomunikasi lewat data dan command yang typed. Preview dan export
tidak memiliki default timeline atau rumus timing sendiri.

## Edit Spec v2

```ts
type EditSpecV2 = {
  version: 2
  output: {
    width: 1080
    height: 1920
    frameRate: 30
  }
  timeline: {
    primaryTrackId: string
    duration: number
    tracks: TimelineTrack[]
  }
  crop: CropSettings
  captions: CaptionSettings
}

type TimelineTrack = {
  id: string
  type: 'video' | 'audio' | 'caption'
  name: string
  order: number
  hidden: boolean
  locked: boolean
  clips: TimelineClip[]
}

type TimelineClip = {
  id: string
  sourceId: string
  linkGroupId?: string
  timelineStart: number
  sourceIn: number
  sourceOut: number
}
```

`timeline.duration` adalah derived value yang selalu dihitung ulang oleh
normalizer dari primary video sequence. Client tidak boleh memperlakukannya
sebagai input bebas.

`sourceIn` dan `sourceOut` relatif terhadap candidate segment, bukan video
panjang asli. Contoh candidate 30 detik yang di-trim menjadi detik 4 sampai 24:

```text
Source video: 0s ------------------------------ 30s
Active range:     4s ---------------- 24s
Output:           0s ---------------- 20s
```

Audio dan caption menggunakan source range serta timeline mapping yang sama
dengan primary video. Pada audio track, `hidden` berarti muted. Pada visual
track, `order` menentukan stacking; track visual paling atas dirender paling
depan. Urutan audio tidak mengubah mixing priority. `linkGroupId` mengikat
video, audio, dan caption clip yang berasal dari potongan yang sama agar
structural edit dapat menggeser ketiganya secara sinkron.

Track baru dapat dibuat kosong. Karena asset import belum tersedia, duplicate
track atau clip hanya dapat memakai candidate source dan transcript yang sama.
Primary video track terakhir tidak dapat dihapus; user dapat mengosongkan
clips-nya atau membuat video track lain lalu menetapkannya sebagai primary.

## Migrasi v1 ke v2

Saat spec v1 dibuka, migration pure function membuat:

- satu primary video track;
- satu audio track;
- satu caption track;
- satu clip pada setiap track dengan range `0` sampai durasi candidate;
- crop dan caption styling yang sama dengan spec v1.

Migration bersifat deterministic dan idempotent. Hasil v2 disimpan pada
autosave pertama. Backend menerima v1 selama masa kompatibilitas dan selalu
mengembalikan normalized v2 ke editor baru.

## Workspace Layout

Desktop dan tablet memakai workspace:

```text
┌ Header: Back | Project title | Save status | Export ┐
├────────────── Preview ──────────────┬─ Inspector ───┤
│             canvas 9:16             │ layer/clip    │
│          playback controls          │ properties    │
├──────────── Timeline toolbar ────────┴───────────────┤
│ Layer controls │ clips, playhead, ruler, and ranges │
└──────────────────────────────────────────────────────┘
```

Canvas 9:16 menjadi satu-satunya preview utama. Source media element tetap
hidden sebagai frame dan audio provider sehingga user tidak melihat preview
source kedua.

Pada mobile:

- preview berada di atas;
- timeline horizontal berada di bawah dan dapat di-scroll;
- track header memakai mode compact;
- inspector dibuka sebagai bottom sheet;
- toolbar penting tetap terlihat tanpa hover;
- touch target minimum 44 × 44 piksel.

## Timeline Interaction

- Tap atau click memilih clip dan memindahkan playhead.
- Playhead dapat di-drag.
- Trim handles mengubah `sourceIn` atau `sourceOut` tanpa mengubah source file.
- Split membuat dua clip bersebelahan pada posisi playhead.
- Delete pada primary video clip atau selected range menutup gap dan
  menggeser seluruh downstream timeline, termasuk audio dan caption.
- Delete overlay/non-primary clip hanya menghapus overlay tersebut dan tidak
  memendekkan primary sequence.
- Clip edge dan playhead snap berdasarkan pixel threshold yang konsisten pada
  semua zoom level.
- Mouse wheel dengan modifier, zoom buttons, dan pinch gesture mengubah scale
  timeline.
- Long-press memilih lalu memindahkan item pada touch device.
- Locked layer dapat diputar tetapi menolak trim, split, move, dan delete.
- Hidden visual layer tidak masuk preview/export; hidden audio layer muted.
- Delete primary video track memindahkan status primary ke video track lain.
  Jika tidak ada video track lain, delete ditolak dengan reason eksplisit.

Desktop keyboard shortcuts bersifat accelerator:

- `Space`: play atau pause;
- `S`: split di playhead;
- `Delete` atau `Backspace`: delete selection;
- `Ctrl/Cmd + Z`: undo;
- `Ctrl/Cmd + Shift + Z`: redo;
- arrow keys: nudge playhead.

Semua shortcut mempunyai button atau accessible input equivalent.

## Playback dan Time Mapping

Setiap gesture menghasilkan alur:

```text
User gesture
→ timeline command
→ normalized EditSpecV2 baru
→ preview update
→ undo stack update
→ autosave queue
```

Output time dipetakan ke source time melalui active clip:

```text
sourceTime = sourceIn + (playhead - timelineStart)
```

Ketika playhead melewati cut, preview adapter memilih active clip berikutnya
dan seek ke source range yang sesuai. Caption word hanya muncul jika berada
di active source range, lalu waktunya direbase ke output timeline. Audio
mengikuti mapping yang sama agar gambar, suara, dan caption tetap sinkron.

Undo dan redo menyimpan normalized spec snapshot atau reversible command selama
tab aktif. Autosave bukan timeline command dan tidak menambah history entry.
History reset setelah refresh.

## Auto-Ripple Rules

Primary video track menentukan struktur dan durasi output fase 1.

- Trim awal primary sequence memindahkan awal output ke nol.
- Trim akhir memperpendek output.
- Menghapus bagian tengah menyambungkan range sebelum dan sesudahnya.
- Semua downstream clip yang mempunyai `linkGroupId` sama pada audio dan
  caption ikut bergeser dengan delta yang sama.
- Overlay/non-primary track mengikuti ripple region agar tetap sinkron, tetapi
  menghapus overlay saja tidak mengubah durasi output.
- Engine menolak ripple yang menghasilkan range negatif atau clip lebih pendek
  dari satu frame.

## Autosave

Perubahan langsung tampil di UI. Setelah user idle sekitar satu detik, client
mengirim full normalized `EditSpecV2` ke `PATCH /api/clips/:id`.

Autosave memakai serialized queue:

- hanya satu request aktif;
- edit selama request aktif ditandai sebagai snapshot terbaru;
- snapshot terbaru dikirim segera setelah request aktif selesai;
- response lama tidak boleh menimpa local state yang lebih baru;
- status header bergerak dari `Unsaved` ke `Saving…`, lalu `Saved`;
- export menunggu queue selesai;
- navigation atau tab close dengan perubahan belum tersimpan memicu browser
  warning.

Multi-tab memakai last-write-wins pada fase 1.

## Export

Export membaca `EditSpecV2` yang sama dengan preview:

- hanya source ranges aktif yang diproses;
- video dan audio timestamp direbase ke output timeline;
- visible visual track dirender sesuai stacking order;
- muted audio track tidak masuk mixing;
- caption memakai word time yang sudah dipetakan;
- progress memakai total output duration setelah trim dan ripple.

Jika semua visual track kosong atau hidden, editor menampilkan empty preview
dan export meminta konfirmasi sebelum membuat video hitam.

## Validation

Normalizer memastikan:

- `sourceIn >= 0`;
- `sourceOut <= candidateDuration`;
- `sourceOut > sourceIn`;
- clip minimum satu output frame;
- `timelineStart >= 0`;
- track dan clip ID unik;
- `linkGroupId` tetap konsisten saat split, duplicate, dan ripple;
- `primaryTrackId` menunjuk video track yang valid;
- order track deterministic;
- locked track tidak dapat dimutasi oleh command;
- derived duration, ripple result, dan mapping tidak negatif;
- input v1 atau v2 yang malformed dipulihkan ke spec valid.

Backend menjalankan normalizer yang sama sebelum menyimpan payload. Payload
invalid tidak boleh membuat editor, preview, atau export crash.

## Error Handling

- Autosave failure mempertahankan edit di memory, menampilkan `Save failed`,
  dan menyediakan retry. Autosave berikutnya mencoba lagi.
- Media seek failure atau stall mem-pause playback dan menyediakan `Coba lagi`;
  timeline state tetap aman.
- Browser tanpa WebCodecs yang dibutuhkan tetap dapat preview dan edit, tetapi
  export disabled dengan reason eksplisit.
- Export failure tidak menghapus spec dan dapat diulang.
- Invalid gesture dikembalikan ke normalized state valid terakhir.
- Empty atau fully hidden visual timeline menampilkan empty state yang jelas.

## Accessibility

- Trim handles diekspos sebagai accessible sliders dengan label waktu.
- Semua gesture mempunyai alternatif button atau numeric time input.
- Keyboard focus mengikuti selected clip atau layer.
- Save dan export status diumumkan lewat live region.
- Lock, hide, mute, dan selected state tidak hanya dibedakan dengan warna.
- Touch target minimum 44 × 44 piksel.
- Reduced motion mematikan animated scrolling dan decorative transitions.

## Testing

### Engine unit tests

- migrasi v1 ke v2;
- normalization input invalid;
- trim kiri dan kanan;
- split pada playhead;
- delete dan auto-ripple;
- overlay delete tanpa mengubah primary duration;
- caption dan audio time mapping;
- track reorder, lock, hide, dan mute;
- undo dan redo result;
- timeline duration.

### Component tests

- trim handle mengirim command yang benar;
- locked layer men-disable mutation;
- split dan delete memakai selection aktif;
- autosave debounce dan serialized request;
- save failure mempertahankan edit terbaru;
- export menunggu autosave;
- keyboard shortcuts dan accessible sliders.

### Browser validation

- desktop mouse drag, keyboard shortcut, dan timeline zoom;
- tablet/mobile touch trim, horizontal scroll, pinch zoom, dan bottom sheet;
- preview sync setelah trim, split, dan ripple;
- refresh memulihkan spec v2 tersimpan;
- export duration sesuai timeline final;
- tidak ada overflow, unreachable control, focus trap, atau console error baru.

Quality gates mencakup unit tests, component tests, TypeScript typecheck,
production build, dan browser checks yang relevan.

## Definition of Done

- Editor memakai layout preview, inspector, dan multi-track timeline.
- User dapat add, rename, reorder, hide atau mute, lock, duplicate, dan delete
  layer.
- User dapat play, seek, zoom, trim, split, auto-ripple delete, undo, dan redo.
- Caption, audio, preview, serta export tetap sinkron.
- Autosave reliable dengan status eksplisit dan retry.
- Full editing usable pada desktop, tablet, dan mobile.
- Existing spec v1 terbuka dan bermigrasi tanpa kehilangan styling.
- Seluruh quality gate lulus.
