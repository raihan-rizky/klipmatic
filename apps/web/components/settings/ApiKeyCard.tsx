import { KeyRound, LockKeyhole } from 'lucide-react'
import type { PublicApiKey } from '@/lib/apiKeys'
import { formatWaktu } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { DeleteApiKeyButton } from './DeleteApiKeyButton'

const PROVIDER_LABELS: Record<PublicApiKey['provider'], string> = {
  gemini: 'Google Gemini',
  openai_compat: 'OpenAI-compatible',
  anthropic_compat: 'Anthropic-compatible',
}

export function ApiKeyCard({ apiKey }: { apiKey: PublicApiKey }) {
  return (
    <Card>
      <CardContent className="flex gap-4 pt-5 sm:items-start sm:pt-6">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <KeyRound className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-black tracking-[-0.02em]">{apiKey.label}</h3>
            <Badge>
              <LockKeyhole className="mr-1 size-3" aria-hidden="true" />
              Terenkripsi
            </Badge>
          </div>
          <p className="mt-2 text-sm text-foreground">
            {PROVIDER_LABELS[apiKey.provider]} · {apiKey.model}
          </p>
          {apiKey.baseUrl && (
            <p className="mt-1 truncate font-mono text-xs text-muted">{apiKey.baseUrl}</p>
          )}
          <p className="mt-3 text-xs text-muted">
            {apiKey.lastUsedAt
              ? `Terakhir dipakai ${formatWaktu(apiKey.lastUsedAt)}`
              : 'Belum pernah dipakai'}
          </p>
        </div>
        <DeleteApiKeyButton id={apiKey.id} label={apiKey.label} />
      </CardContent>
    </Card>
  )
}
