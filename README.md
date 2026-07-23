# Sendoff

A delivery tool for freelancers, split across two screens. Send a file from your phone,
pair it with another one on the desktop, and both get renamed and filed into a folder for
that client, shared back as a single link.

![The workbench: staged artwork on the left, packing slip on the right](docs/screenshots/workbench.png)

I built Sendoff for a friend who takes art commissions, so his workflow is the built-in
default. The `Batch 5` folders you'll see in the screenshots come from his setup.

## Try it in one minute

No account, no credentials, nothing to set up:

```bash
cd laptop
npm install
npm run mock      # the whole app against a fake Drive
```

`npm run shots` runs the same thing but clicks through the UI by itself and screenshots
each step. To use it for real against a folder on your machine, run `npm run dev` and pick
"A folder on this computer" on the first screen.

## What it replaces

A commission artist draws on a tablet, animates in a browser tool, and sends the result to
a client. By hand, that means AirDropping the drawing to the laptop, digging it out of
Downloads, renaming it to the client's name, opening Drive in a browser, making a folder,
dragging two files in, turning on sharing, copying the link, and pasting it into a DM. A
handful of times a week, and any step can go wrong somewhere the client will see.

Sendoff does that whole run, from the two files to the finished link.

## The flow

1. Send from the tablet. The PWA is one screen: pick the file, check the preview, hit Send.
   It goes into a Drive staging folder.
2. It shows up on the light table. The desktop app is already polling staging. If you're in
   another window when it lands, a small card sits on top of that window to tell you, with a
   preview so a wrong export gets caught before it goes anywhere.
3. Type the client's name. You see the exact folder and filenames about to be created, and a
   warning if that client already has a folder.
4. Add the second file. Drop it on the window, or let Sendoff grab it: it watches Downloads
   and offers the file the moment it finishes downloading.
5. Deliver. Folders get made, files get renamed and uploaded, the client folder gets shared,
   and the link is on your clipboard.

![The packing slip, previewing both files and the exact destination](docs/screenshots/packing-slip.png)
![The sealed delivery, with the link ready to copy](docs/screenshots/sealed.png)

## Why a few things work the way they do

### There's no server

The two halves never talk to each other. Each one holds its own OAuth token and talks to
Drive, and Drive is the only thing they can both see. The receipt rides on the file itself:
when the desktop picks up a staged file it writes a small property onto it, and the tablet
reads that property back to show "the laptop has it." Nothing in the middle to run or pay
for.

### Sharing is on the client folder, not the project above it

If Sendoff shared the project folder, one client's link would show them everyone else in
that batch. So it shares one level down, on the client's own folder. Revisions live in a
subfolder of that folder for the same reason.

### A repeat client is a revision

When you type a name that already has a folder, Sendoff can't tell whether you mistyped an
existing client or you're sending that client a new version. So it doesn't decide for you.
It shows what it found and lets you choose: add the files to the folder, or make a revision.
A revision is a subfolder (`v2`, `v3`), so it can't overwrite the first delivery, and the
link you already sent still works with the new files inside it.

The revision number gets settled before the upload starts rather than during it. That way,
retrying a half-finished upload reuses the same number instead of stacking a `v3` next to
the `v2` it already made.

### You see everything before it uploads

The destination and both filenames are on screen before the Deliver button does anything,
and each file shows as an image where it can.

### The arrival card is a real window

When a file lands you're usually looking at something else, so the notice has to sit on top
of whatever that is. It's a small always-on-top window that appears without taking focus.
One wrinkle: the card for a file off the tablet is hidden while Sendoff is the focused
window, since the file is already on the light table in front of you. The card for a
finished download is never hidden, because a download shows up nowhere in Sendoff by itself.

### Nothing gets hard-deleted

The X on the light table sends the file to Drive's trash (or a `.sendoff-trash` folder in
local mode) and asks first. The right file is usually one click from the wrong one, so a
misclick should cost a trip to the trash, not the artwork.

### A failed upload is safe to retry

If an upload dies partway, retrying picks up where it left off. A folder that already exists
is reused, a file that already moved is left alone, and your typed name and attached file
stay put.

### Names come from templates

No folder or file name is hardcoded. Five settings drive all of them, using tokens like
`{client}`, `{project}`, `{n}`, `{date}`, `{name}`, and `{ext}`. The presets are filled-in
sets of those, so adding a trade is editing text instead of code. A token you misspell shows
up in the preview as a literal `{cleint}`, so you catch it before it ships.

![The naming settings, with a live preview of what the templates produce](docs/screenshots/naming-settings.png)

The same code under a photographer's naming:

![The same flow under the photo preset](docs/screenshots/photo-preset.png)

## Architecture

```
tablet/     a static PWA, no build step. Deployed by copying to any static host.
            (a submodule: github.com/Just1nboy/neku-tablet)
laptop/     Electron + React via electron-vite
  src/main/
    naming.mjs          every name in the app, as templates + presets
    drive.js            Google Drive backend
    storage-local.js    plain-folder backend (no account needed)
    drive-mock.js       in-memory backend for mock runs
    gif-watch.js        Downloads watcher, waits for files to stop growing
    notice.js           the always-on-top arrival card
    autopilot.js        drives the whole UI and screenshots it
  src/renderer/src/     the workbench UI
```

The three storage backends export the same functions, so `ops()` picks one and nothing above
it has to care which. Adding a backend doesn't touch the UI.

```bash
npm run dev            # the real app
npm run mock           # fake Drive, no credentials
npm test               # naming engine + local-folder backend
npm run shots          # self-driving run, screenshots to shots/
npm run shots:photo    # the same run under a different trade's naming
npm run shots:wizard   # first-run wizard, into a real local delivery
npm run dist           # portable .exe
```

## Tests

Testing an Electron app that talks to Google Drive without a lot of hand-waving means
splitting the work up:

- `npm test` runs the naming engine and the local-folder backend. `storage-local.js` has no
  Electron in it, so the tests run it against a real temp folder and check the files that
  land on disk, including that a revision leaves `v1` alone and that a retry doesn't throw.
- `npm run shots` runs against the mock backend and clicks through the whole app itself,
  checking the DOM at each step and dumping a transcript when something's off. It's how the
  UI-only pieces get covered: the arrival card, the discard prompt, the typo warning,
  switching projects.
- `npm run shots:photo` is the same run under a different trade's naming, so anything
  accidentally tied to one set of names would break here.
- `npm run shots:wizard` stubs the folder picker, walks the first-run wizard, and checks
  that a project folder actually shows up on disk.

Every screenshot in this README comes out of those runs.

## Setup

Local-folder mode needs nothing. Run it and pick a folder.

![The first screen](docs/screenshots/first-run.png)

Google Drive mode needs a one-time Google Cloud setup, written up in [SETUP.md](SETUP.md):
one Cloud project, a Desktop OAuth client for the laptop and a Web one for the tablet.
[HANDOFF.md](HANDOFF.md) is the short version for whoever you hand a finished build to: two
installs, no terminal.

The scope is `drive.file`, so Sendoff only ever sees files it created itself. That keeps the
"unverified app" warning small and means installing it doesn't hand over the rest of your
Drive.

## Known limits

- Local-folder mode can't share, since a folder on your computer has no link. Put it inside a
  synced folder and whatever syncs it handles the sharing.
- The tablet handshake only works on Drive, for the same reason.
- `drive.file` scope hides any folder you made by hand before Sendoff.
- Tablet sign-ins last about an hour and refresh on their own, which can flash a Google popup
  for a moment.
- You still send the client the link yourself.
