export const dynamic = 'force-dynamic'

export default async function AdminErrorPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams
  return (
    <main className="min-h-screen flex items-center justify-center bg-bg text-text p-6">
      <div className="w-full max-w-sm bg-surface border border-border rounded-md p-6">
        <h1 className="text-lg font-semibold mb-2">로그인 오류</h1>
        <p className="text-sm text-textDim">{sp.error ?? '알 수 없는 오류가 발생했습니다.'}</p>
        <a href="/admin/login" className="mt-6 inline-block text-sm text-accent hover:underline">
          로그인 페이지로 돌아가기
        </a>
      </div>
    </main>
  )
}
