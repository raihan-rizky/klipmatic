import { type CandidateView, formatRange } from '@/lib/candidates'

export function CandidateList({ candidates }: { candidates: CandidateView[] }) {
  // Kalimat kosong sengaja netral: komponen ini tidak tahu status job, dan
  // menebak "analisis masih berjalan" akan bertabrakan dengan label gagal yang
  // dirender JobProgress tepat di atasnya. Konteksnya diberikan pemanggil.
  if (candidates.length === 0) {
    return <p>Belum ada kandidat klip.</p>
  }

  return (
    <ol>
      {candidates.map((c) => (
        <li key={c.id}>
          <h3>{c.title}</h3>
          <p>
            <strong>Hook:</strong> {c.hookText}
          </p>
          <p>
            {formatRange(c.startSec, c.endSec)} · skor {Math.round(c.score * 100)}
          </p>
          {c.reason && (
            <p>
              <em>{c.reason}</em>
            </p>
          )}
          <details>
            <summary>Lihat kutipan transkrip</summary>
            <p>{c.transcriptSlice}</p>
          </details>
        </li>
      ))}
    </ol>
  )
}
