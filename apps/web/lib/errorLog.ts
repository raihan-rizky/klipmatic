/**
 * Ringkasan galat yang aman ditulis ke log: hanya nama kelas dan kode.
 *
 * Pesan, `query`, dan `parameters` sengaja tidak ikut. Galat driver postgres
 * membawa teks query lengkap beserta nilai parameternya, sehingga mencatat
 * objeknya utuh berisiko menyalin data pengguna ke log. Tanpa ringkasan ini
 * kegagalan 500 sama sekali tidak bisa ditelusuri.
 */
export function describeError(e: unknown): string {
  if (e === null || (typeof e !== 'object' && typeof e !== 'function')) return typeof e
  const nama = (e as object).constructor?.name ?? 'Error'
  const kode = (e as { code?: unknown }).code
  if (typeof kode === 'string' || typeof kode === 'number') return `${nama}(${kode})`
  return nama
}
