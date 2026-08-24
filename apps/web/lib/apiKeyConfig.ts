/**
 * Konfigurasi provider yang aman dikirim ke browser.
 *
 * File ini sengaja tidak mengimpor database, kripto Node.js, atau modul
 * server lain. Client component boleh mengimpor nilai dari sini tanpa
 * menarik dependency server-only ke browser bundle.
 */
export const PROVIDERS = ['gemini', 'openai_compat', 'anthropic_compat'] as const
export type Provider = (typeof PROVIDERS)[number]

export interface ProviderPreset {
  id: string
  name: string
  provider: Provider
  baseUrl: string
  models: string[]
  hint: string
}

/**
 * Sumopod ditaruh pertama karena ia penyedia VPS Indonesia yang dipakai
 * proyek ini: latensinya paling dekat untuk pengguna lokal dan pembayarannya
 * memakai rupiah, sehingga jadi titik mulai termurah bagi mayoritas pengguna.
 */
export const PRESETS: ProviderPreset[] = [
  {
    id: 'sumopod',
    name: 'Sumopod AI',
    provider: 'openai_compat',
    baseUrl: 'https://ai.sumopod.com/v1',
    models: [
      'MiniMax-M2.7-highspeed',
      'gpt-5-nano',
      'deepseek-v4-flash',
      'gemini/gemini-3.1-flash-lite',
    ],
    hint: 'Gateway lokal, bayar rupiah. Cocok untuk mulai dengan biaya kecil.',
  },
  {
    id: 'nebius',
    name: 'Nebius AI',
    provider: 'openai_compat',
    baseUrl: 'https://api.tokenfactory.nebius.com/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct'],
    hint: 'Default sementara Klipmatic; API OpenAI-compatible.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    provider: 'openai_compat',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
    hint: 'Satu key untuk banyak model.',
  },
  {
    id: 'groq',
    name: 'Groq',
    provider: 'openai_compat',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile'],
    hint: 'Inferensi cepat, model terbatas.',
  },
]
