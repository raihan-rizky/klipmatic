import type { ErrorCode } from '@klipmatic/shared'

const MESSAGES: Record<ErrorCode, string> = {
  SOURCE_UNSUPPORTED:
    'Link ini belum didukung. Coba tempel link YouTube, TikTok, atau Google Drive yang lengkap.',
  SOURCE_BLOCKED: 'Platform sedang memblokir permintaan kami. Coba lagi beberapa menit lagi.',
  SOURCE_UNAVAILABLE:
    'Video tidak dapat diakses. Pastikan videonya masih ada dan tidak disetel privat.',
  SOURCE_GEOBLOCKED: 'Video ini dibatasi untuk wilayah tertentu sehingga tidak bisa kami proses.',
  SOURCE_AGE_RESTRICTED: 'Video ini punya batasan usia dan tidak bisa kami proses.',
  SOURCE_TOO_LONG: 'Durasi video melebihi batas maksimum 4 jam.',
  TRANSCRIBE_FAILED: 'Transkripsi gagal. Kami sedang mencoba ulang secara otomatis.',
  BYOK_INVALID: 'API key kamu ditolak provider. Periksa kembali di halaman Pengaturan.',
  LLM_BAD_OUTPUT:
    'AI memberi jawaban yang tidak bisa kami baca. Coba pilih model lain di Pengaturan.',
  WORKER_LOST: 'Proses sempat terputus dan sedang dijalankan ulang.',
  INTERNAL: 'Terjadi kesalahan di sistem kami. Tim kami sudah diberi tahu.',
}

const FALLBACK = 'Terjadi kesalahan yang tidak dikenali. Coba lagi beberapa saat lagi.'

export function messageFor(code: ErrorCode): string {
  return MESSAGES[code] ?? FALLBACK
}
