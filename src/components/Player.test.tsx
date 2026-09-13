/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import 'fake-indexeddb/auto';
import { Player } from './Player';
import { DB } from '@/lib/client/db';

/* Covers FEATURES 13.1–13.6: one song a month. */

beforeAll(async () => {
  await DB.init();
  // jsdom has no media engine, so these are stubs rather than real playback
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
});

function setup(song: { blobId: string; name: string } | null, autoplay = false) {
  const handlers = { onAutoplay: vi.fn(), onSet: vi.fn(), onClear: vi.fn(), onNote: vi.fn() };
  render(<Player song={song} autoplay={autoplay} {...handlers} />);
  return { user: userEvent.setup(), ...handlers };
}

describe('the month’s song', () => {
  it('says when there is not one', () => {
    setup(null);
    expect(screen.getByText('No song for this month')).toBeInTheDocument();
  });

  it('names the song when there is', () => {
    setup({ blobId: 'x', name: 'Loveless' });
    expect(screen.getByText('Loveless')).toBeInTheDocument();
  });

  it('cannot be played when there is nothing to play', () => {
    setup(null);
    expect(screen.getByTitle('Play')).toBeDisabled();
  });

  it('offers to set one, and to change it afterwards', () => {
    setup(null);
    expect(screen.getByRole('button', { name: 'Set song' })).toBeInTheDocument();

    setup({ blobId: 'x', name: 'Loveless' });
    expect(screen.getByRole('button', { name: 'Change song' })).toBeInTheDocument();
  });

  it('offers to remove a song only when there is one', () => {
    setup(null);
    expect(screen.queryByTitle('Remove song')).not.toBeInTheDocument();

    setup({ blobId: 'x', name: 'Loveless' });
    expect(screen.getByTitle('Remove song')).toBeInTheDocument();
  });

  it('removes the song when asked', async () => {
    const { user, onClear } = setup({ blobId: 'x', name: 'Loveless' });
    await user.click(screen.getByTitle('Remove song'));
    expect(onClear).toHaveBeenCalled();
  });

  it('turns autoplay on and off', async () => {
    const { user, onAutoplay } = setup(null, false);
    await user.click(screen.getByTitle("Autoplay the month's song"));
    expect(onAutoplay).toHaveBeenCalledWith(true);
  });

  it('shows whether autoplay is on', () => {
    setup(null, true);
    expect(screen.getByTitle("Autoplay the month's song")).toHaveAttribute('aria-pressed', 'true');
  });

  it('starts at nothing played', () => {
    setup({ blobId: 'x', name: 'Loveless' });
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('refuses a file that is not audio, and says so', async () => {
    const { onNote } = setup(null);
    const picker = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });

    Object.defineProperty(picker, 'files', { value: [file] });
    picker.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise((r) => setTimeout(r, 50));
    expect(onNote).toHaveBeenCalledWith('That is not an audio file', true);
  });

  it('stores an audio file and names the month’s song after it', async () => {
    const { onSet } = setup(null);
    const picker = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['x'], 'Loveless.mp3', { type: 'audio/mpeg' });

    Object.defineProperty(picker, 'files', { value: [file] });
    picker.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise((r) => setTimeout(r, 80));
    expect(onSet).toHaveBeenCalled();
    const song = onSet.mock.calls[0][0] as { blobId: string; name: string };
    expect(song.name).toBe('Loveless');
    expect(await DB.getBlob(song.blobId)).not.toBeNull();
  });
});
