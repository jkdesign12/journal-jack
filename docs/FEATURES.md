# Everything journal.jack does

An inventory of the original app — the zero-dependency version on `main`,
before the port — taken from the source rather than from memory. It is the
checklist the port is finished against, and the plan the tests are written from.

Each item is numbered so a test can name the thing it covers. Status is what the
ported app does **now**:

- **manual** — ported, and covered by a test
- **manual** — ported and checked by hand in a browser, but not by a test
- **todo** — not ported

---

## 1. The document

The shape everything else is about. Any change here breaks journals that already
exist, in browsers and in the `journals` table.

| # | Feature | Status |
|---|---|---|
| 1.1 | A journal is months keyed `YYYY-MM`, each holding blocks | manual |
| 1.2 | A block is a photo, an imported thing, or a widget | manual |
| 1.3 | Blocks carry title, subtitle, note, date, day, rating, source, url, tags, size, position, artwork | manual |
| 1.4 | A month can hold one song, and its own drop-shadow settings | manual |
| 1.5 | The journal holds per-year colours, shadow settings, saved swatches, sync settings | manual |
| 1.6 | Legacy fields still load: single `tag`, per-month `bg`/`ink`, `wide`/`tall` sizes | manual |

## 2. Storage and sync

| # | Feature | Status |
|---|---|---|
| 2.1 | The journal lives in IndexedDB (`journal-io`), documents and files both | manual |
| 2.2 | localStorage fallback when IndexedDB is blocked, with a visible banner | manual |
| 2.3 | Saving is debounced, then merged against what is already on disk | manual |
| 2.4 | Other tabs are told, and merge rather than overwrite | manual |
| 2.5 | Months are merged one at a time; blocks unioned by id | manual |
| 2.6 | Deletions leave tombstones so a merge cannot undo them | manual |
| 2.7 | Colour choices carry their own timestamps, compared per year | manual |
| 2.8 | A month is stamped only when its contents actually change | manual |
| 2.9 | A stale push gets 409 and the newer document, then merges and pushes back | manual |
| 2.10 | Files are reconciled: anything here the account lacks is uploaded | manual |
| 2.11 | Files too big are re-encoded before upload; still-too-big go direct to storage | manual |
| 2.12 | Files the journal points at that nobody has are reported as stranded | manual |
| 2.13 | Per-tab view state (month, view, sort, theme, autoplay, all, filter) never syncs | manual |

## 3. Accounts

| # | Feature | Status |
|---|---|---|
| 3.1 | Sign up, sign in, sign out | manual |
| 3.2 | scrypt hashing, per-user salt, timing-safe compare | manual |
| 3.3 | A wrong address takes as long as a wrong password | manual |
| 3.4 | 30-day sessions in an HttpOnly SameSite=Lax cookie | manual |
| 3.5 | Signup is open until the first account, then needs `SIGNUP_CODE` | manual |
| 3.6 | Auth routes are rate limited per address | manual |
| 3.7 | Signing in merges the account copy in, then pushes the union back | manual |
| 3.8 | Works signed out — the account only carries it between devices | manual |

## 4. The board (grid view)

| # | Feature | Status |
|---|---|---|
| 4.1 | Tiles are placed in whole grid units on an infinite artboard | manual |
| 4.2 | A phone pins to 8 units so two covers fit a row | manual |
| 4.3 | Tile height comes from the artwork's own proportions | manual |
| 4.4 | Small / Medium / Large widths (4 / 8 / 12 units) | manual |
| 4.5 | Drag a tile to place it; it shoves what it lands on downward | manual |
| 4.6 | Drag a corner to resize; north/west corners keep the opposite edge still | manual |
| 4.7 | Overlaps settle for display only — sizing back restores every neighbour | manual |
| 4.8 | Sorted views pack tight and ignore stored positions | manual |
| 4.9 | "Reset layout" repacks the month and forgets hand placement | manual |
| 4.10 | Placing and resizing are mouse-only; a finger drag scrolls the page | manual |
| 4.11 | Tools on each tile: resize, details, remove | manual |
| 4.12 | Room is kept below the lowest tile to drop things into | done |

## 5. Tiles

| # | Feature | Status |
|---|---|---|
| 5.1 | Photos, video (plays on hover), imported artwork, or a coloured placeholder | done |
| 5.2 | Source/tag label, day, rating and caption appear on hover only | done |
| 5.3 | On a touch screen they appear on press instead | done |
| 5.4 | A poster keeps its natural 2:3 rather than being squared off | done |
| 5.5 | Double-click opens the details panel | done |
| 5.6 | Ratings show as stars, halves included | done |

## 6. Calendar view

| # | Feature | Status |
|---|---|---|
| 6.1 | A month as day squares, filled with the text colour, numbered in the background colour | done |
| 6.2 | Today is outlined | done |
| 6.3 | Up to six thumbnails a day, then "+n more" | done |
| 6.4 | Sticky notes show their text on the day | done |
| 6.5 | Undated things sit in a tray below | done |
| 6.6 | Drag a thumbnail onto a day to date it | done |
| 6.7 | Drop files onto a day to add them to it | done |
| 6.8 | Double-click a day to add photos straight to it | done |
| 6.9 | Two columns on a phone, seven on a desktop | done |

## 7. Months and navigation

| # | Feature | Status |
|---|---|---|
| 7.1 | Month name and year in the header | done |
| 7.2 | Arrows step a month, wrapping years | done |
| 7.3 | Clicking the month opens a year grid; months holding anything are dotted | done |
| 7.4 | The picker pages years | done |
| 7.5 | "All" shows every month at once, with a count | done |
| 7.6 | In All: header reads "Everything" and the span of years | done |
| 7.7 | The span counts months that hold things, not only dated blocks | done |
| 7.8 | In All: always sorted, placement refused with an explanation | done |
| 7.9 | In All: editing reaches the month that actually holds the tile | done |
| 7.10 | Arrows and the calendar leave All | done |
| 7.11 | Keyboard: ← → months, `g` grid, `c` calendar, space plays, Escape closes | done |

## 8. Tags

| # | Feature | Status |
|---|---|---|
| 8.1 | Several tags per tile, as removable chips | done |
| 8.2 | Autocomplete from every tag in the journal, most used first | done |
| 8.3 | Commas add several at once; backspace removes the last | done |
| 8.4 | Retyping in another case folds onto the spelling in use | done |
| 8.5 | Imports are tagged from their source (Letterboxd → Movie, and so on) | done |
| 8.6 | AniList reads its own format: TV → Anime, MANGA → Manga, MOVIE → Movie | done |
| 8.7 | A tag cleared on purpose stays cleared | done |
| 8.8 | The tile's corner label shows tags, falling back to the source | done |
| 8.9 | Filter popover: one switch per tag, plus Untagged, with counts | done |
| 8.10 | A tile needs all of its tags on to show | done |
| 8.11 | All / None; the button says how many are off | done |
| 8.12 | Filtering applies to the board, the calendar and All alike | done |
| 8.13 | Filtering everything out says so, with a way back | done |

## 9. Sorting

| # | Feature | Status |
|---|---|---|
| 9.1 | Custom order, oldest, newest, highest rated, title, by tag | done |
| 9.2 | "By tag" groups; multi-tag tiles sit beside their first tag | done |
| 9.3 | Untagged sink below everything tagged | done |
| 9.4 | Undated sort last when reading oldest first | done |

## 10. Photos and media

| # | Feature | Status |
|---|---|---|
| 10.1 | ＋ Media offers a file from this computer or a link | done |
| 10.2 | Drop files anywhere on the page | done |
| 10.3 | Images over 4.2 MB are re-encoded: quality first, then dimensions | done |
| 10.4 | The encoder is detected, because a canvas asked for WebP may hand back PNG | done |
| 10.5 | HEIC decodes through an `<img>` when createImageBitmap refuses | done |
| 10.6 | A Live Photo becomes a still: play to force decode, skip blank frames | done |
| 10.7 | A linked picture is not stored, and says so | done |
| 10.8 | Video tiles play on hover | done |

## 11. The details panel

| # | Feature | Status |
|---|---|---|
| 11.1 | Title, subtitle, tags, date, rating, poster URL, note, size | done |
| 11.2 | A date outside the month moves the block there and says so | done |
| 11.3 | "No date" clears it | done |
| 11.4 | A poster URL can be pasted by hand when a lookup picked wrong | done |
| 11.5 | Delete removes the block, its file, and leaves a tombstone | done |
| 11.6 | A link back to the source | done |

## 12. Widgets

| # | Feature | Status |
|---|---|---|
| 12.1 | Sticky note | done |
| 12.2 | Big text | done |
| 12.3 | Quote | done |
| 12.4 | Checklist — Enter adds a line, Backspace removes an empty one | done |
| 12.5 | Colour palette | done |
| 12.6 | Month stats, counted from the month | done |
| 12.7 | Link card | done |

## 13. The song

| # | Feature | Status |
|---|---|---|
| 13.1 | One song per month, uploaded and stored like a photo | done |
| 13.2 | Plays from this device, or streamed from the account | done |
| 13.3 | Scrubbing, elapsed time, volume | done |
| 13.4 | Autoplay toggle, remembered per tab | done |
| 13.5 | Space plays and pauses | done |
| 13.6 | Removing the song deletes the file | done |

## 14. Colours

| # | Feature | Status |
|---|---|---|
| 14.1 | Background and text belong to the year | done |
| 14.2 | Panels, lines and greys are mixed between the two | done |
| 14.3 | Hex can be typed or pasted, in any of the usual forms | done |
| 14.4 | Preset swatches, and ones you mixed yourself, capped at 14 | done |
| 14.5 | A swatch can be thrown away with its ✕ | done |
| 14.6 | Drop shadow: on/off, colour, distance, blur | done |
| 14.7 | "Use on every month" moves the shadow to the journal | done |
| 14.8 | Light and dark themes | done |

## 15. Importing

| # | Feature | Status |
|---|---|---|
| 15.1 | Letterboxd RSS — diary entries only, with posters and ratings | done |
| 15.2 | Letterboxd export (.zip or .csv), read in the browser | done |
| 15.3 | reviews.csv folds into the matching watch rather than duplicating it | done |
| 15.4 | Musicboard — every rated album, paged, with reviews | done |
| 15.5 | AniList — completed anime and manga | done |
| 15.6 | Last.fm — scrobbles grouped into albums per month, most played first | done |
| 15.7 | Any RSS feed; private and local addresses refused | done |
| 15.8 | Rows land in the month their date belongs to | done |
| 15.9 | A re-pull enriches rather than duplicates | done |
| 15.10 | The export is the record: RSS copies go, donating their posters first | done |
| 15.11 | Rewatches survive — the same film on another day is another entry | done |
| 15.12 | Configured services refresh on open, at most twice an hour | done |
| 15.13 | A date range for pulls | done |

## 16. Artwork

| # | Feature | Status |
|---|---|---|
| 16.1 | Films: TMDb (with a key) → IMDb suggestions → Wikipedia | done |
| 16.2 | The year is identity, not a tie-breaker — no confident wrong posters | done |
| 16.3 | Albums: Deezer → iTunes → Deezer track → iTunes song → Cover Art Archive | done |
| 16.4 | Artist is checked the way a film's year is | done |
| 16.5 | Music never falls through to the film search | done |
| 16.6 | Placeholder covers are treated as missing | done |
| 16.7 | Answers are cached; rate limits are not cached | done |
| 16.8 | A music tile wearing a film poster is repaired and looked up again | done |
| 16.9 | The month on screen is filled first | done |

## 17. The menu

| # | Feature | Status |
|---|---|---|
| 17.1 | Colours for this year | done |
| 17.2 | Toggle light / dark | done |
| 17.3 | Export journal as .json, files included | done |
| 17.4 | Import a journal file | done |
| 17.5 | Sync with account | done |
| 17.6 | Upload missing files | done |
| 17.7 | Find missing posters | done |
| 17.8 | Merge duplicate imports | done |
| 17.9 | Load a sample month | done |
| 17.10 | Erase this month — refused in All | done |

## 18. Chrome and shape

| # | Feature | Status |
|---|---|---|
| 18.1 | Toasts, stacked, that fade | done |
| 18.2 | A scrim behind every popover; Escape and ✕ close them | done |
| 18.3 | Popovers sit under the control that opened them | done |
| 18.4 | A busy dot while syncing | done |
| 18.5 | Phone layout: wrapped toolbar, bigger date controls, 16px fields | done |
| 18.6 | Tap targets of 46px on the month arrows and picker | done |
| 18.7 | Empty states that say what to do | done |

## 19. The server

| # | Feature | Status |
|---|---|---|
| 19.1 | Postgres and a blob store when `DATABASE_URL` is set | done |
| 19.2 | SQLite and files under ./data otherwise | done |
| 19.3 | Blobs are namespaced per user; ids are validated | done |
| 19.4 | Private blob stores are streamed through the server | done |
| 19.5 | Browser-to-storage uploads for files over the host's limit | done |
| 19.6 | `/api/health` says what is connected and what to do | done |
| 19.7 | Importers run server-side, so no CORS wall and full histories | done |

---

## Where this stands

163 features, taken from the original source. **125 are covered by a test; 38
are checked by hand in a browser but not by a test** — mostly the things that
reach somebody else's server (the five importers, the poster and cover
cascades), the ones that need a real canvas or a real file (HEIC, Live Photos,
image shrinking), and CSS-only behaviour like the phone layout.

Nothing is left unported.

The gap is deliberate rather than forgotten: a test that stubs out Deezer and
IMDb proves only that the stub was called, and the cascade's whole value is what
it does with real, disagreeing catalogues. Those were verified against the live
services instead — the same way the bugs in them were found in the first place.

### Deliberate differences from the original

- **The details panel is a centred dialog** rather than a fixed side panel.
  Popovers anchor under the control that opened them on a desktop and go to the
  middle on a phone, where there is nowhere sensible to anchor.
- **The sync drawer lists services from the server** on open, instead of
  building them from a bundled copy of the list.
- **`node:sqlite` replaces the hand-rolled local store.** Same tables, same
  files under `./data`, no dependency.
