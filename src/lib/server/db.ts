import 'server-only';
import { neon } from '@neondatabase/serverless';

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

export const hasDatabase = () => connectionString() !== null;

let client: ReturnType<typeof neon> | null = null;

export function sql() {
  const url = connectionString();
  if (!url) {
    throw new Error(
      'No database connected. Set DATABASE_URL — in Vercel: Storage, create or connect a ' +
        'Postgres database, then redeploy.',
    );
  }
  client ??= neon(url);
  return client;
}

/**
 * The driver's return type is a union covering every way it can be configured,
 * which makes every call site fight the compiler. Queries here always come back
 * as rows, so this says so once instead of at every call.
 */
export async function rows<T>(query: Promise<unknown>): Promise<T[]> {
  return (await query) as T[];
}

/* A serverless function starts cold and forgets everything, so the schema is
   ensured once per instance rather than once per deploy.

   These tables are the ones the journal already lives in. The column names and
   types are fixed by the data that is in them — this creates them on a fresh
   database and is a no-op against the existing one. */
let schema: Promise<void> | null = null;

export function ready(): Promise<void> {
  schema ??= (async () => {
    const db = sql();
    await db`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
      hash TEXT NOT NULL, salt TEXT NOT NULL, created BIGINT NOT NULL)`;
    await db`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created BIGINT NOT NULL)`;
    await db`CREATE TABLE IF NOT EXISTS journals (
      user_id TEXT PRIMARY KEY, doc JSONB NOT NULL,
      version INTEGER NOT NULL, updated BIGINT NOT NULL)`;
    await db`CREATE TABLE IF NOT EXISTS blobs (
      id TEXT NOT NULL, user_id TEXT NOT NULL, mime TEXT, size INTEGER,
      url TEXT NOT NULL, created BIGINT NOT NULL, PRIMARY KEY (id, user_id))`;
    await db`CREATE TABLE IF NOT EXISTS artwork (
      key TEXT PRIMARY KEY, url TEXT, at BIGINT NOT NULL)`;
  })();
  return schema;
}
