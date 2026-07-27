import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const HERE = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Alias `@/` yang dipakai kode aplikasi harus dikenali juga saat tes,
  // karena modul yang diuji mengimpor lewat alias itu.
  resolve: { alias: { '@': resolve(HERE) } },
  // tsconfig memakai jsx "preserve" karena Next yang mengompilasi JSX di
  // produksi. Vitest tidak lewat Next, jadi transform JSX-nya ditentukan di
  // sini; tanpa ini komponen tidak bisa dirender di tes sama sekali.
  esbuild: { jsx: 'automatic' },
})
