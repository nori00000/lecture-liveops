import { isNeonEnabled } from './neon';

export type DbMode = 'fixture' | 'supabase' | 'neon';

export function getMode(): DbMode {
  if (isNeonEnabled()) {
    return 'neon';
  }
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
