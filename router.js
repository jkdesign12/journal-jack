/* router.js — every /api/* route, shared by both ways this app runs:
     server.js   a normal Node process on your machine or a box with a disk
     api/        a serverless function on Vercel, which has neither

   Nothing in here touches the filesystem; that is all behind store.js, which
   picks its backend from the environment. */

const { manifest, pull, artwork } = require('./services');
const store = require('./store');

const json = (res, code, body, headers = {}) => {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': buf.length, ...headers });
  res.end(buf);
};

function body(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const readJSON = async (req) => {
  const buf = await body(req);
  try { return JSON.parse(buf.toString('utf8') || '{}'); }
  catch { throw new Error('Invalid JSON body'); }
};

const cookies = (req) => Object.fromEntries(
  (req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? ['', ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }));

/* Behind a proxy that terminates TLS (Fly, a tunnel, nginx) the socket itself is
   plain http, so the forwarded header is what says the browser is on https. */
const isHTTPS = (req) =>
  req.socket.encrypted || (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

const sessionCookie = (req, token) =>
  `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}` +
  (isHTTPS(req) ? '; Secure' : '');

const me = (req) => store.sessionUser(cookies(req).sid);      // may be a promise
const needAuth = async (req, res) => {
  const user = await me(req);
  if (!user) { json(res, 401, { error: 'Not signed in' }); return null; }
  return user;
};

/* A request that reached us over a proxy, or from another machine, is not local. */
const isLocal = (req) =>
  !req.headers['x-forwarded-for'] &&
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

/* Importing hits third-party APIs on our behalf. On a machine only you can reach
   that can stay open; the moment the app is on the internet it needs a session,
   or the deploy becomes a free scraping proxy for whoever finds it. */
const needAuthIfPublic = async (req, res) => (isLocal(req) ? true : !!(await needAuth(req, res)));

/* Who is allowed to create an account:
   - SIGNUP_CODE set  -> anyone holding that code
   - otherwise        -> only while the deploy has no accounts yet (you claim it,
                         then it closes itself) */
async function signupAllowed(code) {
  const required = process.env.SIGNUP_CODE;
  if (required) return code === required ? true : 'That signup code is not right';
  if ((await store.userCount()) === 0) return true;
  return 'This journal is private. Set SIGNUP_CODE on the server to invite someone.';
}

/* Slow down guessing without a dependency: per-IP attempts on the auth routes. */
const attempts = new Map();
function rateLimited(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, until: now + 15 * 60e3 };
  if (now > rec.until) { rec.n = 0; rec.until = now + 15 * 60e3; }
  rec.n++;
  attempts.set(ip, rec);
  if (attempts.size > 5000) attempts.clear();
  return rec.n > 12;
}

/* ---------------- api ---------------- */

async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  /* ---- imports ---- */

  /* Open /api/health in a browser to see what the deployment actually has.
     Booleans only — never the values themselves. */
  if (p === '/api/health') {
    const pgVar = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'DATABASE_POSTGRES_URL', 'NEON_DATABASE_URL']
      .find((k) => (process.env[k] || '').startsWith('postgres'));
    const blobAuth = process.env.BLOB_READ_WRITE_TOKEN ? 'read-write token'
      : (process.env.BLOB_STORE_ID || process.env.VERCEL_OIDC_TOKEN) ? 'OIDC'
      : null;
    return json(res, 200, {
      database: pgVar ? `connected (via ${pgVar})` : 'MISSING — accounts and journals cannot be saved',
      fileStorage: blobAuth ? `connected (${blobAuth})` : 'MISSING — photos and songs cannot be saved',
      storeAccess: process.env.BLOB_ACCESS || 'detected on first upload (private is tried first)',
      clientUploads: process.env.BLOB_READ_WRITE_TOKEN
        ? 'available (files over 4.5 MB can go straight to storage)'
        : 'unavailable — big files rely on resizing first',
      whatToDo: (pgVar && blobAuth)
        ? 'Nothing: storage is set up.'
        : 'In Vercel open this project, go to Storage, add whichever is missing, connect it to this project, then redeploy.'
    });
  }

  if (p === '/api/services') return json(res, 200, { services: manifest() });

  if (p === '/api/pull') {
    if (!(await needAuthIfPublic(req, res))) return;
    const qs = url.searchParams;
    const id = qs.get('service');
    const cfg = {};
    for (const [k, v] of qs) if (k.startsWith('cfg.')) cfg[k.slice(4)] = v;
    const started = Date.now();
    try {
      const items = await pull(id, cfg, { from: qs.get('from'), to: qs.get('to') });
      const months = new Set(items.map((i) => (i.date || '').slice(0, 7)).filter(Boolean));
      console.log(`  pull ${id} -> ${items.length} items / ${months.size} months (${Date.now() - started}ms)`);
      return json(res, 200, { items, months: months.size });
    } catch (e) {
      console.log(`  pull ${id} failed: ${e.message}`);
      return json(res, 502, { error: e.message });
    }
  }

  if (p === '/api/artwork' && m === 'POST') {
    if (!(await needAuthIfPublic(req, res))) return;
    const { items = [], tmdbKey = '' } = await readJSON(req);
    try {
      const result = await artwork(items, {
        tmdbKey,
        lookup: store.artLookup,
        store: store.artStore
      });
      return json(res, 200, result);      // { found, pending, throttled }
    } catch (e) { return json(res, 502, { error: e.message }); }
  }

  /* ---- accounts ---- */

  if (p === '/api/auth/signup' && m === 'POST') {
    if (rateLimited(req)) return json(res, 429, { error: 'Too many attempts — wait a few minutes' });
    const { email, password, code } = await readJSON(req);
    const allowed = await signupAllowed(code);
    if (allowed !== true) return json(res, 403, { error: allowed });
    try {
      const user = await store.signup(email, password);
      const token = await store.openSession(user.id);
      console.log(`  account created: ${user.email}`);
      return json(res, 200, { user }, { 'Set-Cookie': sessionCookie(req, token) });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (p === '/api/auth/login' && m === 'POST') {
    if (rateLimited(req)) return json(res, 429, { error: 'Too many attempts — wait a few minutes' });
    const { email, password } = await readJSON(req);
    try {
      const user = await store.login(email, password);
      const token = await store.openSession(user.id);
      return json(res, 200, { user }, { 'Set-Cookie': sessionCookie(req, token) });
    } catch (e) { return json(res, 401, { error: e.message }); }
  }

  if (p === '/api/auth/logout' && m === 'POST') {
    await store.closeSession(cookies(req).sid);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
  }

  if (p === '/api/auth/me') {
    return json(res, 200, {
      user: await me(req),
      signupOpen: (await signupAllowed('__probe__')) === true || !!process.env.SIGNUP_CODE,
      needsCode: !!process.env.SIGNUP_CODE
    });
  }

  /* ---- journal sync ---- */

  if (p === '/api/journal' && m === 'GET') {
    const user = await needAuth(req, res); if (!user) return;
    return json(res, 200, await store.getJournal(user.id));
  }

  if (p === '/api/journal' && m === 'PUT') {
    const user = await needAuth(req, res); if (!user) return;
    const { doc, baseVersion } = await readJSON(req);
    if (!doc || typeof doc !== 'object') return json(res, 400, { error: 'No document' });
    const out = await store.putJournal(user.id, doc, baseVersion);
    return json(res, out.conflict ? 409 : 200, out);
  }

  /* ---- blobs ---- */

  if (p === '/api/blobs' && m === 'GET') {
    const user = await needAuth(req, res); if (!user) return;
    return json(res, 200, { ids: await store.listBlobs(user.id) });
  }

  /* A serverless host refuses request bodies over 4.5 MB, which is smaller than
     most songs. So big files never touch this function: the browser asks here
     for a short-lived upload token, sends the file straight to the blob store,
     and the store calls back to tell us where it landed. Only offered when a
     blob store is actually configured; on a disk-backed host the plain PUT below
     handles any size. */
  if (p === '/api/blob-token' && m === 'POST') {
    /* A read-write token is the usual way to mint a browser upload token, but a
       store connected through Vercel's own credentials has no such variable and
       used to be turned away here without even trying — which left big files
       with nowhere to go. Try whenever a store exists at all; a genuine refusal
       comes back below with the real reason. */
    if (!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || process.env.VERCEL_OIDC_TOKEN)) {
      return json(res, 404, { error: 'This deployment has no file storage connected' });
    }
    const user = await needAuth(req, res); if (!user) return;

    const { handleUpload } = require('@vercel/blob/client');
    const raw = await body(req, 1 << 20);
    try {
      const result = await handleUpload({
        request: req,
        body: JSON.parse(raw.toString('utf8') || '{}'),
        onBeforeGenerateToken: async (pathname) => {
          if (!String(pathname).startsWith(user.id + '/')) {
            throw new Error('That upload path is not yours');
          }
          return {
          // the id the client wants is namespaced under the account, so one
          // person can never write over another's file
            allowedContentTypes: ['audio/*', 'image/*', 'video/*'],
            addRandomSuffix: false,
            tokenPayload: JSON.stringify({ userId: user.id, pathname })
          };
        },
        onUploadCompleted: async ({ blob, tokenPayload }) => {
          const { userId } = JSON.parse(tokenPayload || '{}');
          const id = blob.pathname.split('/').pop();
          await store.recordBlob(userId, id, blob.contentType, blob.size || 0, blob.url);
        }
      });
      return json(res, 200, result);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (p.startsWith('/api/blob/')) {
    const user = await needAuth(req, res); if (!user) return;
    const id = decodeURIComponent(p.slice('/api/blob/'.length));

    if (m === 'PUT' || m === 'POST') {
      try {
        await store.putBlob(user.id, id, req.headers['content-type'], await body(req));
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (m === 'GET') {
      const blob = await store.getBlob(user.id, id);
      if (!blob) return json(res, 404, { error: 'No such file' });
      if (blob.url) {
        // a public blob: hand the browser the URL and let it fetch directly
        res.writeHead(302, { Location: blob.url, 'Cache-Control': 'private, max-age=3600' });
        return res.end();
      }
      if (blob.stream) {
        /* a private blob: unreachable without credentials, so it is streamed
           through here. The sign-in check above is what guards it. */
        res.writeHead(200, {
          'Content-Type': blob.mime || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-cache'
        });
        return require('node:stream').Readable.fromWeb(blob.stream).pipe(res);
      }
      res.writeHead(200, {
        'Content-Type': blob.mime,
        'Content-Length': blob.buf.length,
        'Cache-Control': 'private, max-age=31536000'
      });
      return res.end(blob.buf);
    }
  }

  // name the path: a mis-wired host is otherwise invisible from the browser
  return json(res, 404, { error: `No such endpoint: ${m} ${p}` });
}

module.exports = { api, json, isLocal };
