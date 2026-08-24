# Desain: Cross-Stack Project Optimization

Tanggal: 2026-08-25  
Status: disetujui

## Konteks

Klipmatic adalah monorepo yang mencakup Next.js web/editor, TypeScript timeline
dan compositor engine, Postgres/Drizzle data layer, serta Python worker untuk
ingest, transcribe, analyze, preview, dan render. Optimasi editor terbaru sudah
menangani sebagian redraw dan stabilitas playback, tetapi belum ada baseline
lintas stack yang membandingkan user runtime, pipeline worker, dan developer
loop dengan metode yang konsisten.

Optimization cycle ini memakai pendekatan **cross-stack benchmark funnel**.
Tujuannya bukan merombak semua subsystem sekaligus, tetapi mengukur flow dari
ujung ke ujung, menemukan bottleneck yang benar-benar dominan, lalu memperbaiki
tiga bottleneck dengan impact tertinggi.

## Keputusan dan constraints

- Scope audit mencakup production user experience dan local developer
  experience; production impact menjadi prioritas utama.
- Perubahan memakai tingkat agresivitas **balanced**: config, caching, query,
  rendering, dan refactor terarah diperbolehkan. Migrasi arsitektur besar atau
  penggantian stack tidak termasuk cycle ini.
- Implementasi dibatasi pada **top 3 bottleneck** berdasarkan evidence dan
  ranking yang didefinisikan di bawah.
- Success metric bersifat hybrid: target sekitar 20% untuk metric kuantitatif;
  reliability atau redundant work dinilai dari hilangnya failure/rework yang
  terukur.
- Profiling pipeline tidak boleh memakai layanan eksternal berbayar. Provider
  transkripsi dan LLM memakai fixture atau mock deterministik.
- Product correctness tidak boleh ditukar dengan speed.

## Pendekatan yang dipilih

### Cross-stack benchmark funnel

Benchmark dimulai dari user journey dan developer loop secara luas. Stage yang
terlihat dominan kemudian diprofile lebih dalam. Hasil seluruh lane masuk ke
scorecard yang sama supaya kandidat dapat dibandingkan berdasarkan impact,
frequency, confidence, dan implementation risk.

Pendekatan ini dipilih dibanding dua alternatif:

1. **User-journey first** memberi hasil frontend lebih cepat, tetapi dapat
   melewatkan worker atau tooling inefficiency yang berpengaruh besar.
2. **Subsystem scorecard** memberi diagnosis komponen yang detail, tetapi rawan
   mengoptimasi fungsi lokal yang kontribusinya kecil terhadap total latency.

## Measurement architecture

Audit dibagi ke empat lane.

### 1. Developer loop

- Cold dan warm production build time.
- Typecheck dan test duration.
- Turbo cache effectiveness.
- Bundle size per route atau entry point yang relevan.

### 2. Web dan editor runtime

- Initial page load dan hydration untuk journey yang diuji.
- React render frequency saat scrub dan playback.
- Canvas draw duration, dropped frame, dan playback controller teardown.
- Memory growth selama editing dan export berbasis fixture.

### 3. Backend dan data

- Query count dan duration pada project, candidate, dan clip flow.
- Database connection reuse.
- Payload size dan redundant fetch.
- Browser dan R2 cache-hit path dengan local storage fixture.

### 4. Worker pipeline

- Duration mocked ingest, transcribe, analyze, preview, dan render stage.
- Subprocess count, temporary file I/O, dan cache hit/miss.
- Job retry atau rework yang seharusnya tidak terjadi.
- Seluruh provider eksternal diganti fixture atau mock tanpa API cost.

Setiap measurement menghasilkan record dengan bentuk berikut:

`metric -> baseline -> suspected cause -> proposed fix -> result -> regression guard`

Collector menyimpan output machine-readable dan human-readable. Format final
yang diwajibkan adalah JSON untuk perbandingan otomatis dan Markdown untuk
review. Artifacts benchmark tidak masuk production bundle.

## Benchmark protocol

Flow audit adalah:

`clean baseline -> benchmark lane -> profile hotspot -> rank -> fix top 3 -> benchmark ulang -> regression guard`

Protocol wajib:

- Benchmark dijalankan berulang dan memakai median sebagai nilai perbandingan.
- Cold run dan warm run dilaporkan terpisah.
- Before dan after memakai fixture, command, dependency state, dan environment
  yang sama.
- Existing optimization tetap diukur; keberadaan optimization code bukan bukti
  bahwa bottleneck sudah hilang.
- Satu bottleneck harus memiliki profiler output, timing, query count, render
  count, atau evidence setara sebelum diubah.
- Perubahan yang tidak berhubungan langsung dengan top 3 tidak ikut masuk.

Jumlah pengulangan tidak dibuat satu angka global karena workload build,
browser, dan worker berbeda. Setiap benchmark runner harus menetapkan jumlah
run minimum sebelum eksekusi, menjalankan setidaknya tiga valid run, dan
melaporkan coefficient of variation. Metric dengan coefficient of variation di
atas 15% setelah satu retry set lengkap ditandai `inconclusive` dan tidak boleh
dipakai untuk claim improvement.

## Ranking dan selection rules

Kandidat diranking dengan model:

`priority = user impact x frequency x confidence / implementation risk`

Masing-masing faktor memakai skala ordinal 1-3 dengan definisi berikut:

| Faktor | 1 | 2 | 3 |
|---|---|---|---|
| User impact | Developer-only atau minor | Terasa pada sebagian journey | Menghambat journey utama atau reliability |
| Frequency | Jarang | Per session atau per job | Per interaction, frame, query, atau build loop |
| Confidence | Indikasi tunggal | Dua evidence yang konsisten | Profiler/measurement langsung dan reproducible |
| Implementation risk | Isolated dan mudah rollback | Menyentuh beberapa boundary | Mengubah contract atau state flow utama |

Urutan diputuskan oleh nilai priority tertinggi. Tie-breaker berturut-turut
adalah user impact, confidence, lalu implementation risk terendah.

Guardrail pemilihan:

- Kandidat wajib memiliki confidence minimal 2.
- Kandidat yang memerlukan external paid service untuk validasi dipindahkan ke
  backlog; kandidat valid berikutnya naik ke top 3.
- Dua symptom dengan root cause dan rollback boundary yang sama boleh digabung
  menjadi satu optimization package.
- Bila benchmark membuktikan bottleneck berasal dari environment lokal di luar
  repo, temuan dicatat tetapi tidak dipilih untuk product-code optimization.

## Struktur implementasi

### Benchmark harness

Harness berada di area tooling khusus benchmark dan tidak diimport oleh
production entry point. Ia mengorkestrasi fixture, warm-up, repeated run,
collector, serta pembuatan JSON dan Markdown report.

### Instrumentation adapters

Instrumentation berupa wrapper tipis untuk timer, render counter, query
counter, dan worker stage timing. Adapter aktif hanya lewat benchmark atau test
flag. Ketika flag mati, behavior dan output product harus tetap sama.

### Optimization packages

Setiap bottleneck menjadi package perubahan terpisah dengan:

- evidence dan baseline;
- fix yang bounded;
- focused regression test;
- benchmark before dan after;
- rollback boundary yang jelas.

Package mengikuti repository boundary yang ada:

- `apps/web` untuk page load, network, React render, dan editor interaction;
- `packages/engine` untuk pure timeline atau compositor hot path;
- `packages/db` untuk query dan connection behavior;
- `apps/downloader` untuk mocked pipeline, file I/O, dan subprocess behavior;
- root tooling untuk Bun, Turbo, Vitest, build, test, dan CI behavior.

Observability dependency besar tidak ditambahkan kecuali built-in timer,
browser profiler, test hooks, dan structured logging yang sudah ada terbukti
tidak mampu menghasilkan evidence yang dibutuhkan.

## Data flow

1. Runner menyiapkan fixture dan memastikan prerequisite lokal tersedia.
2. Runner melakukan warm-up bila benchmark bertipe warm.
3. Adapter mengumpulkan metric tanpa mengubah functional output.
4. Collector menyimpan raw run dan menghitung median serta variance.
5. Ranker menyusun scorecard kandidat berdasarkan selection rules.
6. Top 3 diimplementasikan sebagai package terpisah.
7. Runner mengulang protocol identik terhadap setiap package.
8. Report menghubungkan baseline, perubahan, result, dan regression guard.

## Error handling

Benchmark error diklasifikasikan sebagai berikut:

- **Environment failure:** local service mati, fixture tidak tersedia, port
  bentrok, atau prerequisite tidak terpenuhi. Run ditandai invalid dan tidak
  masuk kalkulasi.
- **Product failure:** exception, timeout dari batas benchmark yang sudah
  ditetapkan, memory growth tak terkendali, atau output functional berubah.
  Kejadian ini menjadi finding dan tidak boleh dibuang sebagai noise.
- **Measurement noise:** variance melewati batas protocol. Satu set run diulang
  sekali. Jika masih noisy, metric menjadi `inconclusive`.

Report harus menyimpan alasan run invalid atau inconclusive. Runner tidak boleh
diam-diam menghapus hasil buruk.

## Testing dan verification

Setelah setiap optimization package:

- Existing unit dan integration tests harus pass.
- Focused regression test ditambahkan sesuai root cause.
- Typecheck dan production build harus pass.
- Benchmark before dan after menggunakan protocol yang sama.
- Functional output dibandingkan pada boundary relevan, termasuk timeline
  spec, rendered-frame fixture, query result, payload contract, dan worker job
  state.
- Benchmark-only instrumentation diverifikasi tidak masuk production bundle
  atau mengubah behavior saat flag mati.

## Acceptance criteria

Cycle dinyatakan selesai hanya jika:

1. Empat audit lane memiliki baseline valid atau penjelasan reproducible bila
   satu metric tidak dapat diukur secara lokal.
2. Ranked findings memiliki evidence dan scoring yang dapat direview.
3. Tiga bottleneck terpilih mempunyai before/after result.
4. Metric speed, build, memory, I/O, atau cost proxy membaik sekitar 20% bila
   feasible. Bila hasil di bawah 20%, package hanya diterima jika report
   menunjukkan absolute user impact yang material dan tidak ada alternatif
   lower-risk dengan score lebih tinggi.
5. Reliability package menghilangkan failure, retry, teardown, duplicate work,
   atau rework yang dapat direproduce pada baseline.
6. Tidak ada regression pada correctness, tests, typecheck, atau build.
7. Temuan yang tidak dipilih dicatat sebagai ranked backlog dan tidak langsung
   diimplementasikan.
8. Setiap claim menyertakan command dan artifact hasil ukur yang reproducible.

## Deliverables

- Baseline cross-stack scorecard.
- Ranked findings dengan evidence dan scoring.
- Tiga optimization package beserta focused tests.
- Before/after report per package.
- Ranked backlog untuk temuan di luar top 3.
- Command reference untuk menjalankan benchmark kembali.

## Out of scope

- Penggantian framework, database, storage provider, queue, atau provider AI.
- Migrasi arsitektur besar yang tidak dapat diisolasi sebagai balanced change.
- Penggunaan API transkripsi atau LLM berbayar untuk benchmark.
- Implementasi semua temuan medium atau low impact.
- Refactor kosmetik yang tidak mendukung metric top 3.
- Claim production improvement yang hanya didasarkan pada satu local run.

## Risiko dan mitigasi

- **Local benchmark tidak identik dengan production.** Gunakan relative
  before/after pada environment identik dan labeli claim sebagai local proxy.
- **Instrumentation mengubah timing.** Jaga adapter tipis, ukur overhead, dan
  gunakan profiler built-in ketika tersedia.
- **Benchmark flaky.** Pakai repeated run, median, variance threshold, dan
  klasifikasi inconclusive.
- **Scope melebar setelah banyak temuan.** Selection rules membatasi perubahan
  ke tiga package; sisanya masuk backlog.
- **Speed merusak correctness.** Functional output comparison dan existing test
  suite menjadi hard gate.
