'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, Card, CardHeader, PageHeader, Select } from '@/components/ui/primitives'
import { invoke } from '@/lib/util/envelope'

type Settings = {
  anonymous: boolean
  disclosure: 'participants' | 'operators_only' | 'public'
  retentionDays: '7' | '30' | '90'
  minorSession: boolean
}

const DEFAULTS: Settings = { anonymous: false, disclosure: 'participants', retentionDays: '30', minorSession: false }

// 설정은 현재 DB 영속 액션이 없어 로컬(localStorage)에 세션별로 보관한다.
// (delib 액션은 1.5단계에서 하드닝 완료·읽기전용 — 설정 영속화는 신규 액션 필요, main 판단 대기)
const storageKey = (sessionId: string) => `delib-settings:${sessionId}`

export default function WorkshopSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params)
  const router = useRouter()
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [consent, setConsent] = useState(false)
  const [minorConsent, setMinorConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(sessionId))
      if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) })
    } catch {
      // 손상된 저장값 무시 — 기본값 유지
    }
  }, [sessionId])

  function update(patch: Partial<Settings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(storageKey(sessionId), JSON.stringify(next))
      } catch {
        // 저장 실패는 무시 (프라이빗 모드 등)
      }
      return next
    })
  }

  // §7-4 프라이버시 사전 합의 게이트: 합의 없이는 시작 불가.
  // 미성년자 세션이면 법정대리인 동의 확인까지 필요.
  const consentSatisfied = consent && (!settings.minorSession || minorConsent)

  async function startWorkshop() {
    if (!consentSatisfied) return
    setBusy(true)
    setMessage('워크숍 시작 중...')
    try {
      const res = await invoke({
        action: 'delib.create_workshop',
        role: 'instructor',
        scope: { sessionId },
        input: { sessionId, title: '오프닝' }
      })
      if (!res?.ok) throw new Error(res?.error ?? '워크숍 시작 실패')
      router.push(`/workshops/${encodeURIComponent(sessionId)}/console`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '워크숍 시작 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <PageHeader title="워크숍 설정" desc="프라이버시·공개범위·보관기간을 확정하고 사전 합의 후 시작합니다." />

      <Card>
        <CardHeader title="프라이버시 & 공개 설정" />
        <div className="p-4 space-y-4">
          <ToggleRow
            label="익명 모드"
            hint="참가자 발언·투표를 익명 처리합니다. (참가자 12명 미만이면 참가자 화면에서 자동 비활성 안내)"
            checked={settings.anonymous}
            onChange={(v) => update({ anonymous: v })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="결과 공개범위">
              <Select value={settings.disclosure} onChange={(e) => update({ disclosure: e.target.value as Settings['disclosure'] })}>
                <option value="participants">참가자까지 공개</option>
                <option value="operators_only">운영자만</option>
                <option value="public">전체 공개</option>
              </Select>
            </Field>
            <Field label="보관기간">
              <Select value={settings.retentionDays} onChange={(e) => update({ retentionDays: e.target.value as Settings['retentionDays'] })}>
                <option value="7">7일</option>
                <option value="30">30일</option>
                <option value="90">90일</option>
              </Select>
            </Field>
          </div>
          <ToggleRow
            label="미성년자 참여 세션"
            hint="켜면 법정대리인 동의 문구가 표시되고, 시작 전에 동의 확인이 필요합니다."
            checked={settings.minorSession}
            onChange={(v) => update({ minorSession: v })}
          />
        </div>
      </Card>

      {/* 프라이버시 사전 합의 게이트 (§7-4) */}
      <Card>
        <CardHeader title="사전 합의" hint="합의 없이는 워크숍을 시작할 수 없습니다" />
        <div className="p-4 space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 h-5 w-5 accent-accent"
              aria-label="프라이버시 사전 합의"
            />
            <span className="text-sm text-text">
              위 공개범위·보관기간·익명성 설정을 확인했으며, 참가자에게 데이터 수집·이용 범위를 고지하고
              동의를 받은 상태에서 워크숍을 진행함에 합의합니다.
            </span>
          </label>

          {settings.minorSession ? (
            <div className="rounded-md border border-warn/40 bg-warn/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone="warn">미성년자 세션</Badge>
                <span className="text-sm text-warn font-medium">법정대리인 동의 필요</span>
              </div>
              <p className="text-xs text-textDim">
                만 14세 미만 참가자의 개인정보 수집·이용에는 법정대리인의 동의가 필요합니다(개인정보 보호법 제22조의2).
                동의서 서면 또는 전자 동의를 사전에 확보하고, 미동의 참가자는 무기록 방식으로 참여시키십시오.
              </p>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={minorConsent}
                  onChange={(e) => setMinorConsent(e.target.checked)}
                  className="mt-1 h-5 w-5 accent-accent"
                  aria-label="법정대리인 동의 확보 확인"
                />
                <span className="text-sm text-text">참여 미성년자 전원에 대해 법정대리인 동의를 확보했습니다.</span>
              </label>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-textMute">
              {consentSatisfied ? '시작 준비 완료' : '사전 합의를 완료하면 시작 버튼이 활성화됩니다.'}
            </p>
            <Button variant="accent" onClick={startWorkshop} disabled={!consentSatisfied || busy}>
              {busy ? '시작 중' : '워크숍 시작'}
            </Button>
          </div>
          {message ? <p className="text-xs text-textDim">{message}</p> : null}
        </div>
      </Card>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-textDim mb-1">{label}</span>
      {children}
    </label>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-text font-medium">{label}</div>
        <div className="text-xs text-textMute mt-0.5">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={
          'shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent ' +
          (checked ? 'bg-accent' : 'bg-surfaceAlt border border-border')
        }
      >
        <span className={'inline-block h-4 w-4 rounded-full bg-text transition-transform ' + (checked ? 'translate-x-6' : 'translate-x-1')} />
      </button>
    </div>
  )
}
