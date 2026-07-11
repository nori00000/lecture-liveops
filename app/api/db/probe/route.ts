import { NextResponse } from 'next/server';
import { getMode } from '@/lib/db/client';
import { isNeonEnabled, probeNeon } from '@/lib/db/neon';
import { runEntitySmoke } from '@/lib/db/entitySmoke';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const mode = getMode();
  const url = new URL(req.url);
  const skipSmoke = url.searchParams.get('smoke') === '0';
  const baseHeaders = {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow'
  };

  if (!isNeonEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        mode,
        message:
          'Neon adapter is not active. Set DATABASE_URL=postgres://… in .env.local then restart the dev server.'
      },
      { status: 200, headers: baseHeaders }
    );
  }

  try {
    const result = await probeNeon();
    const entitySmoke = skipSmoke ? null : await runEntitySmoke();
    return NextResponse.json(
      {
        ok: true,
        mode,
        probe: result,
        entity_smoke: entitySmoke,
        probed_at: new Date().toISOString()
      },
      { status: 200, headers: baseHeaders }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(
      { ok: false, mode, error: message },
      { status: 500, headers: baseHeaders }
    );
  }
}
