import Link from 'next/link'

export const metadata = { title: 'CheapClipper' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        {/* Pesan galat BYOK_INVALID menyuruh pengguna membuka halaman
            Pengaturan, jadi halaman itu harus bisa dicapai tanpa mengetik URL. */}
        <nav aria-label="Navigasi utama">
          <Link href="/">Beranda</Link> <Link href="/settings/keys">Pengaturan API key</Link>
        </nav>
        {children}
      </body>
    </html>
  )
}
