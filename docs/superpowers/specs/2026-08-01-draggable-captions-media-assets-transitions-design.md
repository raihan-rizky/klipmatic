# Klipmatic — Draggable Captions, Media Assets, Presets, and Transitions

**Tanggal:** 2026-08-01

**Status:** Disetujui untuk dokumentasi

**Cakupan:** draggable caption, upload dan insert media, built-in media
presets, serta Essential transitions pada editor timeline

## Outcome

User dapat memindahkan caption langsung di preview video, mengunggah audio,
picture, atau video, serta menaruh media tersebut pada posisi spatial dan waktu
yang diinginkan. User juga dapat memilih sound effect, sticker, stock photo,
atau background bawaan tanpa upload dari luar.

Video panjang harus di-split terlebih dahulu sebelum transition dapat dipasang.
User menyeret transition ke joint antara dua clip hasil split, lalu timeline
menampilkan icon transition tepat di tengah kedua clip. Preview dan export
mengonsumsi asset, transform, timing, audio, dan transition spec yang sama.

## Scope dan Urutan Delivery

Delivery dibagi menjadi tiga slice yang memakai fondasi data yang sama:

1. canvas media: draggable caption, upload audio/picture/video, timeline
   placement, serta visual move dan resize;
2. preset library: built-in sound effects, stickers/overlays, stock photos, dan
   backgrounds;
3. transitions: Essential pack, drop targets, joint icon, preview, dan export.

Scope ini tidak menambahkan rotation, filters, free-form effects, keyframes,
custom transition upload, atau cloud rendering. Export tetap browser-first.

## Architecture

Satu Asset Catalog menjadi source of truth untuk uploaded dan built-in media.
Timeline menyimpan stable `assetId`, bukan blob URL atau expiring signed URL.
Server melakukan ownership check lalu me-resolve asset yang boleh diakses ke
fresh signed URL. Preview dan export memakai resolver yang sama.

Uploaded asset mempunyai metadata dan object privat di R2. Built-in asset
menggunakan catalog global read-only dan storage/CDN yang dikelola aplikasi.
Keduanya masuk timeline melalui command engine yang sama sehingga insert,
move, trim, delete, undo, autosave, preview, dan export tidak memerlukan jalur
khusus per sumber asset.

Komponen utama:

- `MediaLibrary` menampilkan Uploads, Presets, dan Transitions;
- `MediaUploadQueue` mengelola validasi client, progress, retry, dan finalize;
- `AssetResolver` mengubah stable asset ID menjadi playable signed URL;
- `TimelinePreview` merender media pool berdasarkan asset tiap clip;
- `CanvasSelectionOverlay` menangani pointer/touch move dan resize;
- timeline engine menangani insert, move, trim, transform, link, dan transition;
- `TransitionDropTarget` menerima transition pada clip edge atau valid joint;
- preview dan browser export memakai compositor dan transition evaluator yang
  sama.

Setiap pointer gesture memakai transient preview state. Satu normalized command
baru dikirim setelah pointer-up, sehingga drag satu kali menghasilkan satu undo
entry dan satu autosave change, bukan ratusan mutation per pixel.

## Asset Data Model

Asset record minimal menyimpan:

```ts
type MediaAsset = {
  id: string
  ownerId: string | null
  projectId: string | null
  source: 'candidate' | 'upload' | 'builtin'
  mediaType: 'image' | 'audio' | 'video'
  status: 'uploading' | 'ready' | 'failed' | 'expired'
  name: string
  storageKey: string
  mimeType: string
  bytes: number
  width: number | null
  height: number | null
  duration: number | null
  lastUsedAt: string | null
  expiresAt: string | null
}
```

Uploaded dan candidate asset wajib terikat ke owner/project. Candidate asset
merepresentasikan media segment Klipmatic yang sudah ada dan tidak dihitung
ke upload quota atau retention baru. Built-in asset mempunyai `source:
'builtin'`, tidak mempunyai owner/project, tidak expired, dan tidak dihitung ke
quota user.

Timeline clip diperluas dengan stable asset reference dan optional transform:

```ts
type VisualTransform = {
  x: number
  y: number
  width: number
  height: number
}

type TimelineClip = {
  id: string
  assetId: string
  linkGroupId?: string
  timelineStart: number
  sourceIn: number
  sourceOut: number
  transform?: VisualTransform
}
```

`x`, `y`, `width`, dan `height` memakai coordinate normalized `0..1` terhadap
output canvas. Normalizer meng-clamp transform ke batas aman sambil tetap
memungkinkan sebagian visual berada di luar canvas saat user memang menyeretnya
ke edge. Rotation belum didukung.

Caption position tetap menjadi setting global per clip edit spec melalui
`captions.positionX` dan `captions.positionY`. Memindahkan caption aktif
memindahkan semua caption hasil transcript pada clip tersebut; user tidak
mengatur posisi per kalimat.

## Edit Spec Migration

Perubahan asset reference, visual transform, dan transition menghasilkan
`EditSpecV3`. Migration dari current `EditSpecV2` bersifat deterministic:

- server meng-upsert candidate asset untuk media segment existing;
- setiap `sourceId` current clip diubah menjadi candidate `assetId` yang stabil;
- existing visual clip memperoleh full-canvas default transform sehingga hasil
  preview tidak berubah;
- `captions.positionX` default ke `0.5`, sedangkan existing `positionY` tetap
  dipertahankan;
- `timeline.transitions` dimulai sebagai array kosong.

API menerima V2 dan V3 selama compatibility window, tetapi selalu
me-normalize response editor ke V3. Autosave pertama menyimpan hasil migration.
Migration idempotent dan tidak membuat duplicate asset record.

## Upload Flow dan Limits

Upload memakai alur berikut:

```text
Select/drop local file
→ client type/size precheck
→ create asset request
→ server ownership and quota check
→ presigned R2 upload
→ upload progress
→ finalize request
→ server object/metadata validation
→ asset ready
→ insert at playhead
```

Limits:

- image maksimum 10 MB per file;
- audio maksimum 25 MB per file;
- video maksimum 100 MB per file;
- total uploaded asset aktif maksimum 300 MB per project.

Server menjadi authority untuk MIME, bytes, ownership, dan quota. Client check
hanya memberi feedback lebih cepat. Timeline tidak menerima asset sebelum
status `ready`. Upload yang terputus dapat di-retry tanpa membuat duplicate
timeline clip. Upload yang tidak pernah selesai dibersihkan setelah satu jam.

Default insert behavior:

- image, sticker, stock photo, atau background dimulai di playhead dengan
  durasi lima detik dan ukuran awal yang muat di canvas;
- video dan audio memakai native duration, di-clamp ke sisa output timeline;
- visual asset muncul di tengah canvas dan dapat dipindahkan serta di-resize;
- uploaded video dengan embedded audio membuat linked audio clip yang default
  muted;
- built-in sound effect masuk sebagai audio clip pada playhead;
- semua clip memakai snapping dan trim behavior timeline yang sudah ada.

## Retention dan Cleanup

Uploaded asset expired setelah tiga hari tidak dipakai. Aktivitas berikut
me-refresh `lastUsedAt` dan `expiresAt` untuk referenced assets:

- membuka project editor yang mereferensikan asset;
- melakukan export project yang mereferensikan asset.

Built-in asset tidak expired. Menghapus project menjadwalkan seluruh uploaded
asset project tersebut untuk segera dihapus. Cleanup job menghapus R2 object
dan menandai record expired secara idempotent.

Satu hari sebelum expiry, editor menampilkan warning. Setelah asset expired,
timeline clip dan transform tetap dipertahankan sebagai placeholder agar user
dapat memahami yang hilang serta memakai `Re-upload` atau `Replace`. Expired
asset tidak bisa di-preview atau di-export sampai diganti.

## Editor Layout dan Media Interaction

Desktop memakai Media drawer di kiri, 9:16 canvas di tengah, inspector di
kanan, dan timeline di bawah. Media drawer mempunyai tab Uploads, Presets, dan
Transitions. Pada mobile, drawer dan inspector menjadi sheet/bottom sheet;
canvas dan horizontal timeline tetap menjadi surface utama.

User dapat memasukkan asset dengan click/tap atau drag-and-drop. Drag pada
canvas mengubah posisi spatial. Corner handles mengubah ukuran sambil menjaga
aspect ratio secara default. Inspector menyediakan numeric X/Y/width/height
sebagai alternatif accessible. Drag pada timeline mengubah waktu mulai.

Caption mempunyai selection box yang sama dengan visual media tetapi hanya
mengubah global X/Y. Font, warna, background, max words, dan size tetap memakai
Caption Controls yang sudah ada.

Selection state sinkron antara canvas, timeline, dan inspector. Mengklik asset
di salah satu surface memilih object yang sama pada surface lain. Locked track
menolak canvas transform dan timeline move. Hidden visual tidak dirender;
hidden audio tetap berarti muted.

## Built-in Preset Library

Preset library awal mencakup:

- sound effects untuk short-form editing;
- stickers/overlays seperti arrow, circle highlight, subscribe badge, dan
  emoji-style callouts;
- stock photos;
- reusable backgrounds.

Built-in metadata dibaca dari catalog global dan thumbnail di-load secara lazy.
Memilih preset tidak menduplikasi file ke project storage; timeline mereferensi
asset global yang sama. Built-in asset read-only dan tidak dapat dihapus atau
diubah oleh user.

Preset content harus mempunyai license yang mengizinkan redistribution dan
commercial output. License/source metadata disimpan bersama catalog meskipun
tidak seluruh metadata perlu tampil di timeline UI.

## Transition Model

Essential transition pack berisi:

- Fade;
- Cross Dissolve;
- Dip to Black.

Transition menjadi typed timeline data, bukan destructive pixel edit:

```ts
type TimelineTransition = {
  id: string
  type: 'fade' | 'cross-dissolve' | 'dip-to-black'
  duration: number
  target:
    | { kind: 'clip-edge'; clipId: string; edge: 'in' | 'out' }
    | {
        kind: 'between-clips'
        trackId: string
        fromClipId: string
        toClipId: string
      }
}
```

Primary video memakai split-first flow:

1. video utuh belum mempunyai transition slot;
2. user memindahkan playhead lalu menjalankan Split;
3. joint antara dua clip hasil split menjadi valid drop target;
4. user menyeret transition dari library ke joint;
5. timeline menampilkan selectable transition icon tepat di tengah kedua clip;
6. icon membuka inspector untuk type, duration, replace, atau delete.

Drop transition ke primary video utuh ditolak dengan pesan `Split clip
terlebih dahulu`. Drag-and-drop mempunyai alternatif button `Add to selected
cut` untuk keyboard dan assistive technology.

Overlay image/video tetap mendukung transition pada start atau end clip. Default
duration adalah 0,5 detik dan maksimum dua detik. Engine meng-clamp duration
berdasarkan panjang kedua clip. Between-clips transition memakai render window
yang berpusat pada joint dan tidak mengubah total output duration. Evaluator
memakai media handles di luar edit point jika tersedia; jika source berada di
batas awal/akhir, boundary frame ditahan selama bagian window yang tidak
mempunyai handle. Move, trim, atau delete yang membuat joint tidak valid melepas
transition secara deterministic; operation tetap undoable. Essential
transitions hanya memengaruhi visual; audio crossfade belum termasuk scope.

## Preview dan Export

Preview resolver membuat media pool per distinct `assetId`, bukan memakai satu
candidate URL untuk semua track. Pada tiap frame, engine menentukan active
visual clips, source time, transform, stacking order, opacity/blend progress,
dan active audio. Compositor menggambar background, primary video, overlay
visual, lalu caption.

Transition evaluator mengembalikan progress deterministic untuk output time.
Cross Dissolve membutuhkan frame dari kedua clip dan mencampur opacity. Dip to
Black menurunkan clip A ke hitam lalu menaikkan clip B. Fade pada overlay
mengubah opacity terhadap canvas di clip edge.

Browser export membuka seluruh distinct asset sources yang direferensikan,
memproses frame dan audio sesuai timeline schedule, lalu menutup semua decoder.
Preview dan export wajib memakai evaluator dan compositor yang sama agar hasil
tidak drift. Embedded audio dari uploaded video tetap muted sampai user
mengaktifkan linked audio track.

## API dan Security

Endpoint asset memerlukan authenticated user dan project ownership sebelum:

- membuat asset record;
- menghasilkan presigned upload atau download URL;
- finalize, rename, replace, atau delete asset;
- me-refresh retention timestamp.

Storage key dibuat server-side dan tidak menerima raw path dari client.
Presigned upload dibatasi content type dan size yang disetujui. Finalize
melakukan HEAD/metadata validation sebelum status menjadi ready. Built-in asset
hanya dapat dibaca melalui allowlisted catalog ID.

API tidak mengembalikan R2 credentials atau internal storage key yang tidak
diperlukan. Cross-project asset reference ditolak saat normalize/save sehingga
edit spec tidak dapat digunakan untuk membaca asset milik user lain.

## Error Handling

- Upload network failure mempertahankan queue item dan menyediakan Retry.
- Unsupported, oversized, corrupt, atau metadata-mismatched file gagal sebelum
  insert timeline.
- Quota error menampilkan usage aktual, project limit, dan affordance untuk
  menghapus asset upload yang tidak diperlukan.
- Resolver failure menampilkan placeholder tanpa merusak timeline state.
- Asset yang expired meminta Re-upload atau Replace sebelum export.
- Transition drop ke target invalid tidak mengubah spec dan menjelaskan reason.
- Preview decoder failure mem-pause playback; edit spec dan undo history tetap
  aman.
- Export failure tidak menghapus asset, transform, atau transition dan dapat
  di-retry.

## Accessibility dan Responsive Behavior

- Canvas drag mempunyai numeric position/size inputs.
- Resize handles mempunyai accessible slider semantics dan touch target minimal
  44 × 44 pixel pada mobile.
- Media insert tersedia melalui button, tidak hanya drag-and-drop.
- Transition dapat ditambah lewat `Add to selected cut`, tidak hanya drag.
- Joint icon focusable dan menyebut type serta duration.
- Upload progress, expiry warning, error, dan success diumumkan lewat live
  region.
- Selected, muted, expired, dan invalid state tidak dibedakan melalui warna
  saja.
- Reduced motion mematikan decorative animation di transition thumbnails tanpa
  mengubah hasil preview/export.

## Testing

### Engine unit tests

- insert image/audio/video pada playhead;
- timeline clamp, snapping, trim, move, dan delete uploaded/preset clip;
- visual transform normalization dan bounds;
- global caption position;
- linked embedded audio default muted;
- split menghasilkan valid transition joint;
- unsplit video menolak between-clips transition;
- default duration dan media-handle clamp;
- between-clips transition tidak mengubah output duration;
- missing source handles memakai boundary frame hold;
- invalid joint cleanup setelah move, trim, atau delete;
- Fade, Cross Dissolve, dan Dip to Black progress;
- preview/export mapping untuk multiple asset IDs.

### API tests

- ownership sebelum signed upload/download URL;
- MIME, bytes, metadata, dan quota enforcement;
- finalize hanya menerima object valid;
- cross-project reference rejection;
- three-day expiry calculation dan refresh;
- one-day warning window;
- incomplete upload cleanup;
- project delete cleanup;
- built-in catalog read-only dan quota exemption.

### Component tests

- upload progress, finalize, retry, dan duplicate prevention;
- click/tap insert serta drag-and-drop insert;
- mouse/touch canvas move dan resize menghasilkan satu history entry;
- numeric transform controls;
- timeline drag mengubah start time;
- caption drag mengubah global position;
- preset category selection dan lazy thumbnail state;
- transition drop hanya aktif pada valid joint;
- joint icon selection, inspector edit, replace, dan delete;
- accessible `Add to selected cut` path;
- expiry placeholder, warning, re-upload, dan replace.

### Browser validation

- desktop dan mobile upload, insert, move, resize, timeline move, refresh, dan
  restore;
- split → drop transition → joint icon → inspector edit;
- overlay transition in/out;
- preview/export parity untuk transform, audio mute, and all Essential
  transitions;
- quota dan expiry recovery;
- no new overflow, unreachable controls, focus trap, leaked object URLs, atau
  console errors.

Quality gates mencakup focused tests, full test suite, TypeScript typecheck,
production build, dan relevant browser checks.

## Definition of Done

- User dapat memindahkan global caption position langsung di video preview.
- User dapat upload image, audio, atau video dalam limits yang disetujui.
- Uploaded asset tetap tersedia setelah refresh selama retention tiga hari
  masih aktif.
- User dapat memilih built-in SFX, sticker, stock photo, dan background tanpa
  upload eksternal.
- Visual media dapat dipindahkan dan di-resize di canvas serta dipindahkan pada
  timeline.
- Uploaded video membuat linked muted audio clip.
- Primary video harus di-split sebelum menerima transition.
- User dapat drag Essential transition ke joint dan melihat icon di tengah dua
  clip hasil split.
- Overlay dapat memakai transition in/out.
- Preview dan MP4 export cocok untuk timing, transform, audio mute, caption,
  preset, dan transition.
- Retention, cleanup, quota, security, retry, accessibility, dan responsive
  behavior lulus seluruh quality gate.
