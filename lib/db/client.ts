import { isNeonEnabled } from './neon';

export type DbMode = 'fixture' | 'supabase' | 'neon';

export function assertProductionDbEnabled(): void {
  if (process.env.NODE_ENV === 'production' && !isNeonEnabled()) {
    throw new Error('Production database is not configured: DATABASE_URL must point to Neon.');
  }
}

export function getMode(): DbMode {
  if (isNeonEnabled()) {
    return 'neon';
  }
  assertProductionDbEnabled();
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return 'supabase';
  }
  return 'fixture';
}

export function isFixture(): boolean {
  return getMode() === 'fixture';
}
