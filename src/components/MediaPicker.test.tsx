/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MediaPicker } from './MediaPicker';

/* Covers FEATURES 10.1 and 10.7: the two ways a picture gets in. */

function setup(linkOk = true) {
  const onClose = vi.fn();
  const onFiles = vi.fn();
  const onLink = vi.fn(() => linkOk);
  render(<MediaPicker onClose={onClose} onFiles={onFiles} onLink={onLink} />);
  return { user: userEvent.setup(), onClose, onFiles, onLink };
}

describe('adding media', () => {
  it('offers both a file and a link', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Choose from this computer' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://…/photo.jpg')).toBeInTheDocument();
  });

  it('is ready for a paste the moment it opens', () => {
    setup();
    expect(screen.getByPlaceholderText('https://…/photo.jpg')).toHaveFocus();
  });

  it('adds a link on Enter, and closes', async () => {
    const { user, onLink, onClose } = setup();
    await user.type(screen.getByPlaceholderText('https://…/photo.jpg'), 'https://a.test/b.jpg{Enter}');
    expect(onLink).toHaveBeenCalledWith('https://a.test/b.jpg');
    expect(onClose).toHaveBeenCalled();
  });

  it('adds a link from the button too', async () => {
    const { user, onLink } = setup();
    await user.type(screen.getByPlaceholderText('https://…/photo.jpg'), 'https://a.test/b.jpg');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onLink).toHaveBeenCalled();
  });

  /* A rejected link must not close the popover: you have to be able to fix it. */
  it('stays open and complains when the link is not one', async () => {
    const { user, onClose } = setup(false);
    await user.type(screen.getByPlaceholderText('https://…/photo.jpg'), 'not a url{Enter}');
    expect(screen.getByText('That is not a web address')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says what the difference between the two is', () => {
    setup();
    expect(screen.getByText(/Kept for good/)).toBeInTheDocument();
    expect(screen.getByText(/disappears if the page hosting it takes it down/)).toBeInTheDocument();
  });
});
