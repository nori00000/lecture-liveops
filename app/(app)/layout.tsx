import { Sidebar } from '@/components/shell/Sidebar'
import { getMode } from '@/lib/db/client'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const mode = getMode()
  return (
    <div className="md:flex min-h-screen bg-bg text-text">
      <Sidebar mode={mode} />
      <main className="flex-1 min-w-0 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8 max-w-full">
        {children}
      </main>
    </div>
  )
}
