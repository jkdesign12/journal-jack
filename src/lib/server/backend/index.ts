import 'server-only';
import type { Backend } from './types';
import { usingPostgres } from './choose';

/* Which one you get:
 *
 *   a Postgres URL in the environment -> Postgres, plus a blob store for the
 *                                        photos and songs. This is what a
 *                                        serverless host needs, having no disk
 *                                        that survives a deploy.
 *   otherwise                         -> SQLite and files under ./data, here.
 *
 * Loaded on demand so the one you are not using is never imported — SQLite
 * would fail to resolve on a host without it, and the Postgres driver has no
 * business being loaded when running on your own machine. */
let chosen: Promise<Backend> | null = null;

export function backend(): Promise<Backend> {
  chosen ??= usingPostgres()
    ? import('./postgres').then((m) => m.postgresBackend)
    : import('./sqlite').then((m) => m.sqliteBackend);
  return chosen;
}

export { connectionString, usingPostgres } from './choose';
