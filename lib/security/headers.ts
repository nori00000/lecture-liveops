// Lecture LiveOps — security headers (P1-2)
// CSP는 report-only로 시작. enforce는 P3-3에서 전환.

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' https://cdn.jsdelivr.net data:",
  "img-src 'self' data: https:",
  "connect-src 'self' https://*.neon.tech wss://*.neon.tech https://*.vercel.app https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "report-uri /api/csp/report"
].join('; ')

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy-Report-Only': CSP_REPORT_ONLY,
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  // 환경변수 명시 origin
  const allowed = (process.env.NEXT_PUBLIC_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (allowed.includes(origin)) return true
  // localhost (dev)
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true
  // Production origins must be explicitly configured through NEXT_PUBLIC_ORIGIN.
  return false
}

// rate limit + origin 검증에서 제외할 경로
const EXEMPT_PATHS = new Set(['/api/health', '/api/csp/report'])

export function isExemptFromRateLimit(pathname: string): boolean {
  return EXEMPT_PATHS.has(pathname)
}

export function isExemptFromOriginCheck(pathname: string): boolean {
  return EXEMPT_PATHS.has(pathname)
}
