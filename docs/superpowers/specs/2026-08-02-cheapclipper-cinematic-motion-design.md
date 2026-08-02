# CheapClipper — Cinematic Controlled Motion

**Tanggal:** 2026-08-02
**Status:** Disetujui untuk perencanaan implementasi
**Cakupan:** motion layer frontend, dimulai dari landing dan shared shell

## Outcome

CheapClipper terasa hidup seperti editing workstation yang sedang aktif tanpa
mengganggu tugas utama user. Motion memperjelas alur `Ingest → Cut → Export`,
memberi feedback pada interaction, dan memperkuat identitas visual industrial
creator desk.

Motion tidak mengubah kontrak API, data flow, routing, atau behavior editor.

## Design Direction

Nama arah visual: **Cinematic Controlled**.

Tone dominan tetap industrial/utilitarian dengan lapisan cinematic yang
terkontrol. Inspirasi konseptual berasal dari playhead video editor, status
lamp studio, signal monitor, dan scanning hardware panel.

### DFII

- Aesthetic Impact: 5
- Context Fit: 5
- Implementation Feasibility: 4
- Performance Safety: 4
- Consistency Risk: 5
- **DFII: 13/15**

Consistency risk dikendalikan melalui motion tokens, class yang reusable, dan
jumlah choreography yang terbatas.

## Differentiation Anchor

Anchor utama adalah **lime scanning signal** yang bergerak dari `Ingest` ke
`Cut`, lalu `Export`, seperti playhead yang melewati timeline. Anchor muncul di
studio rail dan tersambung secara visual dengan scan pada hero serta workflow.

Tanpa logo, UI tetap dapat dikenali dari kombinasi grid editing-bay, lime signal,
dan choreography berurutan dari intake menuju output.

## Motion Hierarchy

Motion dibagi menjadi dua lapisan agar banyak animasi tetap cohesive.

### Big Loops

Big loops membangun ambience halaman dan berjalan lambat:

1. **Grid drift** — background grid bergeser sangat pelan seperti timeline
   conveyor. Siklus 14 detik atau lebih dengan displacement kecil.
2. **Hero scan** — lime scan-line melewati area hero secara periodik tanpa
   menutupi copy. Siklus 7–10 detik dengan jeda yang jelas.
3. **Intake float** — clip intake desk bergerak vertikal maksimal 4px dan shadow
   berubah tipis dalam siklus 6–8 detik.
4. **Workflow signal sweep** — signal berpindah berurutan melalui tiga workflow
   cells dalam siklus 8–12 detik.

Tidak lebih dari dua big loops boleh menjadi high-contrast pada waktu yang sama.

### Small Loops

Small loops memberi detail dan feedback:

- indikator `READY` pulse dengan perubahan opacity dan glow ringan;
- CTA mendapat light sweep periodik, sedangkan arrow bergeser saat hover atau
  focus-visible;
- source labels aktif bergantian sebagai signal monitor;
- workflow icon memakai pulse/orbit kecil dengan displacement maksimal 2px;
- studio rail memiliki playhead sweep dan active-label emphasis;
- cards dan controls memakai lift 2–4px hanya saat hover/focus;
- press state menggunakan scale singkat, tidak menjadi loop.

Loop ambient memakai durasi 4–14 detik. Interaction feedback memakai durasi
150–400ms.

## Entrance Choreography

Initial landing entrance hanya berjalan sekali per page load:

1. shell/header fade dan turun tipis;
2. badge serta headline masuk per blok dengan stagger;
3. description muncul setelah headline mulai stabil;
4. intake desk masuk dari kanan pada desktop dan dari bawah pada mobile;
5. workflow cells masuk berurutan ketika initial sequence mencapai bagian akhir.

Total choreography utama tidak melebihi 1,200ms. Konten tetap ada di DOM sejak
awal dan tidak bergantung pada JavaScript agar dapat dibaca.

## Component Boundaries

- `globals.css` menyimpan motion tokens, keyframes, reduced-motion override, dan
  reusable motion utility classes.
- `AppShell` hanya memasang semantic hooks untuk shell entrance dan studio rail
  playhead.
- landing page memasang layer dekoratif yang `aria-hidden`, stagger index, dan
  hooks untuk hero, intake desk, serta workflow.
- `UrlForm` hanya menerima interaction styling untuk CTA dan input; request serta
  router behavior tidak berubah.
- UI primitives menerima press/hover feedback yang aman untuk seluruh route,
  tanpa ambient loop global pada setiap control.

Implementasi tetap CSS-first dan tidak menambah Framer Motion atau runtime
animation dependency.

## Performance Constraints

- Animasi mengutamakan `transform` dan `opacity`.
- Hindari loop pada `width`, `height`, `top`, `left`, blur besar, atau box-shadow
  kompleks yang berubah setiap frame.
- Layer bergerak memakai pseudo-element atau elemen dekoratif terbatas.
- `will-change` hanya dipasang pada elemen yang benar-benar bergerak dan tidak
  digunakan secara global.
- Mobile mengurangi displacement, jumlah layer, dan intensitas shadow.
- Motion tidak menambah client component atau React state untuk ambience.

## Accessibility

`prefers-reduced-motion: reduce` berlaku untuk seluruh aplikasi, bukan hanya
editor:

- semua entrance langsung tampil pada posisi final;
- big loops dan small decorative loops dihentikan;
- smooth scrolling dimatikan;
- hover/focus tetap memiliki feedback warna dan border tanpa displacement;
- loading spinner yang menyampaikan progress tetap boleh bergerak secara minimal
  karena bersifat informatif.

Elemen dekoratif memakai `aria-hidden="true"`. Motion tidak menjadi satu-satunya
cara menyampaikan status atau active state.

## Responsive Behavior

Desktop mendapat choreography lengkap. Tablet mempertahankan scan, stagger, dan
workflow sweep dengan displacement lebih kecil. Mobile:

- intake desk masuk dari bawah;
- grid drift dan hero scan berjalan lebih lambat;
- tidak memakai hover-only information;
- tidak mengalami horizontal overflow pada studio rail, headline, atau form;
- menjaga target sentuh minimum 44px.

## Testing Strategy

Implementasi mengikuti test-driven development:

- component tests memastikan semantic motion hooks terpasang pada shell dan
  landing elements;
- stylesheet contract test memastikan global reduced-motion override tersedia;
- existing `AppShell`, `UrlForm`, dan primitive tests tetap lulus;
- typecheck dan production build wajib lulus;
- Playwright memeriksa desktop dan 390px mobile, overflow, accessible snapshot,
  serta browser console;
- reduced-motion browser emulation memastikan konten langsung terlihat dan
  decorative animation berhenti.

Visual QA memeriksa bahwa motion terasa sebagai satu signal flow dan tidak ada
lebih dari dua high-contrast loops yang saling berebut perhatian.

## Definition of Done

- Landing mempunyai entrance sequence, big loops, dan small interaction loops
  sesuai hierarchy.
- Studio rail menjadi memorable scanning-playhead anchor.
- Shared controls mendapat hover/focus/press feedback yang konsisten.
- Tidak ada dependency animasi baru atau tambahan client-side state untuk
  decorative motion.
- Seluruh decorative motion menghormati reduced-motion.
- Desktop dan mobile tidak overflow atau kehilangan readability.
- Focused tests, typecheck, build, dan browser validation lulus.
