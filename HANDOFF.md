# Neku quick start (for the artist)

Justin built you a little courier for commissions: draw on the tablet → it appears on the
laptop → it uploads the renamed files to your Google Drive and hands you the link to DM.
No more renaming, no Drive web UI, no Discord self-DMs.

You need: your own Google account (the files go to **your** Drive), the app link, and the
exe Justin sent.

---

## Tablet (2 minutes)

1. Open the link Justin sent in Chrome.
2. Tap the **Install as an app** button right on the page (if you don't see it:
   menu (⋮) → **Add to Home screen** → Install). Open it like any app.
3. That's it. After drawing: open Neku → **Choose sprite** (or share the PNG to Neku
   straight from your drawing app) → check the preview → **Send to laptop**. The screen
   then waits until the laptop actually has it and says **The laptop has it**, so you
   never have to guess whether it went through or send it twice.

The very first Send opens a Google sign-in. Pick your account; if it warns about an
"unverified app", tap **Advanced → Continue**. That's normal: this is a private app made
for you, not a store app. You'll only see that once.

## Laptop (2 minutes)

1. Put `Neku-portable.exe` anywhere (Desktop is fine) and run it.
   *(If Justin sent a `neku.config.json` with it, keep both files in the same folder.)*
2. Windows SmartScreen may complain the first time: **More info → Run anyway**
   (unsigned personal app, same reason as above).
3. Click **Connect Drive** → sign in with the same Google account → **Advanced →
   Continue** on the warning. One time only; it stays connected after that.

## Daily use

1. Neku opens by asking **which batch**. Tap the batch you're already working through, or
   hit **Start Batch N** to begin a new one. It remembers your answer, so you only pick
   once per batch, even if you close the app halfway through. The first one it offers is
   **Batch 5**, picking up after the four you already did by hand (it can only see folders
   it made itself, so your old ones stay untouched and won't show in the list).
2. Sprite you sent shows up on the **light table** (give it ~15 seconds). If you're doing
   something else on the laptop, a card slides into the bottom-right corner showing the
   drawing that just arrived, so you don't have to keep checking. Sent the wrong picture?
   Hit the small **✕** in the corner of it. It asks first, then puts that file in your
   Drive trash so the table is clear for the right one.
3. Type the client's name. Animate on ezgif like always. When the gif finishes
   downloading, a small Neku card slides into the bottom-right corner of the screen with
   the animation playing in it. Hit **Use it** and the gif is attached, no dragging, no
   hunting for the window. (Dragging it from Downloads still works if you'd rather.)
4. **Deliver to Drive** → wait for the checkmarks → **Copy link** → paste into the
   client's Twitter DM. Hit **Next commission** for the following one; it stays in the
   same batch, so you just keep going.

Neku renames everything itself (`Name_sprite.png` + `bouncy.gif`) and files it under
`Commissions/Batch 5/<Name>` in your Drive, already shared for anyone with the link.
Only the client's own folder is shared, so nobody can see the rest of the batch.

Need to jump to a different batch? The **Batch N** button in the top bar takes you back
to the list.

Need an old client's link later? The **history** button in the top bar lists every
delivery with its link, ready to copy again.

## If something looks off

- **Upload failed?** Check the internet and hit Retry. Nothing is lost, and retrying is safe.
- **"Reconnect Google"?** Click it and sign in again; rare, takes seconds.
- **Two sprites listed?** You sent twice. Click the one this commission is about, and use
  the ✕ on the other one if you want it gone.
- **No corner card when the gif finishes?** Neku has to be open for it. You can see which
  folder it is watching under the gear icon. Dragging the gif onto the window always works.
- **Warning that a client folder already exists?** You've probably typo'd a name (or
  reused one). It tells you which batch the existing one is in. Double-check the spelling
  before delivering.
- Anything weirder: tell Justin, it's his fault.
