/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MediaPicker } from './MediaPicker';

/* Covers FEATURES 10.1 and 10.7: the two ways a picture gets in. */

function setup(linkOk = true, choices: string[] = ['Movie', 'Photo']) {
  const onClose = vi.fn();
  const onFiles = vi.fn();
  const onLink = vi.fn(() => linkOk);
  render(
    <MediaPicker onClose={onClose} onFiles={onFiles} onLink={onLink} choices={choices} />,
  );
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
    expect(onLink).toHaveBeenCalledWith('https://a.test/b.jpg', []);
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

/* Twenty holiday photos should not need twenty trips through the details
   panel: name the tags first and the whole batch arrives wearing them. */
describe('tagging a batch before it is uploaded', () => {
  const tagBox = () => screen.getByPlaceholderText('Movie, Book, Game…');

  it('offers somewhere to name the tags first', () => {
    setup();
    expect(screen.getByText('Tags for what you add')).toBeInTheDocument();
    expect(tagBox()).toBeInTheDocument();
  });

  it('shows what you have tagged before, so it need not be retyped', () => {
    setup(true, ['Movie', 'Photo']);
    const options = [...document.querySelectorAll('datalist option')].map((o) =>
      o.getAttribute('value'),
    );
    expect(options).toEqual(['Movie', 'Photo']);
  });

  it('keeps each tag you name as a chip', async () => {
    const { user } = setup();
    await user.type(tagBox(), 'Photo{Enter}Holiday{Enter}');
    expect(screen.getByText('Photo')).toBeInTheDocument();
    expect(screen.getByText('Holiday')).toBeInTheDocument();
  });

  it('hands them to the files you then choose', async () => {
    const { user, onFiles } = setup();
    await user.type(tagBox(), 'Photo{Enter}');

    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(onFiles).toHaveBeenCalledOnce();
    expect(onFiles.mock.calls[0][1]).toEqual(['Photo']);
  });

  it('hands them to a link as well', async () => {
    const { user, onLink } = setup();
    await user.type(tagBox(), 'Photo{Enter}');
    await user.type(screen.getByPlaceholderText('https://…/photo.jpg'), 'https://a.test/b.jpg{Enter}');
    expect(onLink).toHaveBeenCalledWith('https://a.test/b.jpg', ['Photo']);
  });

  /* Chrome hands Enter to the suggestion list rather than to the page while
     that list is open, so a comma is the reliable way to finish one tag and
     start the next — and it is what people type anyway. */
  it('finishes a tag on a comma, without waiting for Enter', async () => {
    const { user } = setup();
    const box = tagBox(); // the placeholder changes once there is a chip
    await user.type(box, 'Photo,');
    expect(screen.getByTitle('Remove Photo')).toBeInTheDocument();
    expect(box).toHaveValue('');
  });

  it('keeps what you are still typing after the comma', async () => {
    const { user } = setup();
    const box = tagBox();
    await user.type(box, 'Photo,Holi');
    expect(screen.getByTitle('Remove Photo')).toBeInTheDocument();
    expect(box).toHaveValue('Holi');
  });

  it('takes a tag back off', async () => {
    const { user, onLink } = setup();
    await user.type(tagBox(), 'Photo{Enter}');
    await user.click(screen.getByTitle('Remove Photo'));
    await user.type(screen.getByPlaceholderText('https://…/photo.jpg'), 'https://a.test/b.jpg{Enter}');
    expect(onLink).toHaveBeenCalledWith('https://a.test/b.jpg', []);
  });
});
