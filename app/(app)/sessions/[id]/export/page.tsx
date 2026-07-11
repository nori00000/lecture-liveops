import { notFound } from 'next/navigation'
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives'
import { sessions } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { planMarkdownExport } from '@/lib/export/markdown'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ id: string }> }

export default async function SessionExportPage({ params }: PageProps) {
  const { id } = await params
  const ctx = adminContext(id)
  const session = await sessions.findById(ctx, id)
  if (!session) notFound()
  const files = await planMarkdownExport(ctx, id)
  const bundle = files.map((f) => `<!-- ${f.name} -->\n\n${f.content}`).join('\n\n---\n\n')
  return (
    <div className="p-6 space-y-4">
      <PageHeader title="세션 Markdown Export" desc={`${session.title} · ${session.date} · ${files.length}개 Markdown 파일`} />
      <Card>
        <CardHeader title="전체 번들" hint="복사해서 .md 백업으로 저장" />
        <pre className="max-h-[420px] overflow-auto p-4 text-xs leading-5 whitespace-pre-wrap text-textDim">{bundle}</pre>
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {files.map((file) => (
          <Card key={file.name}>
            <CardHeader title={file.name} hint={`${file.content.length.toLocaleString('ko-KR')}자`} />
            <pre className="max-h-[320px] overflow-auto p-4 text-xs leading-5 whitespace-pre-wrap text-textDim">{file.content}</pre>
          </Card>
        ))}
      </div>
    </div>
  )
}
