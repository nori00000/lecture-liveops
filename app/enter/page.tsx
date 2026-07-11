import { Card } from '@/components/ui/primitives'

export const metadata = { title: '운영자 입장 — Lecture LiveOps' }

// 운영자 키 입력 페이지. 북마크(/api/enter?key=...)로 들어오면 이 페이지를 거치지 않는다.
export default async function EnterPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const params = await searchParams
  const next = params.next ?? '/today/seatmap'

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-bg">
      <Card className="w-full max-w-md p-6 flex flex-col gap-4">
        <div>
          <p className="eyebrow">Operator</p>
          <h1 className="text-xl font-semibold">운영자 입장</h1>
          <p className="text-sm text-textDim mt-1">
            운영자 키를 입력하면 좌석 보드로 이동합니다. 받은 입장 링크가 있다면 링크로 여는 것이 가장 빠릅니다.
          </p>
        </div>
        {params.error ? (
          <p role="status" className="text-sm text-[#d64545]">
            키가 올바르지 않습니다. 다시 확인해 주세요.
          </p>
        ) : null}
        <form method="get" action="/api/enter" className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <input
            type="password"
            name="key"
            aria-label="운영자 키"
            placeholder="운영자 키"
            autoComplete="off"
            className="min-h-[44px] rounded border border-border bg-surfaceAlt px-3 text-text"
          />
          <button
            type="submit"
            className="min-h-[44px] rounded border border-border bg-surface font-medium text-text hover:bg-border"
          >
            입장
          </button>
        </form>
      </Card>
    </main>
  )
}
