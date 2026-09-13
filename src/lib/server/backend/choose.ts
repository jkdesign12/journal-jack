import 'server-only';

/* Providers disagree about the variable name — Neon sets DATABASE_URL, the old
   Vercel Postgres set POSTGRES_URL — so accept the common ones rather than
   making anyone rename something in a dashboard. */
const PG_VARS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_POSTGRES_URL',
  'NEON_DATABASE_URL',
] as const;

export function connectionString(): string | null {
  for (const name of PG_VARS) {
    const value = process.env[name];
    if (value?.startsWith('postgres')) return value;
  }
  return null;
}

export const usingPostgres = () => connectionString() !== null;
