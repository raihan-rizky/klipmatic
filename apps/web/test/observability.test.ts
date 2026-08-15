import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  errorFields,
  formatEvent,
  parseLogConfig,
  withRequestLogging,
  writeEvent,
} from '@/lib/observability'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('logging configuration', () => {
  test('defaults local to pretty and production to json', () => {
    expect(parseLogConfig({ NODE_ENV: 'development' })).toEqual({
      format: 'pretty',
      level: 'INFO',
    })
    expect(parseLogConfig({ NODE_ENV: 'production' })).toEqual({
      format: 'json',
      level: 'INFO',
    })
  })

  test('rejects invalid format and level', () => {
    expect(() => parseLogConfig({ LOG_FORMAT: 'xml' })).toThrow(/LOG_FORMAT/)
    expect(() => parseLogConfig({ LOG_LEVEL: 'LOUD' })).toThrow(/LOG_LEVEL/)
  })
})

test('json and pretty formats contain the same safe event fields', () => {
  const fields = {
    request_id: 'request-123',
    project_id: 'project-123',
    duration_ms: 12,
  }
  const json = JSON.parse(
    formatEvent('INFO', 'http.request.completed', fields, {
      format: 'json',
      level: 'INFO',
    }),
  ) as Record<string, unknown>
  const pretty = formatEvent('INFO', 'http.request.completed', fields, {
    format: 'pretty',
    level: 'INFO',
  })

  expect(json.event).toBe('http.request.completed')
  expect(json.request_id).toBe('request-123')
  expect(pretty).toContain('http.request.completed')
  expect(pretty).toContain('request_id=request-123')
  expect(pretty).toContain('project_id=project-123')
  expect(pretty).toContain('duration_ms=12')
})

test('drops unknown fields and unsafe string values', () => {
  const rendered = formatEvent(
    'ERROR',
    'project.create.failed',
    {
      api_key: 'secret-key',
      source_url: 'https://example.test/?token=secret',
      project_id: 'project with private title',
      error_code: 'INTERNAL',
    },
    { format: 'json', level: 'INFO' },
  )

  expect(rendered).toContain('INTERNAL')
  expect(rendered).not.toContain('secret')
  expect(rendered).not.toContain('example.test')
  expect(rendered).not.toContain('private title')
})

test('writeEvent isolates console serialization failures', () => {
  const fallback = vi.spyOn(console, 'error').mockImplementation(() => {
    throw new Error('console unavailable')
  })

  expect(() =>
    writeEvent('ERROR', 'safe.event', { error_code: 'INTERNAL' }),
  ).not.toThrow()
  expect(fallback).toHaveBeenCalled()
})

test('returns and logs one validated request id', async () => {
  const output = vi.spyOn(console, 'info').mockImplementation(() => undefined)
  const handler = withRequestLogging('/api/example', async (_request, _context, log) => {
    log.info('example.work', { project_id: 'project-1' })
    return Response.json({ ok: true }, { status: 201 })
  })

  const response = await handler(
    new Request('http://local/api/example', {
      headers: { 'x-request-id': 'request-123' },
    }),
    {},
  )

  expect(response.headers.get('x-request-id')).toBe('request-123')
  const rendered = output.mock.calls.flat().join(' ')
  expect(rendered).toContain('request-123')
  expect(rendered).toContain('duration_ms')
  expect(rendered).not.toContain('http://local')
})

test('invalid request id is replaced with a uuid', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  const handler = withRequestLogging('/api/example', async () => new Response(null))

  const response = await handler(
    new Request('http://local/api/example', {
      headers: { 'x-request-id': 'bad id with spaces' },
    }),
    {},
  )

  expect(response.headers.get('x-request-id')).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})

test('thrown handler logs safe failure and rethrows', async () => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const handler = withRequestLogging('/api/example', async () => {
    throw new Error('private request body')
  })

  await expect(
    handler(
      new Request('http://local/api/example', {
        headers: { 'x-request-id': 'request-failure' },
      }),
      {},
    ),
  ).rejects.toThrow('private request body')

  const rendered = output.mock.calls.flat().join(' ')
  expect(rendered).toContain('http.request.failed')
  expect(rendered).toContain('request-failure')
  expect(rendered).toContain('error_class=Error')
  expect(rendered).not.toContain('private request body')
})

test('returned server error remains a completed request with status', async () => {
  const output = vi.spyOn(console, 'info').mockImplementation(() => undefined)
  const handler = withRequestLogging('/api/example', async () =>
    Response.json({ error: true }, { status: 500 }),
  )

  await handler(new Request('http://local/api/example'), {})

  const rendered = output.mock.calls.flat().join(' ')
  expect(rendered).toContain('http.request.completed')
  expect(rendered).toContain('status_code=500')
})

test('error metadata keeps class and code without leaking message or query', () => {
  class DriverError extends Error {
    code = '42703'
    query = 'select secret from private_table'
  }
  const error = new DriverError('column secret does not exist')

  expect(errorFields(error)).toEqual({
    error_class: 'DriverError',
    error_code: '42703',
  })
  expect(JSON.stringify(errorFields(error))).not.toContain('secret')
})
