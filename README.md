# Neku

One tool, two surfaces, for a commission artist's pipeline:
**draw on the tablet → animate in ezgif → deliver a Drive link to the client**, with no
manual renaming, no Drive web UI, no Discord self-DMs.

Built by Justin, used by the artist. Justin does the one-time Google/hosting setup
([SETUP.md](SETUP.md)) and hands over a link + an exe; the artist follows
[HANDOFF.md](HANDOFF.md) (two 2-minute installs, zero configuration) and signs in with
his own Google account, so everything lands in **his** Drive.

| Surface | What it does | Stack |
|---|---|---|
| [`tablet/`](tablet) | One-screen PWA: pick (or share-target) the sprite, preview, **Send**, and it lands in a Drive staging folder | Plain HTML/CSS/JS, Google Identity Services |
| [`laptop/`](laptop) | Electron workbench: pick the **batch** you're working in, staging sprite appears on the **light table**; type the client name, drop the gif on the **packing slip**, **Deliver**, and renamed files land in `Commissions/{Batch}/{Client}`, shared, link copied | Electron + React (electron-vite), `googleapis` |

There is **no backend**. Both apps hold their own OAuth token and talk to the Drive API
directly; Drive itself is the sync layer. Nothing to host, monitor, or pay for
(the PWA sits on any free static host).

## The fixed rules

- Sprite is renamed to **`{ClientName}_sprite.png`**.
- Gif is always uploaded as the literal **`bouncy.gif`**. Per-client folders provide
  uniqueness, not filenames.
- He works in **batches**, so files land in **`Commissions/{Batch}/{ClientName}/`**, created
  on demand. Batches are numbered `Batch 5`, `Batch 6`, … — the first one Neku ever creates
  is **Batch 5**, continuing the four the artist had already done by hand (Neku can't see
  those: `drive.file` only shows folders it created itself). After that the number counts up
  from the highest that exists, and deleting one never recycles its number.
- Only the **client** folder is shared (*anyone with the link can view*), never the batch
  folder: one client's link must not expose the rest of the batch. The link you copy is
  that client folder's link, covering both files.
- No repeat clients, so no versioning. The typo warning checks **every** batch, not just the
  open one; on a collision the app warns and adds files into the existing folder rather
  than guessing.
- The sprite is *moved* out of staging in the same Drive call that renames it, so it can't
  be grabbed twice, and there's no copy-then-delete window to lose it in.

## Daily flow

1. Draw. On the tablet: open Neku → pick/share the PNG → preview → **Send to laptop**.
2. On the laptop, open the batch: carry on with one you already started, or **Start Batch N**.
   The choice is remembered, so reopening Neku mid-batch drops you straight back in, and
   **Next commission** keeps you in the same batch. The header chip switches batches.
3. The sprite shows up on the light table within ~15 s (or on window focus).
4. Animate in ezgif as usual; the gif lands in Downloads.
5. Type the client's name. The app shows exactly what will be created
   (`Aiko_sprite.png + bouncy.gif → Commissions/Batch 5/Aiko`) and warns if that client
   already exists in any batch.
6. Drag the gif anywhere onto the window.
7. **Deliver to Drive** → watch the five steps stamp themselves → **Copy link** → paste
   into the Twitter DM. **Next commission →** resets for the following one, same batch.

Everything is previewed before anything uploads; nothing fires until the Deliver click.
Every finished delivery is saved to a local history (the **history** button in the top
bar): client, date, files, and the Drive link, ready to copy again.

## Setup & distribution

- **[SETUP.md](SETUP.md)** covers Justin's one-time job: one Cloud project (`drive.file` scope,
  consent screen published to production), a Desktop OAuth client for the laptop and a Web
  one for the tablet, credentials baked into both apps, PWA dropped on a static host,
  exe built.
- **[HANDOFF.md](HANDOFF.md)** covers the artist's side: install from the link, run the exe,
  click Connect, click through the one-time "unverified app" warning. No Google Cloud, no
  configs, no terminal.

Credential resolution in the laptop app: in-app settings → `neku.config.json` next to the
exe → values baked at build time from `oauth.config.json`. The tablet reads
`tablet/config.js`. The in-app setup screens only appear when none of those exist.

## Commands (laptop/)

```
npm run dev     # run the app
npm run mock    # run against a fake Drive (no credentials, nothing uploaded)
npm run shots   # mock run that self-drives the UI and saves screenshots to shots/
npm test        # naming-convention unit tests
npm run dist    # build release/Neku-portable.exe (unsigned; SmartScreen will warn once)
```

## Edge cases, handled

- **Two sprites in staging** → both listed with name + age; nothing auto-picked; banner
  asks which one this commission is.
- **Leftover sprite from a failed run** → same list shows its age ("2 h ago"), so it's
  identifiable; it's never processed without being the explicit selection.
- **Upload dies midway** → error card with a **Retry** that is safe: finished steps
  (folder created, sprite moved, gif uploaded) are detected and not repeated; the typed
  name and gif stay put.
- **Auth expired/revoked** → clear "reconnect" prompt instead of silent failure.
- **No internet** → friendly error, state preserved, retry when it's back.
- **Tablet without the tablet** → "use a local .png instead" on the light table covers
  the day the tablet flow is broken.

## Known limitations (v1, by design)

- Fuzzy matching for client-name typos: not attempted. The folder-exists warning is the
  only guard.
- The apps only see Drive files/folders **they created** (`drive.file` scope, on purpose:
  it keeps the "unverified app" friction near zero). Pre-existing folders from the manual
  era are invisible to them.
- Tablet sign-in tokens last ~1 h; the app silently re-acquires one when needed, which can
  briefly flash a Google popup. Normal.
- Sending the Twitter DM stays manual, on purpose (X API paywall).

## Repo map

```
tablet/            the PWA (static files; fill config.js, host as-is)
laptop/            the Electron app
  src/main/        window, OAuth (loopback+PKCE), Drive ops, mock drive, naming rule
  src/preload/     IPC bridge
  src/renderer/    React UI: light table + packing slip
  tests/           naming tests
  oauth.config.example.json   template for baking credentials into the exe
tools/             tablet preview server + Chromium verification harness
SETUP.md           Justin's one-time setup & distribution walkthrough
HANDOFF.md         the artist's quick start (send this along with the apps)
```
