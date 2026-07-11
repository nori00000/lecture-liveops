// 붙여넣은 명단 텍스트 → 팀별 명단 파싱. 배치도 빌더의 "명단 붙여넣기" 전용.
// 지원 형식(권장): 팀 이름 줄 + 그 아래 이름들. PDF 페이지를 통째로 붙여도
// 반 헤더/좌석 범례/주·보조강사 줄은 걸러낸다.

export type ParsedTeam = { label: string; members: string[] }

// 반 헤더·좌석 범례·강사 소개 등 명단이 아닌 줄. 팀 헤더보다 우선 적용한다.
const SKIP_RE = /스크린|강사석|방향|책상|주강사|보조강사|퍼실|총\s*\d+\s*명|명\s*[×xX*]|Enterprise|Antigravity|Claude/i
// "A-1팀 7명", "3팀", "1조" 등 — 앞 10자 안에 팀/조로 끝나고 뒤에 "N명"만 허용.
const HEADER_RE = /^(.{1,10}?(?:팀|조))\s*(?:\d+\s*명)?\s*$/
// 좌석 명단 토큰 — 한글 이름 2~5자만 취한다(숫자·"N명"·범례어 제거).
const NAME_RE = /^[가-힣]{2,5}$/

export function normalizeLabel(line: string): string {
  return line.replace(/\s*\d+\s*명\s*$/, '').trim().replace(/\s+/g, '')
}

/** 붙여넣기 파서용 — 한글 이름만 취해 노이즈를 제거한다. */
export function splitNames(line: string): string[] {
  return line
    .split(/[\s,、·/|]+/)
    .map((t) => t.trim())
    .filter((t) => NAME_RE.test(t))
}

/** 팀 편집 textarea용 — 사용자가 직접 친 값이므로 공백/쉼표만 나누고 필터하지 않는다. */
export function splitMembersLoose(text: string): string[] {
  return text
    .split(/[\s,、·]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export function parseRosterPaste(text: string): ParsedTeam[] {
  const teams: ParsedTeam[] = []
  let current: ParsedTeam | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (SKIP_RE.test(line)) continue
    if (HEADER_RE.test(line)) {
      current = { label: normalizeLabel(line), members: [] }
      teams.push(current)
      continue
    }
    const names = splitNames(line)
    if (names.length === 0) continue
    if (!current) {
      current = { label: `${teams.length + 1}팀`, members: [] }
      teams.push(current)
    }
    current.members.push(...names)
  }
  return teams
}
