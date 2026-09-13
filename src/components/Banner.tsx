'use client';

/**
 * A browser that will not keep anything has to say so, once, at the top.
 *
 * Opening the file directly is the usual cause and the fix is a sentence long,
 * so it is worth naming rather than leaving someone to work out why their
 * photos vanish on reload.
 */
export function Banner({ degraded, protocol }: { degraded: boolean; protocol?: string }) {
  if (!degraded) return null;

  const onFile = (protocol ?? (typeof location !== 'undefined' ? location.protocol : '')) === 'file:';

  return (
    <div className="bg-[#7a2f2f] px-4 py-2 text-center text-[12.5px] text-white">
      {onFile
        ? 'Running from file:// — the browser blocks IndexedDB here, so uploads live only until you reload. Run npm run dev and open localhost to save properly.'
        : 'Storage is restricted in this browser, so uploaded files will not persist between reloads. The journal itself is still kept.'}
    </div>
  );
}
