/* Talking to the account.
 *
 * The journal on this device is the original; the account is how it reaches
 * your other devices. Every call here is best-effort — being signed out, or
 * offline, must never cost you work you have already done locally.
 */

import type { JournalDoc } from '@/lib/journal/types';
import { UPLOAD_LIMIT } from './images';

export interface AccountUser {
  id: string;
  email: string;
}

export interface PullResult {
  doc: JournalDoc | null;
  version: number;
  updated: number;
}

export interface PushResult {
  ok?: boolean;
  conflict?: boolean;
  doc?: JournalDoc | null;
  version?: number;
}

/** Anything above this goes straight to storage rather than through the site. */
const DIRECT_OVER = 4 * 1024 * 1024;

class DirectRouteMissing extends Error {
  readonly noDirectRoute = true;
}

async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; data: T }> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok && res.status !== 409) throw new Error(data.error || `Request failed (${res.status})`);
  return { status: res.status, data };
}

export const Account = {
  user: null as AccountUser | null,
  version: 0,

  async init(): Promise<AccountUser | null> {
    try {
      const { data } = await api<{ user: AccountUser | null }>('/api/auth/me');
      this.user = data.user;
    } catch {
      this.user = null;
    }
    return this.user;
  },

  async signup(email: string, password: string, code?: string): Promise<AccountUser> {
    const { data } = await api<{ user: AccountUser }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, code }),
    });
    this.user = data.user;
    return data.user;
  },

  async login(email: string, password: string): Promise<AccountUser> {
    const { data } = await api<{ user: AccountUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.user = data.user;
    return data.user;
  },

  async logout(): Promise<void> {
    await api('/api/auth/logout', { method: 'POST' });
    this.user = null;
    this.version = 0;
  },

  async pullDoc(): Promise<PullResult> {
    const { data } = await api<PullResult>('/api/journal');
    this.version = data.version;
    return data;
  },

  /** Returns { ok } or { conflict, doc, version } — the caller decides. */
  async pushDoc(doc: JournalDoc): Promise<PushResult> {
    const { status, data } = await api<PushResult>('/api/journal', {
      method: 'PUT',
      body: JSON.stringify({ doc, baseVersion: this.version }),
    });
    if (status === 409) {
      this.version = data.version ?? this.version; // or every later push is stale too
      return { conflict: true, doc: data.doc, version: data.version };
    }
    this.version = data.version ?? this.version;
    return { ok: true, version: data.version };
  },

  async remoteBlobIds(): Promise<string[]> {
    if (!this.user) return [];
    const { data } = await api<{ ids: string[] }>('/api/blobs');
    return data.ids ?? [];
  },

  async remoteBlob(id: string): Promise<Blob | null> {
    if (!this.user) return null;
    const res = await fetch('/api/blob/' + encodeURIComponent(id), { credentials: 'same-origin' });
    if (!res.ok) return null;
    return res.blob();
  },

  async uploadBlob(id: string, blob: Blob, opts: { loud?: boolean } = {}): Promise<boolean> {
    if (!this.user || !blob) return false;

    const plain = async () => {
      const res = await fetch('/api/blob/' + encodeURIComponent(id), {
        method: 'PUT',
        credentials: 'same-origin',
        body: blob,
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Upload failed (${res.status})`);
      }
      return true;
    };

    if (blob.size > DIRECT_OVER) {
      try {
        return await this.uploadDirect(id, blob);
      } catch (e) {
        /* No direct route here — the normal state of a host that keeps files
           itself and has no size cap to dodge. Try the ordinary route before
           declaring the file unsendable. */
        if ((e as DirectRouteMissing).noDirectRoute) {
          try {
            return await plain();
          } catch (inner) {
            if (opts.loud) {
              throw new Error(
                `${(e as Error).message} (and the ordinary route said: ${(inner as Error).message})`,
              );
            }
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
      return false; // picked up again by the next file sync
    }
  },

  /**
   * The blob store's own client library does the token dance. It is imported on
   * demand, so nothing is downloaded until a file too big for the ordinary
   * route actually turns up.
   */
  async uploadDirect(id: string, blob: Blob): Promise<boolean> {
    const probe = await fetch('/api/blob-token', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'probe' }),
    });
    if (probe.status === 404) {
      throw new DirectRouteMissing(
        'This file is larger than the host accepts (4.5 MB) and there is no blob store configured',
      );
    }

    const { upload } = await import('@vercel/blob/client');
    await upload(`${this.user!.id}/${id}`, blob, {
      access: 'public',
      contentType: blob.type || 'application/octet-stream',
      handleUploadUrl: '/api/blob-token',
    });
    return true;
  },
};

/**
 * Turn the reasons an upload can fail into something you can act on. The
 * libraries underneath talk about environment variables and status codes; what
 * matters is which of a few situations you are in.
 */
export function explainUploadError(msg = ''): string {
  if (/no token found|BLOB_READ_WRITE_TOKEN/i.test(msg)) {
    return (
      'This site has no file storage connected yet. In Vercel: open the project, Storage, ' +
      'create a Blob store, connect it, then redeploy. Your photos are safe on this device meanwhile.'
    );
  }
  if (/payload too large|413/i.test(msg)) {
    return 'The host refused a file for being too large. Try that photo again — it will be resized first.';
  }
  if (/not signed in|401/i.test(msg)) return 'Signed out mid-upload. Sign in and press sync again.';
  if (/failed to fetch|network/i.test(msg)) {
    return 'Lost the connection. Press sync again when you are back online.';
  }
  return msg;
}

export { UPLOAD_LIMIT };
