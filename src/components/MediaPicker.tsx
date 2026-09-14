'use client';

import { useEffect, useRef, useState } from 'react';
import { Popover } from './Popover';
import { TagField } from './TagField';

export function MediaPicker({
  onClose,
  onFiles,
  onLink,
  choices = [],
}: {
  onClose: () => void;
  onFiles: (files: FileList, tags: string[]) => void;
  onLink: (url: string, tags: string[]) => boolean;
  /** tags already in the journal, to be offered rather than retyped */
  choices?: string[];
}) {
  const [link, setLink] = useState('');
  /* Named before anything is chosen, because choosing files is the last thing
     you do here — the file dialog closes the popup behind it. Twenty holiday
     photos should not need twenty trips through the details panel. */
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLInputElement>(null);

  // paste is the usual way a link arrives, so the box is ready for it
  useEffect(() => field.current?.focus(), []);

  const submit = () => {
    if (onLink(link, tags)) onClose();
    else setError('That is not a web address');
  };

  return (
    <Popover title="Add media" onClose={onClose}>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
          Tags for what you add
        </span>
        <TagField tags={tags} choices={choices} onChange={setTags} listId="media-tag-choices" />
      </div>

      <button className="btn" onClick={() => picker.current?.click()}>
        Choose from this computer
      </button>
      <input
        ref={picker}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) {
            onFiles(e.target.files, tags);
            onClose();
          }
        }}
      />
      <p className="text-[11.5px] leading-relaxed text-ink-3">
        Kept for good, and resized first if it is too big to send.
      </p>

      <div className="flex gap-1.5">
        <input
          ref={field}
          className="field"
          placeholder="https://…/photo.jpg"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button className="btn" onClick={submit}>
          Add
        </button>
      </div>

      {error ? <p className="text-[12px] text-[#e2725b]">{error}</p> : null}

      <p className="text-[11.5px] leading-relaxed text-ink-3">
        A linked picture is not stored here, so it shows up on your other devices straight away —
        but it disappears if the page hosting it takes it down.
      </p>
    </Popover>
  );
}
