/* account.js — signing in, and keeping one journal across devices.
 *
 * The model is local-first: IndexedDB stays the working copy so the app runs
 * exactly as before when signed out. When you are signed in, every save is also
 * pushed to the server, and each photo or mp3 is uploaded once. Another device
 * signing in pulls the document, then fetches files lazily as it renders them.
 *
 * Concurrency is version-checked, not merged: the server refuses a push built on
 * a stale version and hands back the newer document. Last writer wins, but you
 * are told, rather than a device silently clobbering another. */

const Account = (() => {

  let user = null;
  let version = 0;
  let pushTimer = null;
  let policy = { signupOpen: true, needsCode: false };

  const api = async (path, opts = {}) => {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: opts.body && !opts.raw ? { 'Content-Type': 'application/json' } : undefined,
      ...opts
    });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : null;
    if (!res.ok && res.status !== 409) throw new Error(data?.error || 'HTTP ' + res.status);
    return { status: res.status, data };
  };

  return {
    get user() { return user; },
    get version() { return version; },
    get policy() { return policy; },

    async init() {
      try {
        const { data } = await api('/api/auth/me');
        user = data.user;
        policy = { signupOpen: data.signupOpen, needsCode: data.needsCode };
      } catch { user = null; }        // signed out, or no server: both fine
      return user;
    },

    async signup(email, password, code) {
      const { data } = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, code }) });
      user = data.user;
      return user;
    },

    async login(email, password) {
      const { data } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      user = data.user;
      return user;
    },

    async logout() {
      await api('/api/auth/logout', { method: 'POST' });
      user = null;
      version = 0;
    },

    /* ---- document ---- */

    async pullDoc() {
      const { data } = await api('/api/journal');
      version = data.version;
      return data;                     // { doc, version, updated }
    },

    /* Returns { ok } or { conflict, doc, version } — the caller decides. */
    async pushDoc(doc) {
      const { status, data } = await api('/api/journal', {
        method: 'PUT',
        body: JSON.stringify({ doc, baseVersion: version })
      });
      if (status === 409) {
        version = data.version;      // resync, or every later push is stale as well
        return { conflict: true, doc: data.doc, version: data.version };
      }
      version = data.version;
      return { ok: true, version };
    },

    /* Coalesce rapid edits into one push. */
    schedulePush(getDoc, onConflict) {
      if (!user) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(async () => {
        try {
          const res = await this.pushDoc(getDoc());
          if (res.conflict) onConflict?.(res);
        } catch (e) { /* offline: the local copy is still authoritative */ }
      }, 1200);
    },

    /* ---- files ---- */

    /* A serverless host rejects request bodies over 4.5 MB, and a song is
       usually bigger than that. Anything large therefore goes straight from the
       browser to the blob store, using a short-lived token this server issues;
       the file never passes through the function. Small files take the plain
       route, which also works on a host that stores files itself. */
    async uploadBlob(id, blob, opts = {}) {
      if (!user || !blob) return false;
      const DIRECT_OVER = 4 * 1024 * 1024;

      const plain = async () => {
        await api('/api/blob/' + encodeURIComponent(id), {
          method: 'PUT', body: blob, raw: true,
          headers: { 'Content-Type': blob.type || 'application/octet-stream' }
        });
        return true;
      };

      if (blob.size > DIRECT_OVER) {
        try {
          return await this.uploadDirect(id, blob);
        } catch (e) {
          /* No direct route here — which is the normal state of a host that
             keeps files itself and has no 4.5 MB limit to dodge. Try the
             ordinary route before declaring the file unsendable. */
          if (e.noDirectRoute) {
            try { return await plain(); } catch (inner) {
              if (opts.loud) throw new Error(e.message + ' (and the ordinary route said: ' + inner.message + ')');
              return false;
            }
          }
          if (opts.loud) throw e;
          return false;
        }
      }

      try {
        return await plain();
      } catch (e) {
        if (opts.loud) throw e;
        return false;      // retried by pushMissingBlobs on the next sign-in
      }
    },

    /* Vercel's own client library does the token dance. It is loaded on demand
       rather than bundled, so nothing is downloaded until you actually save a
       file too big for the ordinary route. */
    async uploadDirect(id, blob) {
      const probe = await fetch('/api/blob-token', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'probe' })
      });
      if (probe.status === 404) {
        const e = new Error('This file is larger than the host accepts (4.5 MB) and there is no blob store configured');
        e.noDirectRoute = true;                 // the caller may still try the ordinary route
        throw e;
      }

      const { upload } = await import('https://esm.sh/@vercel/blob@2/client');
      await upload(`${user.id}/${id}`, blob, {
        access: 'private',
        contentType: blob.type || 'application/octet-stream',
        handleUploadUrl: '/api/blob-token'
      });
      return true;
    },

    async remoteBlob(id) {
      if (!user) return null;
      const res = await fetch('/api/blob/' + encodeURIComponent(id), { credentials: 'same-origin' });
      if (!res.ok) return null;
      return res.blob();
    },

    async remoteBlobIds() {
      if (!user) return [];
      const { data } = await api('/api/blobs');
      return data.ids || [];
    },

    /* Upload anything this device holds that the server does not. */
    async pushMissingBlobs(localIds, getBlob, onProgress) {
      if (!user) return 0;
      const remote = new Set(await this.remoteBlobIds());
      const missing = localIds.filter((id) => !remote.has(id));
      let done = 0;
      for (const id of missing) {
        const blob = await getBlob(id);
        if (blob) await this.uploadBlob(id, blob);
        onProgress?.(++done, missing.length);
      }
      return missing.length;
    }
  };
})();
