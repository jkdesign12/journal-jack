import { NextResponse } from 'next/server';
import { artwork, type ArtItem } from '@/lib/server/services/artwork';
import { artLookup, artStore } from '@/lib/server/blobs';

export const maxDuration = 300;

/* Posters and covers for things that arrived without them. The answers are
   cached in the database, so a second run over the same films is instant. */
export async function POST(req: Request) {
  const { items } = (await req.json().catch(() => ({}))) as { items?: ArtItem[] };
  if (!Array.isArray(items)) return NextResponse.json({ error: 'No items' }, { status: 400 });

  try {
    const result = await artwork(items, {
      tmdbKey: process.env.TMDB_KEY,
      lookup: artLookup,
      store: artStore,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
