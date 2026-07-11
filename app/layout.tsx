import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Lecture LiveOps',
  description: '기업 AX 교육 운영 OS — 강의 전/중/후 실시간 협업',
  robots: { index: false, follow: false }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <body className="bg-bg text-text font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
