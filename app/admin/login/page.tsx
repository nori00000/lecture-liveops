import { signIn } from '@/auth'

export const dynamic = 'force-dynamic'

export default function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  return <AdminLoginInner searchParamsPromise={searchParams} />
}

async function AdminLoginInner({ searchParamsPromise }: { searchParamsPromise: Promise<{ error?: string; callbackUrl?: string }> }) {
  const sp = await searchParamsPromise
  const error = sp.error
  const callbackUrl = sp.callbackUrl ?? '/admin'

  async function handleSignIn(formData: FormData) {
    'use server'
    const email = String(formData.get('email') ?? '').trim()
    if (!email) return
    await signIn('resend', { email, redirectTo: callbackUrl })
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg text-text p-6">
      <div className="w-full max-w-sm bg-surface border border-border rounded-md p-6">
        <h1 className="text-lg font-semibold mb-1">강사 · 운영자 로그인</h1>
        <p className="text-sm text-textDim mb-6">
          매직 링크가 이메일로 발송됩니다. 받은 메일에서 링크를 한 번만 클릭하면 8시간 동안 로그인 상태가 유지됩니다.
        </p>
        <form action={handleSignIn} className="space-y-3">
          <label className="block text-xs text-textDim">이메일</label>
          <input
            name="email"
            type="email"
            required
            placeholder="you@company.com"
            className="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-text placeholder-textMute focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="w-full bg-accentDim border border-accent text-text rounded px-3 py-1.5 text-sm hover:bg-accent/30"
          >
            매직 링크 보내기
          </button>
        </form>
        {error ? (
          <div className="mt-4 text-xs text-danger border border-danger/30 bg-danger/10 rounded p-2">
            로그인 실패: {error}
          </div>
        ) : null}
        <p className="mt-6 text-xs text-textMute">
          본 페이지는 강사 / 운영자 전용입니다. 참가자는 별도 입장 코드를 사용하세요.
        </p>
      </div>
    </main>
  )
}
