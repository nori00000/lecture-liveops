import { neon, neonConfig, type NeonQueryFunction } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = true;

let cachedOwner: NeonQueryFunction<false, false> | null = null;
let cachedAnon: NeonQueryFunction<false, false> | null = null;
let warnedFallback = false;

export function isNeonEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.startsWith('postgres'));
}

export function isAnonAvailable(): boolean {
  return Boolean(process.env.DATABASE_URL_ANON?.startsWith('postgres'));
}

export function getNeonOwnerSql(): NeonQueryFunction<false, false> {
  if (cachedOwner) return cachedOwner;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  cachedOwner = neon(url);
  return cachedOwner;
}

export function getNeonAnonSql(): NeonQueryFunction<false, false> {
  if (cachedAnon) return cachedAnon;
  const url = process.env.DATABASE_URL_ANON;
  if (!url) {
    if (!warnedFallback) {
      console.error('[ax] DATABASE_URL_ANON not set — falling back to owner role (RLS bypass risk).');
      warnedFallback = true;
    }
    return getNeonOwnerSql();
  }
  cachedAnon = neon(url);
  return cachedAnon;
}

// 호환 alias: 기존 getNeonSql() 호출은 owner 반환 (probe meta 등 server-only)
export function getNeonSql(): NeonQueryFunction<false, false> {
  return getNeonOwnerSql();
}

export type DbProbeResult = {
  mode: 'neon';
  database_version: string;
  rls_entities: number;
  policy_count: number;
  helper_functions: string[];
  tables: { name: string; rls_enabled: boolean }[];
  counts: Record<string, number>;
  rls_enforced: boolean;
  anon_role_active: boolean;
  anon_user?: string;
};

const ENTITY_TABLES = [
  'companies',
  'courses',
  'sessions',
  'access_keys',
  'qna_items',
  'practice_tickets',
  'resources',
  'ops_logs',
  'assistant_signals',
  'table_statuses',
  'excel_templates',
  'excel_cells',
  'export_jobs',
  'external_archives',
  'action_ledger'
] as const;

export async function probeNeon(): Promise<DbProbeResult> {
  const sql = getNeonOwnerSql();
  const versionRows = await sql`select version() as version`;
  const tableRows = await sql`
    select tablename, rowsecurity
    from pg_tables
    where schemaname = 'public'
      and tablename = ANY(${ENTITY_TABLES as unknown as string[]})
    order by tablename
  `;
  const policyRows = await sql`
    select count(*)::int as count from pg_policies where schemaname = 'public'
  `;
  const helperRows = await sql`
    select proname from pg_proc
    where pronamespace = (select oid from pg_namespace where nspname='public')
      and proname like 'ax_%'
    order by proname
  `;
  const counts: Record<string, number> = {};
  for (const t of ENTITY_TABLES) {
    const r = await sql.query(`select count(*)::int as c from ${t}`);
    counts[t] = (r[0] as { c: number }).c;
  }

  let anonActive = false;
  let anonUser: string | undefined;
  if (isAnonAvailable()) {
    try {
      const anonSql = getNeonAnonSql();
      const u = await anonSql`select current_user as u`;
      anonUser = (u[0] as { u: string }).u;
      anonActive = anonUser === 'liveops_anon';
    } catch {
      anonActive = false;
    }
  }

  return {
    mode: 'neon',
    database_version: String((versionRows[0] as { version: string }).version).split(' ').slice(0, 2).join(' '),
    rls_entities: tableRows.filter((r) => (r as { rowsecurity: boolean }).rowsecurity).length,
    policy_count: (policyRows[0] as { count: number }).count,
    helper_functions: helperRows.map((r) => (r as { proname: string }).proname),
    tables: tableRows.map((r) => ({
      name: (r as { tablename: string }).tablename,
      rls_enabled: (r as { rowsecurity: boolean }).rowsecurity
    })),
    counts,
    rls_enforced: anonActive,
    anon_role_active: anonActive,
    anon_user: anonUser
  };
}
