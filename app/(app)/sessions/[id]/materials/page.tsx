import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/primitives'
import { MaterialStatusPanel } from '@/components/liveops/MaterialStatusPanel'
import { sessions, materialVersions } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'

type PageProps = { params: Promise<{ id: string }> }

export default async function SessionMaterialsPage({ params }: PageProps) {
  const { id } = await params
  const session = await sessions.findById(adminContext(id), id)
  if (!session) notFound()
  const materials = await materialVersions.listBySession(id)
  return (
    <div className="p-6 space-y-4">
      <PageHeader title="자료 협업" desc={`${session.title} · draft/review/shared 상태로 자료를 관리합니다.`} />
      <MaterialStatusPanel materials={materials} />
    </div>
  )
}
