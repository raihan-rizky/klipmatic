import Link from 'next/link'
import { LogIn } from 'lucide-react'
import { ClipEditor } from '@/components/ClipEditor'
import { StatePanel } from '@/components/StatePanel'
import { Button } from '@/components/ui/button'
import { currentAppUser } from '@/lib/auth/currentUser'

export const dynamic = 'force-dynamic'

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  await currentAppUser()
  return <ClipEditor clipId={(await params).id} />
}
