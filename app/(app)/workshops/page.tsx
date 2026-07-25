import Link from 'next/link'
import { Badge, Button, Card, CardHeader, PageHeader } from '@/components/ui/primitives'
import { sessions, companies, delibRounds } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'

// 숙의 워크숍 목록 — 워크숍은 라운드가 붙은 세션이다. 세션 전체를 나열하고
// 라운드 유무로 "워크숍 시작됨"을 표시한다. 기존 강의(liveops) 화면과 분리된 신규 라우트.
export const dynamic = 'force-dynamic'

export default async function WorkshopsListPage() {
  const ctx = adminContext()
  const [sessionRows, companyRows] = await Promise.all([sessions.list(ctx), companies.list(ctx)])
  const withRounds = await Promise.all(
    sessionRows.map(async (s) => ({
      session: s,
      companyName: companyRows.find((c) => c.id === s.company_id)?.name ?? s.company_id,
      roundCount: (await delibRounds.list(adminContext(s.id), s.id)).length
    }))
  )

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="숙의 워크숍"
        desc="라운드·그룹·투표로 운영하는 논쟁형 워크숍을 만들고 관리합니다."
        right={<Link href="/workshops/new"><Button variant="accent">새 워크숍</Button></Link>}
      />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {withRounds.map(({ session, companyName, roundCount }) => (
          <Card key={session.id}>
            <CardHeader title={session.title} hint={session.date} />
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={roundCount > 0 ? 'accent' : 'neutral'}>
                  {roundCount > 0 ? `라운드 ${roundCount}` : '워크숍 미시작'}
                </Badge>
                <span className="text-xs text-textMute">{companyName}</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Link href={`/workshops/${session.id}/console`}><Button size="sm" variant="accent">운영 콘솔</Button></Link>
                <Link href={`/dialogue/${session.id}/projector`}><Button size="sm" variant="accent">Room Mirror</Button></Link>
                <Link href={`/dialogue/${session.id}/live`}><Button size="sm">Lens 미리보기</Button></Link>
                <Link href={`/workshops/${session.id}/settings`}><Button size="sm">설정</Button></Link>
                <Link href={`/workshops/${session.id}/projector`}><Button size="sm">결과판</Button></Link>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {withRounds.length === 0 ? (
        <Card className="p-6 text-sm text-textMute">아직 세션이 없습니다. 새 워크숍을 만들어 시작하세요.</Card>
      ) : null}
    </div>
  )
}
