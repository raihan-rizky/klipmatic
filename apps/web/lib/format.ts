/**
 * Waktu disimpan dan dikirim sebagai ISO-8601 UTC, tapi pembacanya orang
 * Indonesia: tampilkan dalam zona WIB dan format lokal, bukan string mesin.
 */
const WIB = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatWaktu(iso: string): string {
  const waktu = new Date(iso)
  // Nilai rusak tidak boleh memunculkan 'Invalid Date' di halaman.
  if (Number.isNaN(waktu.getTime())) return 'waktu tidak diketahui'
  return `${WIB.format(waktu)} WIB`
}
