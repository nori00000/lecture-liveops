import { PageHeader } from '@/components/ui/primitives'
import { WorkshopCreateForm } from '@/components/delib/WorkshopCreateForm'

export default function NewWorkshopPage() {
  return (
    <div className="p-6 max-w-3xl">
      <PageHeader
        title="새 숙의 워크숍"
        desc="세션을 먼저 만든 뒤, 프라이버시 사전 합의를 거쳐 워크숍을 시작합니다."
      />
      <WorkshopCreateForm />
    </div>
  )
}
