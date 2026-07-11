'use client'

import { useRef, useState } from 'react'
import { Button, Card, CardHeader, Textarea } from '@/components/ui/primitives'
import { apiFetch } from '@/lib/api/fetcher'
import { filesToResizedDataUrls, resizeFiles, extractImageFiles } from '@/lib/util/image'

const CATEGORIES = [
  { v: 'auto', label: '자동 분류' },
  { v: 'error', label: '오류' },
  { v: 'progress', label: '진행' },
  { v: 'question', label: '질문/답변' },
  { v: 'solution', label: '해결' },
  { v: 'mood', label: '분위기' },
  { v: 'action', label: '조치' }
] as const

function chipClass(active: boolean): string {
  return `px-2.5 py-1 rounded-full text-xs border transition-colors ${
    active ? 'bg-accent text-white border-accent' : 'bg-surfaceAlt/60 text-textDim border-border hover:text-text'
  }`
}

export function QuickNoteComposer({ sessionId, onDone }: { sessionId: string; onDone?: () => void }) {
  const [text, setText] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState<string>('auto')
  const isQna = category === 'question'
  const isSol = category === 'solution' // 오류/해결 2칸 구조화 입력 (질문/답변과 동일 방식)
  const isStructured = isQna || isSol
  const [forMain, setForMain] = useState(false)
  const [forAssistant, setForAssistant] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const MAX_IMAGES = 8

  async function handleFiles(files: FileList | null) {
    try {
      const resized = await filesToResizedDataUrls(files, MAX_IMAGES)
      if (resized.length) setImages((prev) => [...prev, ...resized].slice(0, MAX_IMAGES))
    } catch {
      setMessage('이미지 처리 실패')
    }
  }

  // 드롭/붙여넣기 → 이미지 추출(items fallback 포함) 후 추가.
  async function addFromTransfer(dt: DataTransfer | null) {
    try {
      const resized = await resizeFiles(extractImageFiles(dt), MAX_IMAGES)
      if (resized.length) setImages((prev) => [...prev, ...resized].slice(0, MAX_IMAGES))
    } catch {
      setMessage('이미지 처리 실패')
    }
  }

  function removeImage(i: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== i))
  }

  function audienceValue(): 'main' | 'assistant' | 'both' | undefined {
    if (forMain && forAssistant) return 'both'
    if (forMain) return 'main'
    if (forAssistant) return 'assistant'
    return undefined
  }

  async function submit() {
    const q = question.trim()
    const a = answer.trim()
    // 구조화 모드(질문/답변·오류/해결)는 두 칸을 명시 필드로 보낸다(라벨 누수 없이 'Q./A.' · '오류./해결.'로 표시).
    const rawText = isStructured ? q : text.trim()
    if ((isStructured ? !q : !rawText) && !images.length) return
    setBusy(true)
    setMessage(category === 'auto' ? 'AI가 정리하는 중...' : '저장하는 중...')
    try {
      const audience = audienceValue()
      const res = await apiFetch('/api/action', {
        method: 'POST',
        body: JSON.stringify({
          action: 'liveops.ingest_raw_note',
          actor: { type: 'human', role: 'assistant', tool: 'web-ui' },
          scope: { sessionId },
          idempotencyKey: `note-${sessionId}-${Date.now()}`,
          redactionPolicy: 'summary',
          dryRun: false,
          input: {
            sessionId,
            rawText: rawText || '(스크린샷)',
            source: 'web',
            visibility: 'private',
            ...(isQna
              ? { question: q, ...(a ? { answer: a } : {}) }
              : isSol
                ? { issue: q, ...(a ? { solution: a } : {}) }
                : category !== 'auto'
                  ? { category }
                  : {}),
            ...(audience ? { audience } : {}),
            ...(images.length ? { images } : {})
          }
        })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setText('')
      setQuestion('')
      setAnswer('')
      setImages([])
      setMessage('상황판에 반영됐습니다.')
      onDone?.()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '입력 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="빠른 입력" hint="키워드·스크린샷 드래그(여러 장)" />
      <div className="p-4 space-y-3">
        <p className="text-xs text-textMute">키워드·시간만 적어도 AI가 정리해서 반영합니다 — 문장 형식은 신경 쓰지 마세요.</p>
        <div
          onDrop={(e) => {
            e.preventDefault()
            void addFromTransfer(e.dataTransfer)
          }}
          onDragOver={(e) => e.preventDefault()}
          onPaste={(e) => {
            const files = extractImageFiles(e.clipboardData)
            if (files.length) {
              e.preventDefault()
              void addFromTransfer(e.clipboardData)
            }
          }}
        >
          {isStructured ? (
            <div className="space-y-2">
              <div>
                <label className="text-[11px] text-textMute">{isSol ? '오류(문제)' : '질문'}</label>
                <Textarea
                  aria-label={isSol ? '오류' : '질문'}
                  rows={2}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={isSol ? '예: 2번 테이블, 사내망에서 npm install 실패' : '예: 사내망에서 외부 API 호출이 막히나요?'}
                />
              </div>
              <div>
                <label className="text-[11px] text-textMute">
                  {isSol ? '해결 방식' : '답변'} <span className="text-textMute/70">(선택)</span>
                </label>
                <Textarea
                  aria-label={isSol ? '해결 방식' : '답변'}
                  rows={3}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={isSol ? '예: 사내 프록시 레지스트리로 바꾸니 설치됨' : '예: 프록시 허용 도메인에 등록하면 호출됩니다.'}
                />
              </div>
            </div>
          ) : (
            <Textarea
              aria-label="빠른 입력"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="예: 13:20 2번 테이블 로그인 막힘 → 시크릿 모드로 해결. (스크린샷 드래그·붙여넣기 가능)"
            />
          )}
        </div>
        {images.length ? (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative inline-block">
                <img src={img} alt={`첨부 스크린샷 ${i + 1}`} className="max-h-28 rounded border border-border" />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  aria-label={`이미지 ${i + 1} 제거`}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-danger/80 text-white text-xs flex items-center justify-center"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-xs text-textMute mr-1 w-10">분류</span>
          {CATEGORIES.map((c) => (
            <button key={c.v} type="button" onClick={() => setCategory(c.v)} aria-pressed={category === c.v} className={chipClass(category === c.v)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-xs text-textMute mr-1 w-10">대상</span>
          <button type="button" onClick={() => setForMain((v) => !v)} aria-pressed={forMain} className={chipClass(forMain)}>
            메인강사
          </button>
          <button type="button" onClick={() => setForAssistant((v) => !v)} aria-pressed={forAssistant} className={chipClass(forAssistant)}>
            보조강사
          </button>
          {forMain && forAssistant ? <span className="text-[11px] text-textMute">양쪽 패널 모두 표시</span> : null}
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-textMute">
            {category === 'auto'
              ? '키워드 자동 분류. 오분류 시 분류를 고르고, 스크린샷은 드래그·붙여넣기.'
              : isQna
                ? '질문과 답변을 나눠 적으면 상황판에 Q/A로 표시됩니다. (답변은 선택)'
                : isSol
                  ? '오류와 해결 방식을 나눠 적으면 상황판에 오류/해결로 표시됩니다. (해결은 선택)'
                  : `'${CATEGORIES.find((c) => c.v === category)?.label}'(으)로 저장됩니다.`}
          </p>
          <div className="flex gap-2 shrink-0">
            <Button onClick={() => fileRef.current?.click()} disabled={busy || images.length >= MAX_IMAGES}>
              {images.length ? `이미지 +(${images.length}/${MAX_IMAGES})` : '이미지'}
            </Button>
            <Button
              variant="accent"
              onClick={submit}
              disabled={busy || (isStructured ? !question.trim() && !images.length : !text.trim() && !images.length)}
            >
              {busy ? '저장 중' : '반영'}
            </Button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {message ? <p className="text-xs text-textDim" role="status" aria-live="polite">{message}</p> : null}
      </div>
    </Card>
  )
}
