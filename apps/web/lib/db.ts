import postgres from 'postgres'

/**
 * Koneksi pemilik tabel, dipakai route handler di server.
 *
 * Koneksi ini melewati RLS, jadi setiap query di route wajib menyaring
 * kepemilikan secara eksplisit. RLS tetap ada sebagai lapis kedua untuk
 * akses dari browser lewat Supabase.
 */
export const sql = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false })
