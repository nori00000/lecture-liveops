import { PageHeader } from '@/components/ui/primitives'
import { SessionCreateForm } from '@/components/liveops/SessionCreateForm'

export default function NewSessionPage() {
  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="새 강의 세션"
        desc="기업·날짜·교육 카테고리를 기준으로 실시간 상황판을 생성합니다."
      />
      <SessionCreateForm />
    </div>
  )
}
