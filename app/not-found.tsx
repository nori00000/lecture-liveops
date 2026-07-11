import Link from 'next/link';

export const dynamic = 'force-static';

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        padding: '2rem',
        background: '#0A0A0B',
        color: '#E8E8EA',
        fontFamily:
          'Pretendard Variable, Pretendard, -apple-system, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
      }}
    >
      <h1 style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>
        페이지를 찾을 수 없습니다
      </h1>
      <p style={{ color: '#9CA3AF', fontSize: '0.95rem' }}>
        요청한 경로가 사이드바 모듈에 등록되어 있지 않습니다.
      </p>
      <Link
        href="/today"
        style={{
          marginTop: '0.5rem',
          padding: '0.55rem 1rem',
          borderRadius: '0.5rem',
          border: '1px solid #2A2A2E',
          color: '#76B900',
          textDecoration: 'none',
          fontSize: '0.9rem',
        }}
      >
        오늘 대시보드로 이동
      </Link>
    </main>
  );
}
