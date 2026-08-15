export type SafeLogValue = string | number | boolean | null
export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'
export type LogFormat = 'pretty' | 'json'
export interface LogConfig {
  format: LogFormat
  level: LogLevel
}

export interface RequestLogger {
  requestId: string
  info(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/
const SAFE_TOKEN = /^[A-Za-z0-9._:-]{1,128}$/
const SAFE_ROUTE = /^\/[A-Za-z0-9_./\[\]-]{1,200}$/
const SAFE_EVENT = /^[a-z][a-z0-9_.]{1,127}$/
const SAFE_FIELD_KEYS = new Set([
  'request_id',
  'method',
  'route',
  'status_code',
  'duration_ms',
  'project_id',
  'job_id',
  'asset_id',
  'clip_id',
  'candidate_id',
  'operation',
  'error_code',
  'error_class',
  'byte_count',
  'result_count',
  'bucket_role',
])
const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
  CRITICAL: 50,
}

export function parseLogConfig(
  env: Record<string, string | undefined>,
): LogConfig {
  const defaultFormat: LogFormat = env.NODE_ENV === 'production' ? 'json' : 'pretty'
  const format = (env.LOG_FORMAT?.toLowerCase() ?? defaultFormat) as LogFormat
  if (format !== 'pretty' && format !== 'json') {
    throw new Error("LOG_FORMAT must be 'pretty' or 'json'")
  }

  const level = (env.LOG_LEVEL?.toUpperCase() ?? 'INFO') as LogLevel
  if (!(level in LEVEL_RANK)) {
    throw new Error('LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR, or CRITICAL')
  }
  return { format, level }
}

const LOG_CONFIG = parseLogConfig(process.env)

function sanitizeFields(fields: Record<string, unknown>): Record<string, SafeLogValue> {
  const safe: Record<string, SafeLogValue> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_FIELD_KEYS.has(key)) continue
    if (typeof value === 'string') {
      const pattern = key === 'route' ? SAFE_ROUTE : SAFE_TOKEN
      if (pattern.test(value)) safe[key] = value
      continue
    }
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      safe[key] = value
    }
  }
  return safe
}

function normalizedEvent(event: string): string {
  return SAFE_EVENT.test(event) ? event : 'logging.invalid_event'
}

export function formatEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
  config: LogConfig = LOG_CONFIG,
): string {
  if (LEVEL_RANK[level] < LEVEL_RANK[config.level]) return ''
  const safeFields = sanitizeFields(fields)
  const timestamp = new Date().toISOString()
  const eventName = normalizedEvent(event)
  if (config.format === 'json') {
    return JSON.stringify({ timestamp, level, event: eventName, ...safeFields })
  }
  const suffix = Object.entries(safeFields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')
  return [timestamp, level, eventName, suffix].filter(Boolean).join(' ')
}

function output(level: LogLevel, rendered: string): void {
  if (!rendered) return
  if (level === 'ERROR' || level === 'CRITICAL') {
    console.error(rendered)
  } else if (level === 'WARNING') {
    console.warn(rendered)
  } else {
    console.info(rendered)
  }
}

export function writeEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  try {
    output(level, formatEvent(level, event, fields))
  } catch {
    try {
      console.error('{"level":"ERROR","event":"logging.serialization_failed"}')
    } catch {
      // Logging must never change the observed operation's result.
    }
  }
}

export function errorFields(error: unknown): Record<string, SafeLogValue> {
  const fields: Record<string, SafeLogValue> = {
    error_class: error instanceof Error ? error.constructor.name : typeof error,
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code
    if (typeof code === 'string' || (typeof code === 'number' && Number.isFinite(code))) {
      fields.error_code = code
    }
  }
  return sanitizeFields(fields)
}

function requestLogger(requestId: string): RequestLogger {
  return {
    requestId,
    info(event, fields = {}) {
      writeEvent('INFO', event, { request_id: requestId, ...fields })
    },
    error(event, fields = {}) {
      writeEvent('ERROR', event, { request_id: requestId, ...fields })
    },
  }
}

export function withRequestLogging<TContext>(
  route: string,
  handler: (
    request: Request,
    context: TContext,
    log: RequestLogger,
  ) => Promise<Response>,
) {
  return async (request: Request, context?: TContext): Promise<Response> => {
    const supplied = request.headers.get('x-request-id') ?? ''
    const requestId = REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID()
    const started = performance.now()
    const log = requestLogger(requestId)
    try {
      const response = await handler(request, context as TContext, log)
      writeEvent('INFO', 'http.request.completed', {
        request_id: requestId,
        method: request.method,
        route,
        status_code: response.status,
        duration_ms: Math.max(0, Math.round(performance.now() - started)),
      })
      response.headers.set('x-request-id', requestId)
      return response
    } catch (error) {
      writeEvent('ERROR', 'http.request.failed', {
        request_id: requestId,
        method: request.method,
        route,
        duration_ms: Math.max(0, Math.round(performance.now() - started)),
        ...errorFields(error),
      })
      throw error
    }
  }
}
