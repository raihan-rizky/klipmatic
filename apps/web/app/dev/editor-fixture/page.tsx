import { notFound } from 'next/navigation'
import { EditorFixture } from '@/components/editor/EditorFixture'

export default function EditorFixturePage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <EditorFixture />
}
