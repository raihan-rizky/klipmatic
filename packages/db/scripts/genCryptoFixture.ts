import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApiKey, sealApiKey } from '../src/crypto'

// Skrip, bukan tes: setiap eksekusi menghasilkan IV acak baru sehingga
// menjalankannya di dalam `vitest run` akan mengotori pohon kerja dan bisa
// ditulis bersamaan dengan pembacaan oleh pytest.
// Jalankan manual: bun run packages/db/scripts/genCryptoFixture.ts

const HERE = dirname(fileURLToPath(import.meta.url))

// Master key tetap, khusus tes. JANGAN dipakai di lingkungan mana pun.
// Nilai base64 dari 32 byte ASCII "cheapclipper-test-master-key-32b".
const MASTER = 'Y2hlYXBjbGlwcGVyLXRlc3QtbWFzdGVyLWtleS0zMmI='

const CASES = [
  { name: 'ascii', plaintext: 'sk-proj-abcdef1234567890' },
  { name: 'panjang', plaintext: 'x'.repeat(512) },
  { name: 'unicode', plaintext: 'kunci-rahasia-ñ-日本語-🎬' },
]

const fixtures = CASES.map((c) => ({ ...c, sealed: sealApiKey(c.plaintext, MASTER) }))

for (const f of fixtures) {
  if (openApiKey(f.sealed, MASTER) !== f.plaintext) {
    throw new Error(`round trip gagal untuk kasus ${f.name}`)
  }
}

const dir = join(HERE, '../../../apps/downloader/tests/fixtures')
mkdirSync(dir, { recursive: true })
const out = join(dir, 'sealed_keys.json')
writeFileSync(out, JSON.stringify({ masterKey: MASTER, cases: fixtures }, null, 2))
console.log(`fixture ditulis ke ${out}`)
