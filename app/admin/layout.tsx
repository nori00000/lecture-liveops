import { redirect } from 'next/navigation'
import { auth, signOut } from '@/auth'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/admin/login')

  const user = session.user as { email?: string | null; role?: string }
  const role = user.role ?? 'instructor'
  if (role !== 'admin' && role !== 'instructor') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-bg text-text p-6">
        <div className="max-w-sm bg-surface border border-border rounded p-6 text-center">
          <h1 className="text-lg font-semibold mb-2">접근 권한 없음</h1>
          <p className="text-sm text-textDim">현재 role: {role}. 강사 또는 운영자만 접근할 수 있습니다.</p>
        </div>
      </main>
    )
  }

  async function handleSignOut() {
    'use server'
    await signOut({ redirectTo: '/admin/login' })
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border bg-surface px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Lecture LiveOps · 운영자</div>
          <div className="text-xs text-textDim">{user.email} · {role}</div>
        </div>
        <form action={handleSignOut}>
          <button className="text-xs text-textDim border border-border rounded px-2 py-1 hover:bg-surfaceAlt hover:text-text">
            로그아웃
          </button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  )
}
