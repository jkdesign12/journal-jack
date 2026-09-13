# journal.jack

A month-at-a-time visual journal. Each month is a moodboard you can also read as a
calendar, with its own song, its own accent colour, and blocks pulled in from the
media-tracking sites you already use.

## Run it

```bash
node server.js
```

Then open <http://localhost:5173>.

You *can* double-click `index.html`, but browsers block IndexedDB on `file://`
URLs — uploads would disappear on reload, and the app shows a red banner saying so.

## What's here

**Month header** — `‹ September 2026 ›`. Arrow keys work too. Click the month name
for a year/month jump grid; months holding anything are marked with a dot.

**Two views over the same content**
- **Grid** — the moodboard, and nothing but the artwork. Every tile keeps the
  an **artboard**. The board is a grid of small squares; an album cover is 4x4 of
  them, so a quarter of a cover is the smallest step, and every tile is sized from its own
  proportions in those units — a 2:3 poster is 2x3, a 16:9 photo 2x1. Drag a tile
  anywhere and it stays put; drop it on top of something and that gets pushed down
  out of the way, cascading. The lanes light up while you're carrying a tile, with a
  dashed outline on the cell it will land in, and the board always keeps empty rows
  below so you can keep going. `⤢` sets width (2, 4 or 6 units) and the height
  follows the content — and **resizing only displaces neighbours while the tile is
  big**. The coordinate you dragged a tile to is its anchor; nothing but another
  drag rewrites it, so sizing a cover up and back down leaves every neighbour
  exactly where it was.
- **Sizing by hand** — hover a tile and drag any of its four corner grips. It snaps
  to the same small squares the board is drawn on, minimum half a cover. A
  south/east grip holds the top-left still; a north/west grip moves the origin and
  holds the opposite corner. The tile you are scaling keeps its cell and everything
  else works around it. `⤢` cycles the presets again and clears a hand-made shape. Titles, source, date, rating, your review and the controls all
  appear **on hover**; `i` opens the details dialog in the middle of the screen,
  `✕` deletes. Free placement applies in **Custom order**; the other sort modes pack
  the board automatically and leave your coordinates untouched underneath.
- **Order** — the dropdown in the toolbar: custom (drag to arrange), oldest or newest
  first, highest rated, title, or grouped by source. Custom order is the stored order
  of the blocks; every other mode is a view over the same list, so switching back
  loses nothing. Dragging only rearranges while custom order is selected.
- **Calendar** — the same items placed on the days they belong to. Drag an item from
  the *Unscheduled* tray onto a day to date it, drag between days to move it,
  double-click a day to upload straight into it, or drop image files onto a day.

**Media** — drop images or short videos anywhere on the page, or use `＋ Media`.
Files are stored locally in IndexedDB; nothing is uploaded anywhere.

**Month song** — `Set song` (or drop an MP3 on the page). One song per month, with a
play/pause, scrubber and volume in the bar under the header. Space bar toggles play.

**Widgets** — `Widget` adds sticky notes, big serif text, quotes, checklists, colour
palettes, an auto-updating month-stats tile, and link cards. They live in the same
grid as photos and resize the same way, so a board can be mostly text if you want.

**Keyboard** — `←` `→` months · `g` grid · `c` calendar · `space` play/pause · `esc` close.

**Menu (⋯)** — light/dark, export the whole journal to JSON (images and audio are
embedded as base64, so the file gets large), import one back, load a clearly-labelled
sample month, erase the current month.

## Sync

`Sync` opens the importer. Set how far back to pull (`Everything`, this month, this
year, or a custom month range), fill in a username, hit pull. **Items land in the
month they actually happened in**, creating months as needed — one pull can populate
years of journal at once.

The fetching runs in the Node server, not the page. It has to: these services either
send no CORS header or reject non-browser requests outright.

| Service | History | How |
|---|---|---|
| **Musicboard** | complete | `api.musicboard.app/v2` is an open read API. Username → uid, then page the ratings. Cover art, your score out of 10 (halved to 5 stars), the date you listened. No key. |
| **AniList** | complete | Public GraphQL. Everything marked completed, with cover art and score. Anime, manga, or both. Entries with no completion date recorded are skipped — AniList only stores one if you set it. Private lists can't be read. |
| **Last.fm** | complete | Needs a free key from [last.fm/api](https://www.last.fm/api/account/create). Scrobbles are grouped into albums *per month*, most-played first, so each month reads as the records you lived on. Up to ~12k scrobbles a pull. |
| **Letterboxd** | see below | Split. |
| **Any RSS feed** | what the feed holds | Backloggd, Serializd, Goodreads shelves, YouTube, a blog. |

### Auto-refresh

The Sync drawer's top switch (on by default) refreshes every configured service for
the month you're looking at, each time the app opens — at most twice an hour, with a
pulsing dot on the Sync button while it runs. A service counts as configured once its
required fields are filled. A service being down never blocks the app from opening.
`refresh now` in the same panel ignores the throttle.

### Posters

Imports that arrive without artwork (the Letterboxd export) get posters looked up
automatically, **with no key and no setup**:

1. **IMDb's title-suggestion endpoint** — the one their own search box uses. Keyless,
   and it knows everything: festival one-offs, foreign titles, anime specials, TV.
   Measured 25/25 on a deliberately awkward list (2026 micro-releases, `The End of
   Evangelion`, `Amélie`, an apostrophe title) in 8.6 seconds. Their originals are
   enormous — 4050x6000 for one test poster — so the URL is rewritten to IMDb's own
   resize form and a 3.4 MB file becomes 82 KB.
2. **TMDb** if you paste a free key into Sync → Poster lookup. Tried first when
   present, since it matches release years more strictly. Both the v3 API key and the
   v4 read token work. Note that TMDb's images are public but its *search* is not —
   the poster path only comes from the API, which 401s without a key. That is why this
   is optional rather than the default.
3. **Wikipedia** as a last resort. Only covers titles with an article, which is why it
   used to miss most new and small releases.

Real answers are cached in SQLite (including "no poster exists"), so re-running is
instant; **rate-limited lookups are deliberately not cached**, so running it again
actually retries them. `⋯ → Find missing posters` sweeps the whole journal at any time.

This app does not scrape themoviedb.org or letterboxd.com. Letterboxd's pages are
behind a bot challenge, and TMDb offers a free API for exactly this purpose.

### Letterboxd, honestly

Letterboxd has no public API, and their profile pages sit behind a Cloudflare bot
challenge — a scraper would have to defeat that, so this app doesn't try. Two things
that do work:

1. **RSS** — open, and it carries watched date, your star rating and the poster. But
   Letterboxd caps it at roughly the **last 50 entries**, so it's for keeping current,
   not for backfilling.
2. **Their official export** — letterboxd.com/settings/data → *Export your data*. Drop
   the `.zip` (or the `diary.csv` inside it) onto the drop area in the Sync drawer, or
   anywhere on the page. That's your **entire diary**: every film, every watched date,
   every rating, placed into the right month. The export carries no artwork, so those
   entries render as typeset cards instead of posters.

### Your reviews come with them

Anything you wrote about a thing is imported into that block's note, so the writing
lives next to the artwork:

- **Letterboxd** — review text from the RSS feed, and from `reviews.csv` in the export
  (it's a separate file from `diary.csv`, so both are read and folded together).
- **Musicboard** — review text, matched to the rating it belongs to.
- **AniList** — your notes field.

Hovering a tile shows the first few lines; the inspector (`i`) shows and edits the
whole thing.

Imports de-duplicate on source + title + date, so re-pulling is safe — and a re-pull
now *fills in* anything missing on blocks you already have (a review you wrote later,
a rating, artwork) instead of skipping them. Everything imported becomes an ordinary
block — re-date it, resize it, delete it, annotate it.

Letterboxd's RSS carries your lists ("Ranked: …", watchlists) alongside diary entries —
half the feed, in testing. Only entries with a watched date are imported, so lists
never turn up as if they were films.

**Dropping an export deletes the RSS entries it replaces.** The export is your whole
diary with your real dates and reviews, so once it lands the feed copies are noise.
Each one hands its poster to its export twin first — artwork is the one thing the
export lacks — and is then removed. RSS entries dated *after* the export's last day are
kept: those are watches that happened since you generated it, and nothing else has
them. Matching ignores case, punctuation and accents, and works across months.

Re-dropping the zip also repairs a journal imported by an older version of this app,
and `⋯ → Merge duplicate imports` runs the same cleanup on demand.

## Accounts and cross-device sync

`Sign in` (top right) creates an account **on the server you are running** — this
machine. Nothing goes to me, Anthropic, or any third party. Signed out, the app
behaves exactly as before: everything stays in this browser.

Signed in:

- every save pushes the journal document to the server (debounced ~1.2s);
- photos and mp3s upload once each, and any file this device holds that the server
  lacks is uploaded on sign-in;
- another device that signs in pulls the document immediately and fetches each image
  lazily as it renders, caching it locally;
- if both the device and the account hold work, you're **asked** which wins rather
  than one silently overwriting the other;
- concurrent edits are version-checked: a push built on a stale version is refused and
  the newer document loaded, with a toast telling you it happened. Last writer wins,
  but never silently.

Passwords are scrypt-hashed with a per-user salt. Sessions are 32-byte random tokens
in an HttpOnly, SameSite=Lax cookie, valid 30 days. Everything lives in `./data`
(`journal.db` plus `blobs/<user>/`); back that folder up and you've backed up
everything.

## Putting it online

Two routes. Both give a real HTTPS URL that works on any device, any network.

### A. Cloudflare Tunnel — data stays on your machine

Nothing is uploaded to a host; the tunnel just makes your local server reachable.
Free, no card, no account needed for a quick throwaway URL.

```bash
node server.js
```

Then, in a second terminal:

```bash
npx cloudflared tunnel --url http://localhost:5173
```

It prints a `https://something-random.trycloudflare.com` URL. That's it — open it on
your phone. The catch: the URL changes each run and dies when your PC sleeps. For a
permanent one, a free Cloudflare account plus a domain gets you `journal.yourdomain`
via `cloudflared tunnel create`.

Same idea with Tailscale if you'd rather it stay private to your own devices:
`tailscale serve 5173`, reachable from anything signed into your tailnet.

### B. Vercel — free tier, serverless

Vercel has **no disk and no long-lived process**, so the SQLite file and uploaded
photos this app writes locally would vanish on every deploy and every cold start.
The code handles that: `store.js` switches backends on `DATABASE_URL`, using
Postgres and a blob store instead of the disk. `api/index.js` wraps the same
router; `public/` is served by Vercel as static files.

```bash
npm i -g vercel
vercel login
vercel                     # first deploy, from this folder
```

Then in the Vercel dashboard for the project, under **Storage**:

1. Create a **Postgres** database (Neon) — this sets `DATABASE_URL` for you.
2. Create a **Blob** store — this sets `BLOB_READ_WRITE_TOKEN`.

```bash
vercel --prod              # redeploy so it picks up both
```

Open the URL, hit **Sign in → Create account**. The first account claims the
deploy and sign-ups close behind you; set `SIGNUP_CODE` in the project's
environment variables if you want to invite anyone else. After that, signing in
from any device — phone, laptop, someone else's machine — pulls the same journal,
and every edit pushes back.

**Know these three things before choosing Vercel:**

- **Photos are on secret links, not private ones.** Vercel Blob serves files from
  an unguessable public URL with no per-request auth. The app only ever hands
  those URLs to the signed-in owner, but anyone holding one can open it. Your
  journal *text* is properly behind the account; the image files are not. If that
  matters, use option C, where files sit on a disk only the server can read.
- **Long imports can time out.** Functions are capped (this repo asks for the 60s
  maximum in `vercel.json`). Pulling one month at a time is fine; "Everything"
  over a large history may exceed it. Poster lookups are batched small and simply
  resume on the next pass.
- **Rate limiting weakens.** The per-IP login limiter is in memory, and serverless
  instances do not share memory, so it is per-instance rather than global.

### C. Fly.io — always on, real disk, data stays private

Best if your PC isn't always awake. `fly.toml` and the `Dockerfile` are ready.

```bash
npm i -g @flydotio/flyctl
fly auth signup
fly launch --no-deploy --copy-config
fly volumes create journal_data --size 3
fly deploy
```

Gives `https://<your-app>.fly.dev`, HTTPS included. The volume is what keeps your
journal across deploys — **without it, a redeploy wipes everything.** 3 GB holds a lot
of photos; grow it with `fly volumes extend`. The machine suspends when idle and wakes
on the next request, so a personal journal costs little or nothing.

Never scale this past one machine — SQLite means a single machine owns the file.

Any other Docker host (a VPS, a home server) works the same way:

```bash
docker compose up -d
```

### GitHub

Not needed for either route above — Fly deploys straight from this folder. You'd want
it for Render/Railway-style git deploys, or just to keep the code backed up. If you
want that, say the word and I'll set up the repo and a deploy workflow; I'd need you
to create the empty repo (or authorise `gh`), since I won't make accounts for you.
`data/` is already gitignored, so no journal or password hash can be committed.

### What changes once it's public

The server notices it's reachable from outside and tightens up on its own:

- **Sign-ups close after the first account.** You claim the deploy, then nobody else
  can. To invite someone, set `SIGNUP_CODE` on the server and they'll get an invite
  code field.
- **Importing requires a session.** `/api/pull` and `/api/artwork` stay open to
  `localhost` but need a sign-in from anywhere else, so a stranger who finds the URL
  can't use it as a free scraping proxy.
- **Cookies get the `Secure` flag** when the request arrives over HTTPS.
- **Login and signup are rate-limited** to 12 attempts per IP per 15 minutes.
- Password hashes are scrypt; `server.js`, `services.js`, `store.js` and `data/` are
  never served as static files.

Still worth knowing: sessions live 30 days, there's no password reset (no mail
server), and one account is one journal. Back up by copying `data/`, or via
`⋯ → Export journal`.

**Local-network only**, if that's all you need: the server already listens on every
interface, so `http://192.168.x.x:5173` (find it with `ipconfig`) works from your
phone on the same wi-fi, with no tunnel and no host.

## Where things live

```
public/index.html        markup
public/styles.css        all styling; theme tokens at the top
public/js/app.js         state, both views, widgets, player, sync drawer, import/export
public/js/db.js          IndexedDB wrapper, with a localStorage/in-memory fallback
public/js/connectors.js  browser side of syncing: calls the API, reads CSV/ZIP exports
public/js/account.js     sign-in and the cross-device sync engine

router.js         every /api/* route, shared by both ways this runs
services.js       one importer per service (add one here) + poster lookup
store.js          picks a storage backend from the environment
store.sqlite.js     ..SQLite and ./data on this machine (default)
store.pg.js         ..Postgres and a blob store (when DATABASE_URL is set)

server.js         runs it as a normal Node process, serving public/
api/index.js      runs the same router as a serverless function (Vercel)
vercel.json       routes /api/* to that function, asks for a 60s limit
package.json      the two deps the serverless backend needs
Dockerfile        image for any Docker host
fly.toml          fly.io config, incl. the volume that keeps your data
docker-compose.yml  for a box you own
data/             local only: journal.db and blobs/<user>/
```

State is a single JSON object: `months["2026-09"] = { title, note, accent, song, blocks[] }`.
A block is either media (`kind: photo | media`) or a widget (`kind: note | quote |
heading | checklist | palette | stats | link`), and every block carries an optional
`day`, which is the only thing the calendar view needs.

## Known limits of this draft

- One journal, one browser, no accounts or sync between devices. Export/import is the
  bridge for now.
- Verified end to end against live services: Musicboard (120-item history pull),
  Letterboxd RSS, the CSV/ZIP export reader, Wikipedia poster lookup, auto-refresh on
  load, and the full account round-trip (sign up → push → wipe the device → sign in →
  journal restored). Last.fm needs a key to exercise, so it is written to the API's
  real shape and error-handled but not yet run against a live account.
- AniList only serves **public** lists — a private profile returns "Private User" no
  matter what the app does. Make the list public in AniList's settings to import it.
- Auto-refresh runs on open only — nothing polls while the tab sits there.
- Letterboxd's RSS reaches back ~50 entries; backfilling older months needs the export.
- The Letterboxd export has no artwork, so those films render as typeset cards.
- Blocks reflow in a dense grid rather than being freely positioned.
- No password reset — there's no mail server. One account, one journal.
- The Docker image and fly.toml are written but not built here (no Docker on this
  machine); the server itself is tested, including every public-mode protection.
