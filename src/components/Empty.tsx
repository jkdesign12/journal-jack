'use client';

/**
 * An empty board because of the filter is not an empty journal, and saying
 * "nothing here yet" when there is plenty would just be wrong.
 */
export function Empty({
  all,
  filtered,
  onShowAll,
}: {
  all: boolean;
  filtered: boolean;
  onShowAll: () => void;
}) {
  if (filtered) {
    return (
      <div className="rounded-[14px] border border-dashed border-line px-5 py-16 text-center text-ink-3">
        <b className="mb-1.5 block font-serif text-2xl text-ink-2">Everything here is filtered out</b>
        <button className="btn ghost mt-2" onClick={onShowAll}>
          Show all tags
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-dashed border-line px-5 py-16 text-center text-ink-3">
      <b className="mb-1.5 block font-serif text-2xl text-ink-2">
        {all ? 'Nothing in the journal yet' : 'Nothing here yet'}
      </b>
      <span className="mx-auto block max-w-sm text-[12.5px]">
        Drop photos anywhere, add a widget, or pull a month from Letterboxd, AniList or Last.fm with
        Sync.
      </span>
    </div>
  );
}
