import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown',
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
    beforeSend(event) {
      // 추가 redact: request data 안의 cookie/authorization 제거
      if (event.request?.headers) {
        const h = event.request.headers as Record<string, unknown>;
        for (const k of Object.keys(h)) {
          if (/(cookie|authorization|x-csrf-token|x-request-id)/i.test(k)) {
            h[k] = '[REDACTED]';
          }
        }
      }
      return event;
    }
  });
}
