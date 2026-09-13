# Everything journal.jack does

An inventory of the original app — the zero-dependency version on `main`,
before the port — read out of the source: `index.html`, `styles.css`,
`app.js`, `db.js`, `account.js`, `connectors.js`, `router.js`,
`services.js`, the three store files and `server.js`.

It is the checklist the port is finished against, and the plan the tests were
written from. Each item is numbered so a test can name what it covers.

- **done** — ported, and covered by a test
- **manual** — ported, checked by hand in a browser, not by a test
- **todo** — not ported

---

## 1. The document

Any change here breaks journals that already exist, in browsers and in the `journals` table.

| # | Feature | Status |
|---|---|---|
| 1.1 | Months keyed `YYYY-MM`, each holding blocks | done |
| 1.2 | A block is a photo, an imported thing, or one of seven widgets | done |
| 1.3 | Blocks carry title, subtitle, note, date, day, rating, source, url, tags, size, position, artwork, mime, ratio | done |
| 1.4 | A month holds one song, and its own drop-shadow settings | done |
| 1.5 | The journal holds per-year colours, shadow settings, saved swatches, hidden presets, sync settings | done |
| 1.6 | Legacy fields still load: single `tag`, per-month `bg`/`ink`, `wide`/`tall` sizes | done |
| 1.7 | `v: 1` and a `sync` block exist on a brand new journal | done |

## 2. Storage

| # | Feature | Status |
|---|---|---|
| 2.1 | IndexedDB named `journal-io`, holding the document and every file | done |
| 2.2 | localStorage for the document and memory for files when IndexedDB is blocked | done |
| 2.3 | A banner explains a restricted browser, and names `file://` as the usual cause | done |
| 2.4 | Saving is debounced, then merged against what is already on disk | done |
| 2.5 | Other tabs are told over a BroadcastChannel, and merge rather than overwrite | done |

## 3. Merging

| # | Feature | Status |
|---|---|---|
| 3.1 | Months merge one at a time; blocks union by id | done |
| 3.2 | Deletions leave tombstones, kept 120 days | done |
| 3.3 | A deliberate erase beats anything older than it | done |
| 3.4 | Colour choices carry their own timestamps, compared per year | done |
| 3.5 | Shadow and palette settings move as stamped groups | done |
| 3.6 | A month is stamped only when its contents actually change | done |
| 3.7 | A month's own shadow counts as a change worth stamping | done |
| 3.8 | A stale push gets 409 and the newer document, then merges and pushes back | done |
| 3.9 | Per-tab view state never travels: month, view, sort, theme, autoplay, all, filter | done |

## 4. Accounts

| # | Feature | Status |
|---|---|---|
| 4.1 | Sign up, sign in, sign out | manual |
| 4.2 | scrypt hashing, per-user salt, timing-safe compare | done |
| 4.3 | A wrong address takes as long as a wrong password | done |
| 4.4 | 30-day sessions in an HttpOnly SameSite=Lax cookie | done |
| 4.5 | Signup open until the first account, then `SIGNUP_CODE` | done |
| 4.6 | Auth routes rate limited per address | done |
| 4.7 | Signing in merges the account copy in, then pushes the union back | manual |
| 4.8 | Everything works signed out | manual |
| 4.9 | The account panel shows an avatar of your first initial | manual |
| 4.10 | Signing out says the device keeps its own copy | done |

## 5. Files

| # | Feature | Status |
|---|---|---|
| 5.1 | Anything held here the account lacks is uploaded | manual |
| 5.2 | Files over 4.2 MB are re-encoded before upload | done |
| 5.3 | Still-too-big files go straight to storage instead of through the site | done |
| 5.4 | Files nobody has are reported as stranded | manual |
| 5.5 | A missing file's tile says which of the two reasons it is: signed out, or never uploaded from the device that has it | done |

## 6. The board

| # | Feature | Status |
|---|---|---|
| 6.1 | Tiles placed in whole grid units on an infinite artboard | done |
| 6.2 | A phone pins to 8 units so two covers fit a row | done |
| 6.3 | Tile height comes from the artwork's own proportions | done |
| 6.4 | Small / Medium / Large widths of 4 / 8 / 12 units | done |
| 6.5 | A ratio is guessed before the image loads: 3:2 for Letterboxd, square for albums, per-kind for widgets | done |
| 6.6 | The loaded image's real proportions are measured, stored, and used next time | done |
| 6.7 | Drag a tile to place it; what it lands on is pushed down | done |
| 6.8 | Drag a corner to resize; north and west keep the opposite edge still | done |
| 6.9 | Overlaps settle for display only, so sizing back restores every neighbour | done |
| 6.10 | Sorted views pack tight and ignore stored positions | done |
| 6.11 | "Reset layout" repacks the month; sizes set by hand are kept | done |
| 6.12 | Placing and resizing are mouse-only; a finger drag scrolls | done |
| 6.13 | Grid guides appear while a tile is being carried | manual |
| 6.14 | A dashed ghost shows where the tile will land | manual |
| 6.15 | Every other tile dims while one is being carried | manual |
| 6.16 | The carried tile follows the pointer, not the grid | manual |
| 6.17 | Corner grips are invisible; the cursor is the affordance | done |
| 6.18 | Room is kept below the lowest tile to drop into | done |
| 6.19 | The board repacks when the window is resized | done |

## 7. Tiles

| # | Feature | Status |
|---|---|---|
| 7.1 | A photo, a video, imported artwork, or a typeset card | done |
| 7.2 | Video plays on hover and stops when you leave | manual |
| 7.3 | Artwork-less imports get a card: serif title, subtitle, rating, on a colour from the title | done |
| 7.4 | A poster URL that fails to load falls back to that card | done |
| 7.5 | Images are requested with no referrer, so CDNs do not refuse the hotlink | done |
| 7.6 | The card's own text fades out as the hover caption fades in | manual |
| 7.7 | Tag or source label, top left | done |
| 7.8 | Day chip in the accent colour, bottom left | done |
| 7.9 | Rating in gold, bottom right, with a half star | done |
| 7.10 | Caption: title, subtitle, and up to four lines of your note | done |
| 7.11 | All of that stays hidden until hover, or a press on a touch screen | done |
| 7.12 | Clicking a tile selects it; the selection outline stays | done |
| 7.13 | Tools (resize, details, remove) on hover or while selected | done |
| 7.14 | Double-click opens the details | done |
| 7.15 | Typing inside a widget must not start a drag | done |

## 8. Widgets

| # | Feature | Status |
|---|---|---|
| 8.1 | Sticky note, tinted with the accent colour | manual |
| 8.2 | Big text, set in the serif | manual |
| 8.3 | Quote, centred, serif, italic | manual |
| 8.4 | Checklist: tick, type, Enter adds a line, Backspace removes an empty one | done |
| 8.5 | Checklist has an "add a line" button as well | done |
| 8.6 | Colour palette, as a grid of swatches | done |
| 8.7 | Month stats: total, films, records, photos, in serif numerals | done |
| 8.8 | Link card, with the address as a link | done |

## 9. Calendar

| # | Feature | Status |
|---|---|---|
| 9.1 | Day squares filled with the text colour, numbered in the background colour | done |
| 9.2 | Weekday headings, hidden on a phone | done |
| 9.3 | Days before the first are drawn dashed and faint, not blank | done |
| 9.4 | Today is outlined in the accent colour | done |
| 9.5 | Up to six thumbnails a day, then a count of the rest | done |
| 9.6 | Sticky notes show their text on the day | done |
| 9.7 | A day lights up while something is dragged over it | done |
| 9.8 | Undated things sit in a tray below | done |
| 9.9 | Drag a thumbnail onto a day to date it | done |
| 9.10 | Drop files onto a day to add them to it | done |
| 9.11 | Double-click a day to add photos straight to it | done |
| 9.12 | A thumbnail with no artwork shows its first letter | done |
| 9.13 | Two columns on a phone, seven on a desktop | done |

## 10. Months and navigation

| # | Feature | Status |
|---|---|---|
| 10.1 | Month name in serif, year in heavy letterspaced caps | done |
| 10.2 | Arrows step a month, wrapping years | done |
| 10.3 | Clicking the month opens a year grid; months holding anything are dotted | done |
| 10.4 | The picker pages years | done |
| 10.5 | "All" shows every month at once, with a count | done |
| 10.6 | In All the header reads "Everything" and the span of years | done |
| 10.7 | The span counts months that hold things, not only dated blocks | done |
| 10.8 | In All: always sorted, placement refused with an explanation | done |
| 10.9 | In All: editing reaches the month that actually holds the tile | done |
| 10.10 | Arrows and the calendar leave All | done |
| 10.11 | Keys: arrows for months, g for grid, c for calendar, space plays, Escape closes | done |

## 11. Tags

| # | Feature | Status |
|---|---|---|
| 11.1 | Several tags per tile, as removable chips | done |
| 11.2 | Autocomplete from every tag in the journal, most used first | done |
| 11.3 | Commas add several at once; backspace removes the last | done |
| 11.4 | Retyping in another case folds onto the spelling in use | done |
| 11.5 | Imports are tagged from their source | done |
| 11.6 | AniList reads its own format: TV to Anime, MANGA to Manga, MOVIE to Movie | done |
| 11.7 | A tag cleared on purpose stays cleared | done |
| 11.8 | The corner label shows tags, falling back to the source | done |
| 11.9 | Filter: one switch per tag, plus Untagged, with counts | done |
| 11.10 | A tile needs all of its tags on to show | done |
| 11.11 | All / None; the button says how many are off | done |
| 11.12 | Filtering applies to board, calendar and All alike | done |
| 11.13 | Filtering everything out says so, with a way back | done |

## 12. Sorting

| # | Feature | Status |
|---|---|---|
| 12.1 | Custom order, oldest, newest, highest rated, title, by tag | done |
| 12.2 | "By tag" groups; multi-tag tiles sit beside their first tag | done |
| 12.3 | Untagged sink below everything tagged | done |
| 12.4 | Undated sort last when reading oldest first | done |
| 12.5 | "Reset layout" only appears in custom order | done |

## 13. Photos and media

| # | Feature | Status |
|---|---|---|
| 13.1 | A media button offering a file from this computer or a link | done |
| 13.2 | Drop files anywhere on the page | manual |
| 13.3 | An overlay says "drop to add" while something is over the window | done |
| 13.4 | Images over 4.2 MB are re-encoded: quality first, then dimensions | manual |
| 13.5 | The encoder is detected, because a canvas asked for WebP may hand back PNG | done |
| 13.6 | HEIC decodes through an img element when createImageBitmap refuses | manual |
| 13.7 | A Live Photo becomes a still: play to force decode, skip blank frames | manual |
| 13.8 | A linked picture is not stored, and says so | done |
| 13.9 | Audio dropped on the page becomes the month's song | manual |

## 14. The details panel

| # | Feature | Status |
|---|---|---|
| 14.1 | Title, subtitle, tags, date, rating, poster URL, note, size | done |
| 14.2 | The picture at the top, contained rather than cropped | manual |
| 14.3 | A date outside the month moves the block there and says so | done |
| 14.4 | "No date" clears it | done |
| 14.5 | A poster URL can be pasted by hand | done |
| 14.6 | Delete removes the block, its file, and leaves a tombstone | done |
| 14.7 | A link back to the source | done |
| 14.8 | It appears with a small pop rather than simply existing | manual |

## 15. The song

| # | Feature | Status |
|---|---|---|
| 15.1 | One song a month, stored like a photo | done |
| 15.2 | Played from this device, or streamed from the account | done |
| 15.3 | Play and pause | done |
| 15.4 | A scrubber you can click to seek, and elapsed time | done |
| 15.5 | A volume slider | done |
| 15.6 | Autoplay toggle, remembered per tab | done |
| 15.7 | Space plays and pauses | done |
| 15.8 | Removing the song deletes the file | done |

## 16. Colours

| # | Feature | Status |
|---|---|---|
| 16.1 | Background and text belong to the year | done |
| 16.2 | Panels, lines and greys mixed between the two | done |
| 16.3 | Hex typed or pasted in any usual form | done |
| 16.4 | Eight preset swatches | done |
| 16.5 | Pairs you mix yourself are remembered, newest first, capped at 14 | manual |
| 16.6 | Any swatch can be thrown away with its remove button | manual |
| 16.7 | Drop shadow: on or off, colour, distance, blur | manual |
| 16.8 | "Use on every month" moves the shadow to the journal, seeded from what is on screen | manual |
| 16.9 | Light and dark themes | manual |

## 17. Importing

| # | Feature | Status |
|---|---|---|
| 17.1 | Letterboxd RSS, diary entries only | manual |
| 17.2 | Letterboxd export, .zip or .csv, read in the browser | done |
| 17.3 | reviews.csv folds into the matching watch | done |
| 17.4 | Musicboard: every rated album, paged, with reviews | manual |
| 17.5 | AniList: completed anime and manga | manual |
| 17.6 | Last.fm: scrobbles grouped into albums per month | manual |
| 17.7 | Any RSS feed; private and local addresses refused | manual |
| 17.8 | Rows land in the month their date belongs to | done |
| 17.9 | A re-pull enriches rather than duplicates | done |
| 17.10 | The export is the record: RSS copies go, donating posters first | done |
| 17.11 | Rewatches survive: the same film on another day is another entry | done |
| 17.12 | Configured services refresh on open, at most twice an hour | done |
| 17.13 | A date range for pulls | manual |
| 17.14 | Each service says what it can reach, with a green or amber dot | manual |
| 17.15 | Services are collapsible sections | manual |

## 18. Artwork

| # | Feature | Status |
|---|---|---|
| 18.1 | Films: TMDb with a key, then IMDb suggestions, then Wikipedia | manual |
| 18.2 | The year is identity, not a tie-breaker | manual |
| 18.3 | Albums: Deezer, iTunes, Deezer track, iTunes song, Cover Art Archive | manual |
| 18.4 | Artist is checked the way a film's year is | manual |
| 18.5 | Music never falls through to the film search | manual |
| 18.6 | Placeholder covers count as missing | manual |
| 18.7 | Answers are cached; rate limits are not | manual |
| 18.8 | A record wearing a film poster is repaired and looked up again | done |
| 18.9 | The month on screen is filled first | done |

## 19. The menu

| # | Feature | Status |
|---|---|---|
| 19.1 | Colours for this year | done |
| 19.2 | Toggle light and dark | done |
| 19.3 | Export journal as .json, files included | manual |
| 19.4 | Import a journal file, after a confirmation | manual |
| 19.5 | Sync with account | done |
| 19.6 | Upload missing files | done |
| 19.7 | Find missing posters | done |
| 19.8 | Merge duplicate imports | done |
| 19.9 | Load a sample month, clearly labelled | manual |
| 19.10 | Erase this month, after a confirmation; refused in All | done |

## 20. Chrome

| # | Feature | Status |
|---|---|---|
| 20.1 | Toasts, stacked, that fade after a few seconds | done |
| 20.2 | A scrim behind every popover; Escape and the close button both work | done |
| 20.3 | Popovers sit under the control that opened them | manual |
| 20.4 | A pulsing dot on the Sync button while it works | manual |
| 20.5 | Empty states in serif inside a dashed box | done |
| 20.6 | Phone layout: wrapped toolbar, larger date controls, 16px fields | manual |
| 20.7 | 46px tap targets on the month arrows and picker | manual |
| 20.8 | Light theme inverts the tile tools and the poster card | manual |

## 21. The server

| # | Feature | Status |
|---|---|---|
| 21.1 | Postgres and a blob store when DATABASE_URL is set | manual |
| 21.2 | SQLite and files under ./data otherwise | manual |
| 21.3 | Blobs namespaced per user; ids validated | manual |
| 21.4 | Private blob stores streamed through the server | manual |
| 21.5 | Browser-to-storage uploads for files over the host's limit | manual |
| 21.6 | A health endpoint saying what is connected and what to do | manual |
| 21.7 | Importers run server-side: no CORS wall, full histories | manual |

---

## Where this stands

**203 features, none left unported.** 146 are covered by a
test; 57 are checked by hand in a browser instead.

The split is deliberate rather than lazy. What is tested is anything with a
rule in it: what merges, what a tag means, where a tile goes, what the server
will accept. What is checked by hand is the rest — the five importers and the
poster cascades, which reach other people’s servers and whose whole value is
what they do with real, disagreeing catalogues; the image work, which needs a
real canvas and a real HEIC file; and appearance, which a test can only assert
class names about.

A test that stubs out Deezer proves the stub was called. Those cascades’ bugs
came from live catalogues, and that is where they were checked.

### Deliberate differences from the original

- **The details panel is a centred dialog** rather than a fixed side panel.
  Popovers anchor under the control that opened them on a desktop, and go to
  the middle on a phone where there is nowhere sensible to anchor.
- **The sync drawer asks the server for its list of services** instead of
  carrying a bundled copy.
- **`node:sqlite` replaces the hand-rolled local store** — same tables, same
  files under `./data`, still no dependency.
