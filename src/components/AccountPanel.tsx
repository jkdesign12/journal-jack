'use client';

import { useEffect, useState } from 'react';
import { Account } from '@/lib/client/account';
import { Popover } from './Popover';

type Mode = 'signin' | 'signup';

export function AccountPanel({
  onClose,
  onSignedIn,
  onSignedOut,
  onSync,
  busy,
}: {
  onClose: () => void;
  onSignedIn: () => void;
  onSignedOut: () => void;
  onSync: () => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [signupOpen, setSignupOpen] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const user = Account.user;

  useEffect(() => {
    if (user) return;
    void fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: { signupOpen?: boolean; needsCode?: boolean }) => {
        setSignupOpen(!!d.signupOpen);
        setNeedsCode(!!d.needsCode);
      })
      .catch(() => {});
  }, [user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setWorking(true);
    try {
      if (mode === 'signup') await Account.signup(email, password, code);
      else await Account.login(email, password);
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    }
    setWorking(false);
  }

  if (user) {
    return (
      <Popover onClose={onClose} title="Your account">
        <p className="text-[12.5px] text-ink-2">
          Signed in as <b className="text-ink">{user.email}</b>
        </p>
        <p className="text-[11.5px] leading-relaxed text-ink-3">
          Your journal lives on this device and is copied to the account, so it reaches your other
          devices. Nothing is replaced when they disagree — both sides are kept.
        </p>

        <button className="btn" onClick={onSync} disabled={busy}>
          {busy ? 'Syncing…' : 'Sync now'}
        </button>

        <button
          className="btn ghost"
          onClick={async () => {
            await Account.logout();
            onSignedOut();
          }}
        >
          Sign out
        </button>
      </Popover>
    );
  }

  return (
    <Popover onClose={onClose} title={mode === 'signup' ? 'Make an account' : 'Sign in'}>
      <form className="flex flex-col gap-2.5" onSubmit={submit}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">Email</span>
          <input
            className="field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">Password</span>
          <input
            className="field"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {mode === 'signup' && needsCode ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">Invite code</span>
            <input className="field" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
        ) : null}

        {error ? <p className="text-[12px] text-[#e2725b]">{error}</p> : null}

        <button className="btn" type="submit" disabled={working}>
          {working ? 'One moment…' : mode === 'signup' ? 'Make the account' : 'Sign in'}
        </button>
      </form>

      {signupOpen || mode === 'signup' ? (
        <button
          className="text-left text-[11.5px] text-ink-3 underline decoration-line underline-offset-2 hover:text-ink"
          onClick={() => {
            setMode(mode === 'signup' ? 'signin' : 'signup');
            setError('');
          }}
        >
          {mode === 'signup' ? 'I already have an account' : 'Make an account instead'}
        </button>
      ) : null}

      <p className="text-[11.5px] leading-relaxed text-ink-3">
        An account is only for carrying the journal between devices. Everything works without one —
        it just stays on this device.
      </p>
    </Popover>
  );
}
