export const ERROR_CODES = [
  'SOURCE_UNSUPPORTED',
  'SOURCE_BLOCKED',
  'SOURCE_UNAVAILABLE',
  'SOURCE_GEOBLOCKED',
  'SOURCE_AGE_RESTRICTED',
  'SOURCE_TOO_LONG',
  'TRANSCRIBE_FAILED',
  'BYOK_INVALID',
  'LLM_BAD_OUTPUT',
  'WORKER_LOST',
  'INTERNAL',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** Batas durasi sumber yang diterima, dalam detik. Spec §9.1: 4 jam. */
export const MAX_SOURCE_DURATION_SEC = 4 * 60 * 60
