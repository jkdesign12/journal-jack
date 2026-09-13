/* api/[...path].js — the serverless entry point.
 *
 * The filename is a catch-all, so every /api/* request lands here with its
 * original path intact and the router can match on it. An earlier version used
 * a rewrite in vercel.json instead; that rewrote the URL to the function's own
 * path, so the router saw "/api/index" and answered "No such endpoint" to
 * everything, including signup.
 */

const { api, json } = require('../router');

module.exports = async (req, res) => {
  const base = `https://${req.headers.host || 'localhost'}`;

  /* Prefer the catch-all segments Vercel parsed for us; fall back to req.url.
     Either way the router gets the path the browser actually asked for. */
  const segs = req.query?.path;
  const pathname = Array.isArray(segs) ? '/api/' + segs.join('/')
    : typeof segs === 'string' && segs ? '/api/' + segs
    : new URL(req.url, base).pathname;

  const url = new URL(pathname + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''), base);

  try {
    await api(req, res, url);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message });
  }
};
