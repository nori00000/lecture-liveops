import { auth } from '@/auth'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminHomePage() {
  const session = await auth()
  const user = session?.user as { email?: string | null; role?: string }
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">운영자 대시보드</h1>
      <p className="text-sm text-textDim mb-6">
        {user?.email ? `${user.email} 님` : '강사'}, 환영합니다. 회사 / 강의 / 세션을 선택해 운영을 시작하세요.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NavCard href="/companies" title="기업" desc="등록된 기업 목록" />
        <NavCard href="/courses" title="강의" desc="강의 카탈로그" />
        <NavCard href="/dates" title="날짜" desc="날짜별 세션" />
        <NavCard href="/today" title="오늘 세션" desc="실시간 대시보드" />
      </div>
    </div>
  )
}

function NavCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="block bg-surface border border-border rounded-md p-4 hover:border-accent transition-colors"
    >
      <div className="text-sm font-medium text-text">{title}</div>
      <div className="text-xs text-textDim mt-1">{desc}</div>
    </Link>
  )
}
