import type { Sql } from 'postgres'

export interface CandidateView {
  id: string
  startSec: number
  endSec: number
  score: number
  title: string
  hookText: string
  reason: string | null
  transcriptSlice: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Filter kepemilikan ditulis eksplisit lewat join ke projects. Route ini
 * memakai koneksi pemilik tabel yang melewati RLS, jadi RLS tidak boleh
 * dijadikan satu-satunya penjaga di jalur ini.
 */
export async function listCandidates(
  sql: Sql,
  userId: string,
  projectId: string,
): Promise<CandidateView[]> {
  // projectId berasal dari segmen URL yang cocok dengan string apa pun.
  // Postgres menolak bind uuid yang tidak berbentuk (22P02) dan halaman
  // berubah jadi error 500, padahal id yang tidak dikenal semestinya berujung
  // daftar kosong seperti uuid asing lain.
  if (!UUID_RE.test(projectId)) return []

  const rows = await sql`
    select c.id, c.start_sec, c.end_sec, c.score, c.title, c.hook_text,
           c.reason, c.transcript_slice
      from clip_candidates c
      join projects p on p.id = c.project_id
     where c.project_id = ${projectId} and p.user_id = ${userId}
     order by c.score desc, c.start_sec asc
  `
  // Kolom numeric datang sebagai string dari driver: presisi arbitrer tidak
  // muat di double. Konversi dilakukan di sini supaya pemanggil tidak pernah
  // menerima string yang diam-diam ikut operasi aritmetika.
  return rows.map((r) => ({
    id: r.id as string,
    startSec: Number(r.start_sec),
    endSec: Number(r.end_sec),
    score: Number(r.score),
    title: r.title as string,
    hookText: r.hook_text as string,
    reason: (r.reason as string | null) ?? null,
    transcriptSlice: r.transcript_slice as string,
  }))
}

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatRange(startSec: number, endSec: number): string {
  // start_sec/end_sec bertipe numeric(10,3), jadi pecahan itu nyata. Durasi
  // dihitung dari detik yang sudah dibulatkan ke bawah — sama dengan yang
  // dicetak di rentangnya — supaya rentang dan label durasi tidak pernah
  // berbeda satu detik.
  const start = Math.floor(startSec)
  const end = Math.floor(endSec)
  return `${mmss(start)} – ${mmss(end)} (${end - start} detik)`
}

export type ProjectViewState = 'progress' | 'no-job' | 'results'

/**
 * Bilah progress hanya relevan selama hasil belum ada; begitu kandidat muncul
 * pekerjaannya sudah selesai dan bilah progress cuma jadi kebisingan. Dipisah
 * dari komponen halaman supaya percabangan tiga keadaan ini bisa diuji tanpa
 * merender server component yang menyentuh cookie dan database.
 */
export function projectViewState(args: {
  hasActiveJob: boolean
  candidateCount: number
}): ProjectViewState {
  if (args.candidateCount > 0) return 'results'
  return args.hasActiveJob ? 'progress' : 'no-job'
}
