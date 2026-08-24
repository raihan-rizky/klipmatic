import './globals.css'
import { AppShell } from '@/components/AppShell'

export const metadata = {
  title: {
    default: 'Klipmatic',
    template: '%s · Klipmatic',
  },
  description: 'Ubah video panjang menjadi klip pendek siap posting.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body><AppShell>{children}</AppShell></body>
    </html>
  )
}
