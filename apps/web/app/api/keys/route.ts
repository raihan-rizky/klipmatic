import { NextResponse } from 'next/server'
import { ApiKeyValidationError, listApiKeys, saveApiKey } from '@/lib/apiKeys'
import { sql } from '@/lib/db'
import { messageFor } from '@/lib/errorMessages'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { supabaseServer } from '@/lib/supabase/server'

async function currentUserId(): Promise<string | null> {
  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

function unauthorized() {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Silakan masuk dulu.' } },
    { status: 401 },
  )
}

export const GET = withRequestLogging('/api/keys', async () => {
  const userId = await currentUserId()
  if (!userId) return unauthorized()
  return NextResponse.json({ keys: await listApiKeys(sql, userId) })
})

export const POST = withRequestLogging('/api/keys', async (req, _ctx, log) => {
  const userId = await currentUserId()
  if (!userId) return unauthorized()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  try {
    const result = await saveApiKey(sql, userId, {
      provider: body.provider as never,
      label: typeof body.label === 'string' ? body.label : '',
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : null,
      model: typeof body.model === 'string' ? body.model : '',
      secret: typeof body.secret === 'string' ? body.secret : '',
    })
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    if (e instanceof ApiKeyValidationError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION', message: e.message } },
        { status: 400 },
      )
    }
    // Hanya ringkasan galat, bukan objeknya: galat driver postgres membawa
    // teks query beserta parameternya. Tanpa ringkasan ini kegagalan 500 tidak
    // meninggalkan jejak apa pun.
    log.error('api_key.save.failed', errorFields(e))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: messageFor('INTERNAL') } },
      { status: 500 },
    )
  }
})
