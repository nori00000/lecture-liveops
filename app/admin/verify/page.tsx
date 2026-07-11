export const dynamic = 'force-dynamic'

export default function VerifyPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-bg text-text p-6">
      <div className="w-full max-w-sm bg-surface border border-border rounded-md p-6 text-center">
        <h1 className="text-lg font-semibold mb-2">이메일을 확인하세요</h1>
        <p className="text-sm text-textDim leading-relaxed">
          입력한 주소로 매직 링크를 보냈습니다.<br />
          메일에서 링크를 클릭하면 자동으로 로그인됩니다.
        </p>
        <p className="mt-6 text-xs text-textMute">
          링크가 도착하지 않으면 스팸함을 확인하거나 다시 시도하세요.
        </p>
      </div>
    </main>
  )
}
