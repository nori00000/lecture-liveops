// 브라우저 전용 이미지 유틸 — 빠른입력/로그수정에서 공용 사용.
// 이미지를 maxPx 이내 JPEG data URL로 리사이즈해 DB 부담을 줄인다(로그 썸네일용).

export async function fileToResizedDataUrl(file: File, maxPx = 520): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('read fail'))
    fr.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('img fail'))
    im.src = dataUrl
  })
  const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.7)
}

// File[] 를 리사이즈해 data URL 배열로. 최대 maxCount장.
export async function resizeFiles(files: File[], maxCount = 8): Promise<string[]> {
  return Promise.all(files.slice(0, maxCount).map((f) => fileToResizedDataUrl(f)))
}

// 여러 파일 중 이미지 타입만 리사이즈해 data URL 배열로 (파일 input 용). 최대 maxCount장.
export async function filesToResizedDataUrls(files: FileList | null, maxCount = 8): Promise<string[]> {
  if (!files || !files.length) return []
  const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'))
  return resizeFiles(imgs, maxCount)
}

// 드롭/붙여넣기 이벤트의 DataTransfer/ClipboardData 에서 이미지 File 들을 뽑는다.
// 일부 브라우저·캡처도구는 files 가 비고 items 에만 담기므로 items fallback 을 둔다.
export function extractImageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out: File[] = []
  if (dt.files && dt.files.length) {
    for (const f of Array.from(dt.files)) if (f.type.startsWith('image/')) out.push(f)
  }
  if (!out.length && dt.items) {
    for (const it of Array.from(dt.items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) out.push(f)
      }
    }
  }
  return out
}
