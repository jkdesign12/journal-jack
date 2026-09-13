'use client';

import { useEffect, useRef, useState } from 'react';
import { DB } from '@/lib/client/db';
import { Account } from '@/lib/client/account';
import { store } from '@/lib/client/store';
import { uid } from '@/lib/journal/uid';
import type { Song } from '@/lib/journal/types';

const time = (s: number) => {
  if (!isFinite(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/**
 * One song per month.
 *
 * A song is big, so prefer streaming it over pulling the whole file into
 * memory: a local copy plays instantly and offline, and anything else comes
 * straight off the server as a normal media URL, which also gives the browser
 * range requests so the scrubber can seek without downloading everything first.
 */
export function Player({
  song,
  autoplay,
  onAutoplay,
  onSet,
  onClear,
  onNote,
}: {
  song: Song | null | undefined;
  autoplay: boolean;
  onAutoplay: (on: boolean) => void;
  onSet: (song: Song) => void;
  onClear: () => void;
  onNote: (message: string, bad?: boolean) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);

  useEffect(() => {
    let alive = true;

    /* Changing month changes the song under the player, so what it was showing
       about the last one — how far in, whether it was playing — has to go. The
       element's own events set these again once the new file loads, so this
       waits a tick rather than setting state while rendering. */
    const reset = setTimeout(() => {
      if (!alive) return;
      setPlaying(false);
      setAt(0);
      if (!song) setSrc(null);
    }, 0);

    if (!song) {
      return () => {
        alive = false;
        clearTimeout(reset);
      };
    }

    void (async () => {
      const local = await DB.getBlob(song.blobId);
      if (!alive) return;
      if (local) {
        const url = URL.createObjectURL(local);
        setSrc(url);
        return;
      }
      // not here: let the browser stream it from the account
      setSrc(Account.user ? '/api/blob/' + encodeURIComponent(song.blobId) : null);
    })();

    return () => {
      alive = false;
      clearTimeout(reset);
    };
  }, [song]);

  /* Autoplay needs a gesture to have happened at some point, which pressing the
     autoplay button itself provides — so it starts from there rather than on
     load, where the browser would refuse it. */
  useEffect(() => {
    if (!autoplay || !src) return;
    void audio.current?.play().catch(() => {});
  }, [autoplay, src]);

  const choose = async (file: File) => {
    if (!/^audio\//.test(file.type)) {
      onNote('That is not an audio file', true);
      return;
    }
    const blobId = uid();
    await DB.putBlob(blobId, file);
    onSet({ blobId, name: file.name.replace(/\.[^.]+$/, '') });
    if (Account.user) void import('@/lib/client/sync').then((m) => m.syncFiles());
  };

  return (
    <div className="flex items-center gap-3.5 border-b border-line px-5 py-2.5 max-[640px]:gap-2.5 max-[640px]:px-3">
      <button
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[13px] text-accent disabled:opacity-40"
        disabled={!src}
        onClick={() => {
          const el = audio.current;
          if (!el) return;
          if (el.paused) void el.play().catch(() => onNote('That song will not play here', true));
          else el.pause();
        }}
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[12.5px] text-ink-2">
            {song ? song.name : 'No song for this month'}
          </span>
          <span className="flex-none text-[11px] tabular-nums text-ink-3">{time(at)}</span>
        </div>

        <div
          className="mt-1.5 h-1 cursor-pointer rounded-full bg-line"
          onClick={(e) => {
            const el = audio.current;
            if (!el || !length) return;
            const box = e.currentTarget.getBoundingClientRect();
            el.currentTime = ((e.clientX - box.left) / box.width) * length;
          }}
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: length ? `${(at / length) * 100}%` : 0 }}
          />
        </div>
      </div>

      <button
        className={
          'flex h-8 w-8 flex-none items-center justify-center rounded-[9px] text-[15px] ' +
          (autoplay ? 'text-accent' : 'text-ink-3 hover:text-ink')
        }
        title="Autoplay the month's song"
        aria-pressed={autoplay}
        onClick={() => onAutoplay(!autoplay)}
      >
        ⭮
      </button>

      <button className="btn ghost flex-none max-[640px]:hidden" onClick={() => picker.current?.click()}>
        {song ? 'Change song' : 'Set song'}
      </button>
      {song ? (
        <button
          className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] text-ink-3 hover:text-ink"
          title="Remove song"
          onClick={onClear}
        >
          ✕
        </button>
      ) : null}

      <input
        ref={picker}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void choose(file);
        }}
      />

      <audio
        ref={audio}
        src={src ?? undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
        onEnded={() => {
          // one song, on repeat, is what a month's song is for
          if (store.view.autoplay) void audio.current?.play().catch(() => {});
        }}
      />
    </div>
  );
}
