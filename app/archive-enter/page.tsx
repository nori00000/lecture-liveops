import { Card } from '@/components/ui/primitives'

export const metadata = { title: '세션 아카이브 — Lecture LiveOps' }

// 세션 아카이브 비밀번호 입력 페이지. 마스터 비밀번호를 넣으면 아카이브로 이동한다.
export default async function ArchiveEnterPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const params = await searchParams
  const next = params.next ?? '/sessions'

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-bg">
      <Card className="w-full max-w-md p-6 flex flex-col gap-4">
        <div>
          <p className="eyebrow">Archive</p>
          <h1 className="text-xl font-semibold">세션 아카이브</h1>
          <p className="text-sm text-textDim mt-1">
            지난 세션 기록을 보려면 비밀번호를 입력하세요.
          </p>
        </div>
        {params.error ? (
          <p role="status" className="text-sm text-[#d64545]">
            비밀번호가 올바르지 않습니다. 다시 확인해 주세요.
          </p>
        ) : null}
        <form method="get" action="/api/archive-enter" className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <input
            type="password"
            name="key"
            aria-label="아카이브 비밀번호"
            placeholder="비밀번호"
            autoComplete="off"
            className="min-h-[44px] rounded border border-border bg-surfaceAlt px-3 text-text"
          />
          <button
            type="submit"
            className="min-h-[44px] rounded border border-border bg-surface font-medium text-text hover:bg-border"
          >
            열기
          </button>
        </form>
      </Card>
    </main>
  )
}
