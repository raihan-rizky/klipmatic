import postgres from 'postgres'
import { databaseClient } from './dbClient'

/**
 * Koneksi pemilik tabel, dipakai route handler di server.
 *
 * Koneksi ini melewati RLS, jadi setiap query di route wajib menyaring
 * kepemilikan secara eksplisit. RLS tetap ada sebagai lapis kedua untuk
 * akses dari browser lewat Supabase.
 */
export const sql = databaseClient(postgres, process.env.DATABASE_URL!)
