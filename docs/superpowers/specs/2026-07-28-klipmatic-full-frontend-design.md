# Klipmatic — Full Frontend Design

**Tanggal:** 2026-07-28  
**Status:** Disetujui untuk perencanaan implementasi  
**Cakupan:** seluruh route frontend yang tersedia sampai P2

## Outcome

Klipmatic mempunyai frontend Creator Studio yang konsisten, responsif, dan
accessible untuk alur landing, login, pemrosesan project, pemilihan kandidat,
editor klip, serta pengaturan API key. Redesign mempertahankan kontrak API,
alur data, dan kemampuan backend yang sudah ada.

## Batas Cakupan

Frontend mencakup:

- landing dan pembuatan project dari URL;
- login magic link dan status akun;
- progress pipeline dan daftar kandidat;
- editor klip browser;
- pengaturan API key;
- loading, empty, success, dan error states pada route tersebut.

Redesign tidak menambah endpoint, mengubah schema database, menambah provider,
atau membuat cloud-render fallback. Editor diprioritaskan untuk desktop dan
tablet. Pada mobile, editor tetap readable dalam layout bertumpuk, sedangkan
landing, login, project, dan settings harus fully responsive.

Copy produk menggunakan Bahasa Indonesia yang ringkas dan konsisten.

## Visual Direction

Tema memakai gaya **Creator Studio**:

- near-black charcoal sebagai canvas utama;
- graphite untuk surface yang ditinggikan;
- electric lime untuk primary action, focus ring, dan indikator aktif;
- muted gray untuk secondary information;
- amber dan red untuk warning serta failure;
- heading tebal dengan body memakai system sans yang sangat terbaca;
- radius medium, border halus, dan bayangan minimal;
- motion pendek untuk hover, press, progress, dan skeleton saja.

Tampilan harus terasa custom dan tidak menyerupai default theme shadcn.
Kontras, focus visibility, dan hierarchy informasi lebih penting daripada
ornamen.

## Frontend Foundation

Implementasi memakai Tailwind CSS untuk styling dan shadcn-style components
berbasis Radix UI untuk interaction primitives. Komponen yang diperlukan:

- Button;
- Card;
- Input dan form controls;
- Badge;
- Alert;
- Progress;
- AlertDialog;
- Select;
- Accordion;
- Skeleton;
- Tooltip.

Komponen disimpan sebagai source di dalam aplikasi sehingga styling,
accessibility, dan API-nya dapat disesuaikan tanpa membawa visual theme
eksternal.

Root layout menyediakan app shell dengan:

- brand Klipmatic;
- navigasi ke pembuatan klip dan API Key;
- akses akun;
- content container responsif;
- focus ring electric lime;
- minimum touch target 44px.

## Page Experience

### Landing

Hero menyampaikan value proposition: video panjang masuk dan klip siap posting
keluar. URL form menjadi action utama. Di bawahnya ada penjelasan tiga tahap:
ambil video, temukan highlight, lalu edit dan ekspor. Supported sources
ditampilkan sebagai badge informatif tanpa menjanjikan provider yang belum
didukung.

### Login dan Account

Pengguna anonim melihat focused magic-link card dengan penjelasan singkat,
email input, dan state pengiriman. Pengguna yang sudah login melihat email,
shortcut untuk membuat project, dan action keluar. Callback implicit memakai
loading atau failure state yang konsisten dengan halaman lain.

### Project dan Candidates

Pipeline divisualkan sebagai tiga tahap:

1. Ambil video;
2. Transkripsi;
3. Cari highlight.

Status yang tersedia dari backend dipetakan ke progress UI tanpa mengubah
logika job. Kandidat menjadi ranked cards yang menampilkan title, hook, range,
score, reason, transcript accordion, dan action untuk membuka editor. Empty
state tidak menebak status job dan selalu menyediakan next action yang valid.

### Clip Editor

Desktop memakai workspace multi-column:

- preview vertikal 9:16 sebagai fokus utama;
- source playback dan metadata;
- panel controls untuk crop, autofocus, dan caption;
- sticky action bar untuk Simpan dan Ekspor MP4.

Mobile memakai layout bertumpuk yang readable, tetapi tidak diposisikan sebagai
pengganti pengalaman editing desktop. Seluruh kemampuan P2 tetap ada:
load segment, polling status, preview canvas, crop focus, zoom, autofocus,
caption karaoke, save edit spec, capability detection, progress export, dan
download MP4.

Browser tanpa WebCodecs yang kompatibel mendapat pesan eksplisit. UI tidak
menjanjikan cloud export.

### API Keys

Key tersimpan tampil sebagai secure cards berisi label, provider, model,
base URL bila ada, serta waktu terakhir digunakan. Form penambahan key dibagi
menjadi provider setup dan credential details. Delete memakai Radix
AlertDialog, bukan `window.confirm`, dan menjelaskan bahwa secret tidak dapat
dipulihkan.

## State dan Feedback

Semua async action mempunyai state konsisten:

- idle;
- loading;
- success;
- error.

Loading memakai disabled control, progress, atau skeleton sesuai konteks.
Status penting diumumkan melalui live region. Success dan failure memakai
feedback yang tidak hanya bergantung pada warna. Error teknis internal tidak
ditampilkan ke user.

Candidate score boleh diterjemahkan menjadi badge visual, tetapi angka dan
makna dari backend tidak diubah.

## Data Flow

Kontrak dan request berikut dipertahankan:

- `POST /api/projects`;
- `POST /api/clips`;
- `GET /api/clips/:id`;
- `PATCH /api/clips/:id`;
- `POST /api/keys`;
- `DELETE /api/keys/:id`;
- Supabase auth dan Realtime;
- polling fallback yang sudah tersedia.

Presentation components tidak memindahkan ownership checks atau credential ke
client. Presigned media URL dan export browser tetap mengikuti batas keamanan
P2.

## Component Boundaries

- `AppShell` mengatur brand, navigation, dan content frame.
- `PageHeader` mengatur title, description, dan page actions.
- UI primitives menangani visual variants serta accessible interactions.
- Feature components tetap memiliki data dan behavior masing-masing.
- Route components melakukan auth dan server-side data loading seperti saat
  ini.
- Editor controls dapat dipecah berdasarkan crop, caption, media preview, dan
  export action agar setiap unit mudah diuji.

Tidak ada refactor backend atau perubahan data-access yang tidak diperlukan
oleh presentation.

## Testing dan Quality Gates

Implementasi mengikuti test-driven development untuk behavior baru.

Validation wajib mencakup:

- existing unit tests tetap lulus;
- component tests untuk variants dan state penting;
- browser checks untuk landing, login, project, editor, dan settings;
- keyboard navigation dan focus visibility;
- mobile, tablet, dan desktop overflow checks;
- TypeScript typecheck;
- production build;
- tidak ada warning atau error baru yang berasal dari perubahan frontend.

Playwright dipakai untuk browser-level validation ketika environment route dan
fixture memungkinkan. Flow yang membutuhkan service eksternal tetap diuji
melalui state deterministik yang tersedia tanpa mengubah production contract.

## Definition of Done

- Semua route frontend sampai P2 memakai Creator Studio design system.
- Landing, login, project, dan settings responsif dari mobile ke desktop.
- Editor optimal di desktop/tablet dan tetap readable di mobile.
- Semua behavior dan kontrak backend existing tetap berfungsi.
- Async, empty, error, dan unsupported-browser states konsisten.
- Destructive key deletion memakai accessible confirmation dialog.
- Primary journeys dapat digunakan dengan keyboard.
- Test, typecheck, build, dan browser validation yang relevan lulus.
