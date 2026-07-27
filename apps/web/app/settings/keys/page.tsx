import { ApiKeyForm, DeleteApiKeyButton } from '@/components/ApiKeyForm'
import { listApiKeys } from '@/lib/apiKeys'
import { sql } from '@/lib/db'
import { formatWaktu } from '@/lib/format'
import { supabaseServer } from '@/lib/supabase/server'

// Daftar key bergantung pada sesi pengguna, jadi halaman ini tidak boleh
// ikut ter-cache saat build.
export const dynamic = 'force-dynamic'

export default async function KeysPage() {
  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return (
      <main>
        <p>Silakan masuk dulu.</p>
      </main>
    )
  }

  const keys = await listApiKeys(sql, user.id)

  return (
    <main>
      <h1>API Key</h1>
      <p>
        CheapClipper memakai API key milikmu sendiri untuk memilih klip menarik, sehingga
        biaya AI-nya kamu yang tentukan.
      </p>

      <h2>Key tersimpan</h2>
      {keys.length === 0 ? (
        <p>Belum ada key. Tambahkan satu di bawah untuk mulai menganalisis video.</p>
      ) : (
        <ul>
          {keys.map((k) => (
            <li key={k.id}>
              <strong>{k.label}</strong> — {k.provider} / {k.model}
              {k.baseUrl && <span> ({k.baseUrl})</span>}
              {k.lastUsedAt && <span> terakhir dipakai {formatWaktu(k.lastUsedAt)}</span>}{' '}
              <DeleteApiKeyButton id={k.id} label={k.label} />
            </li>
          ))}
        </ul>
      )}

      <h2>Tambah key</h2>
      <ApiKeyForm />
    </main>
  )
}
