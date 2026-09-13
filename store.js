/* store.js — picks where your journal actually lives.
 *
 *   a Postgres URL in the environment -> Postgres, plus a blob store for photos
 *                                        and mp3s. This is what a serverless host
 *                                        (Vercel) needs, since it has no disk that
 *                                        survives a deploy or a cold start.
 *   otherwise                         -> SQLite and files under ./data, here.
 *
 * Both expose the same functions, so router.js never knows which it is talking to.
 *
 * Providers disagree about the variable name — Neon sets DATABASE_URL, the old
 * Vercel Postgres set POSTGRES_URL, others use their own — so accept the common
 * ones rather than making you rename anything in the dashboard.
 */

const PG_VARS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_POSTGRES_URL',
  'NEON_DATABASE_URL'
];

const found = PG_VARS.find((name) => (process.env[name] || '').startsWith('postgres'));
if (found) process.env.DATABASE_URL = process.env[found];

module.exports = found
  ? require('./store.pg')
  : require('./store.sqlite');
