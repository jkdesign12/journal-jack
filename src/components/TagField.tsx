'use client';

import { useState } from 'react';
import { cleanTags } from '@/lib/journal/tags';

/**
 * Naming the tags on something: a chip for each, and one box that takes
 * several at a time.
 *
 * Shared by the details panel and the Add media popup so that tagging is the
 * same act wherever you do it — the same cleaning, the same suggestions, the
 * same comma that means "and".
 */
export function TagField({
  tags,
  choices,
  onChange,
  listId = 'tag-choices',
}: {
  tags: string[];
  choices: string[];
  onChange: (next: string[]) => void;
  listId?: string;
}) {
  const [draft, setDraft] = useState('');

  /* The chips are held here as well as passed in, because two tags can be
     named faster than the owner of the list re-renders — type "photo,holiday"
     and the second commit would otherwise be built on a list that still had no
     photo in it, and would drop it. Whatever is passed in still wins the moment
     it changes, which is how switching to another tile brings its own tags. */
  const [list, setList] = useState(tags);
  /* Taken during the render rather than in an effect: the contents are the
     identity here, since the array itself is rebuilt on every render of the
     owner, and an effect would draw the wrong chips once before correcting. */
  const [given, setGiven] = useState(() => tags.join(String.fromCharCode(0)));
  const incoming = tags.join(String.fromCharCode(0));
  if (incoming !== given) {
    setGiven(incoming);
    setList(tags);
  }

  const commit = (next: string[]) => {
    emit(next);
    setDraft('');
  };

  const emit = (next: string[]) => {
    const clean = cleanTags(next, choices);
    setList(clean);
    onChange(clean);
  };

  const addTyped = () => {
    const typed = draft.trim();
    if (!typed) return;
    // one box, several tags: "movie, rewatch" adds both
    commit([...list, ...typed.split(',')]);
  };

  /* A comma finishes a tag on the spot. Enter does too, but only once the
     suggestion list is out of the way — Chrome gives Enter to that list while
     it is open — and a comma is what people type between tags anyway. */
  const onType = (value: string) => {
    if (!value.includes(',')) return setDraft(value);
    const parts = value.split(',');
    const rest = parts.pop() ?? '';
    emit([...list, ...parts]);
    setDraft(rest);
  };

  return (
    <div className="flex flex-col gap-2">
      {list.length ? (
        <div className="flex flex-wrap gap-1.5">
          {list.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg-2 py-1 pl-3 pr-1.5 text-[11.5px] text-ink-2"
            >
              {t}
              <button
                className="flex h-[15px] w-[15px] items-center justify-center rounded-full text-[9px] text-ink-3 hover:bg-[#e2725b] hover:text-white"
                title={`Remove ${t}`}
                onClick={() => commit(list.filter((x) => x !== t))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <input
        className="field"
        list={listId}
        spellCheck={false}
        placeholder={list.length ? 'Add another…' : 'Movie, Book, Game…'}
        value={draft}
        onChange={(e) => onType(e.target.value)}
        onBlur={addTyped}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addTyped();
          }
          // backspace in an empty box takes the last chip off
          if (e.key === 'Backspace' && !draft && list.length) {
            e.preventDefault();
            commit(list.slice(0, -1));
          }
        }}
      />
      <datalist id={listId}>
        {choices.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}
