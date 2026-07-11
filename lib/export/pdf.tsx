// Lecture LiveOps — PDF export (real renderer)
// Hallmark anti-slop: 이모지/박스 콜아웃/자기 칭찬/italic 금지. 단일 세리프 위계, 절제된 여백.

import React from 'react'
import { Document, Page, Text, View, StyleSheet, Font, pdf } from '@react-pdf/renderer'
import { planMarkdownExport } from './markdown'
import { exportSessionHtml } from './html'

let fontRegistered = false
function ensureFont() {
  if (fontRegistered) return
  try {
    Font.register({
      family: 'Pretendard',
      fonts: [
        { src: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Regular.otf', fontWeight: 400 },
        { src: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Medium.otf', fontWeight: 500 },
        { src: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-SemiBold.otf', fontWeight: 600 }
      ]
    })
    Font.registerHyphenationCallback((word) => [word])
    fontRegistered = true
  } catch {
    fontRegistered = true
  }
}

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingHorizontal: 56, paddingBottom: 56, fontFamily: 'Pretendard', fontSize: 10, color: '#1B1B1F', lineHeight: 1.6 },
  header: { fontSize: 9, color: '#6A6A72', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: 600, marginBottom: 6, color: '#0A0A0B' },
  subtitle: { fontSize: 10, color: '#6A6A72', marginBottom: 20 },
  noteTitle: { fontSize: 12, fontWeight: 600, marginTop: 18, marginBottom: 6, color: '#0A0A0B', borderBottom: '0.5pt solid #26262B', paddingBottom: 3 },
  body: { fontSize: 9.5, lineHeight: 1.65, color: '#1B1B1F' },
  footer: { position: 'absolute', bottom: 24, left: 56, right: 56, fontSize: 8, color: '#9A9AA1', borderTop: '0.5pt solid #E8E8EA', paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' }
})

function stripFrontmatter(s: string): string {
  if (!s.startsWith('---')) return s
  const end = s.indexOf('\n---', 3)
  if (end < 0) return s
  return s.slice(end + 4).trimStart()
}

function PdfDoc({ sessionId, title, files }: { sessionId: string; title: string; files: { name: string; content: string }[] }) {
  return (
    <Document title={`Lecture LiveOps — ${title}`} author="Lecture LiveOps" producer="Lecture LiveOps">
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.header} fixed>Lecture LiveOps · 세션 아카이브</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{`session: ${sessionId} · 6 노트 세트`}</Text>
        {files.map((f) => (
          <View key={f.name} wrap>
            <Text style={styles.noteTitle}>{f.name}</Text>
            <Text style={styles.body}>{stripFrontmatter(f.content)}</Text>
          </View>
        ))}
        <View style={styles.footer} fixed>
          <Text>Lecture LiveOps</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

import { adminContext } from '../db/neonHelpers'

export async function exportSessionPdfBuffer(sessionId: string, title = 'Lecture LiveOps Session'): Promise<Buffer> {
  ensureFont()
  const files = await planMarkdownExport(adminContext(sessionId), sessionId)
  const inst = pdf(<PdfDoc sessionId={sessionId} title={title} files={files} />)
  const blob = await inst.toBlob()
  const ab = await blob.arrayBuffer()
  return Buffer.from(ab)
}

// HTML fallback (브라우저 인쇄용)
export async function exportSessionPdfStub(sessionId: string) {
  return { kind: 'html' as const, html: await exportSessionHtml(sessionId), note: 'HTML 미리보기 (브라우저 인쇄→PDF 저장 가능)' }
}
