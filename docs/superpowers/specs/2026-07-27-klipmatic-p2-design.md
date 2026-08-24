# Klipmatic — Desain P2: Engine Browser + Editor A

**Tanggal:** 2026-07-27  
**Status:** Disetujui untuk implementasi  
**Cakupan:** pilih kandidat, fetch segment, preview, crop, caption, export

## Outcome

User dapat memilih satu kandidat P1, menunggu hanya rentang videonya tersedia,
mengedit tampilan vertikal 9:16 di browser, lalu mengunduh MP4 final tanpa
render server.

## Alur

1. `POST /api/clips` memvalidasi candidate milik user, membuat draft `clips`,
   dan enqueue `fetch_segments`.
2. Worker memakai ranged yt-dlp yang sudah ada. Jika transkrip sumber hanya
   mempunyai timestamp estimasi, worker men-transcribe ulang segment pilihan
   untuk word timestamp presisi sebelum menulis `media_segments`.
3. Editor polling `GET /api/clips/:id`; ketika segmen siap, server memberi
   presigned URL dan caption words relatif terhadap awal klip.
4. Canvas compositor membaca `edit_spec` untuk preview.
5. Mediabunny membaca MP4, memproses frame dengan compositor yang sama,
   mempertahankan audio, lalu menghasilkan MP4 H.264/AAC di browser.

## Edit spec v1

```ts
type EditSpecV1 = {
  version: 1
  output: { width: 1080; height: 1920; frameRate: 30 }
  crop: { mode: 'cover'; focusX: number; focusY: number; zoom: number }
  captions: {
    enabled: boolean
    positionY: number
    fontSize: number
    fontFamily: string
    textColor: string
    activeColor: string
    backgroundColor: string
    maxWordsPerLine: number
  }
}
```

Semua nilai dinormalisasi dan dibatasi sebelum masuk database. Preview dan
export dilarang mempunyai default sendiri.

## Batas keamanan

- Semua query clip/candidate selalu join ke `projects.user_id`.
- Presigned URL hanya dibuat setelah ownership check.
- Client tidak menerima R2 credentials atau key internal.
- PATCH hanya menerima edit-spec tervalidasi dan status render yang dikenal.

## Capability dan fallback

- Export MP4 membutuhkan WebCodecs encoder yang didukung Mediabunny.
- Editor tetap dapat preview dan menyimpan spec bila encoder tidak tersedia.
- Device unsupported mendapat pesan eksplisit; cloud-render masuk P5 dan tidak
  dipalsukan sebagai bagian P2.
- Auto-focus MediaPipe bersifat opsional. Slider focus manual selalu tersedia.

## Definition of Done

- Candidate dapat menjadi clip draft dan job range terbuat atomik.
- User lain tidak dapat membaca/mengubah clip atau mendapat signed URL.
- Preview 9:16, crop focus, caption style, play/pause, dan seek berfungsi.
- Export menghasilkan MP4 lokal dengan video, audio, crop, dan caption.
- Caption estimasi mendapat precision pass per segment dan tetap mempunyai
  fallback bila provider transkripsi tidak tersedia.
- Edit-spec tersimpan dan pulih setelah refresh.
- Tests engine, API/data access, TypeScript, Python, serta production build
  seluruhnya lulus.
