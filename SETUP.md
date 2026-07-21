# Neku setup for Justin (the one-time distributor)

Your friend never touches Google Cloud, configs, or terminals. **You** do the ~30-minute
setup below once, on **your** Google account, then hand him two things:

1. a **link** (the tablet app), and
2. an **exe** (the laptop app), plus [HANDOFF.md](HANDOFF.md), written for him.

How this works: the Google Cloud project is just the *app's identity* ("Neku wants access
to…"). Your friend signs in with **his** Google account inside the apps, so everything
lands in **his** Drive. Nothing of his routes through your account, and you never see his
files. This is the same model every Drive-connected desktop app uses.

---

## Part 1: Google Cloud project (~20 min, on your account)

> **Rule that makes or breaks it:** both OAuth clients below must be created inside the
> **same** Cloud project. The `drive.file` permission scopes visibility to the app
> (= project); split the clients across projects and the laptop can never see what the
> tablet uploaded.

1. Go to <https://console.cloud.google.com/> and sign in (your account).
2. Create a new project, name `Neku`.
3. **Enable the Drive API:** *APIs & Services → Library* → search "Google Drive API"
   → **Enable**. (Skip this and nothing works.)
4. **Consent screen** (*APIs & Services → OAuth consent screen*, sometimes branded
   "Google Auth Platform"):
   - User type **External** → Create.
   - App name `Neku`, your email in both email fields. Logo and the rest: skip.
   - Scopes: add `https://www.googleapis.com/auth/drive.file` if the UI offers the step
     (the apps request it at runtime either way).
5. **Publish to production:** on the consent screen page, set Publishing status to
   **In production** ("Publish app" button). No Google review is needed for the
   `drive.file` scope.

   > Left in "Testing", refresh tokens die every 7 days and your friend's laptop app
   > would demand a re-login weekly, forever. Also, in Testing only listed test users can
   > sign in at all. Production status is what lets *his* account in.

6. **Laptop OAuth client:** *Credentials → Create credentials → OAuth client ID* →
   type **Desktop app**, name `Neku laptop`. Copy the **Client ID** and **Client secret**.
7. **Tablet OAuth client:** *Create credentials → OAuth client ID* → type
   **Web application**, name `Neku tablet`. Under **Authorized JavaScript origins** add
   the exact PWA origin from Part 2 (e.g. `https://neku-tablet.netlify.app`, with no path
   and no trailing slash). Copy its **Client ID** (web clients need no secret here).

   *(You'll do Part 2 first if you don't know the origin yet. Order doesn't matter, you
   can edit origins any time.)*

---

## Part 2: Bake & host the tablet app

1. Open [`tablet/config.js`](tablet/config.js) and paste the **Web** client ID:
   ```js
   window.NEKU_CONFIG = {
     clientId: '1234567890-xxxx.apps.googleusercontent.com',
     stagingFolder: 'Sprite Staging',
   };
   ```
2. Host the `tablet/` folder on any free static host (HTTPS required):
   - **Netlify Drop** (fastest): <https://app.netlify.com/drop>, drag the `tablet` folder
     onto the page, note the `https://….netlify.app` URL.
   - or GitHub Pages / Cloudflare Pages if you prefer.
3. Make sure that URL's origin is in the Web client's **Authorized JavaScript origins**
   (Part 1 step 7).
4. Open the URL yourself. With `config.js` filled it must go **straight to the upload
   screen**, no setup questions. That link is deliverable #1.

Changed something later? Edit locally, re-drop the folder. That's the whole deploy story.

---

## Part 3: Bake & build the laptop exe

Two ways to get the Desktop credentials into the exe. Pick one:

**Option A: bake into the exe (recommended: one file to send)**
```powershell
cd "C:\Users\Justin\Desktop\Neku app\laptop"
copy oauth.config.example.json oauth.config.json
notepad oauth.config.json     # paste the DESKTOP client id + secret
npm run dist
```
Result: `laptop\release\Neku-portable.exe`, deliverable #2, send as-is.

**Option B: sidecar file (no rebuild needed)**
Keep the already-built `Neku-portable.exe` and put a `neku.config.json` **next to it**:
```json
{
  "clientId": "1234567890-xxxx.apps.googleusercontent.com",
  "clientSecret": "GOCSPX-xxxxxxxx"
}
```
Send both files together (zip them); the exe reads the config from its own folder.

Priority if several exist: in-app settings > sidecar file > baked values.

> Is shipping the secret OK? Yes: Google documents that Desktop-app client secrets are
> not treated as confidential; every installed Drive app ships one. The secret identifies
> the app, not any account, and the scope is limited to files Neku itself creates.

---

## Part 4: Dry run before handoff (10 min, strongly recommended)

Do one full run yourself, signed in with **your** account, before sending anything:

1. Open the hosted tablet URL → pick any PNG → **Send to laptop** (first send: Google
   sign-in + "unverified app" → Advanced → Continue).
2. Run the exe (SmartScreen: More info → Run anyway) → **Connect Drive** → same
   click-through.
3. Batch menu appears → **Start Batch 5** (the first number Neku ever creates). Sprite
   appears on the light table → type `Test`,
   drop any gif → **Deliver to Drive**.
4. Check your Drive: `Commissions/Batch 5/Test/` has `Test_sprite.png` + `bouncy.gif`, the
   link works in a private window, and the staging folder is empty again. Open the
   `Batch 5` folder's own sharing: it must still be private (only the client folder inside
   it is shared).
5. Clean up: delete `Commissions/` from your Drive, and in the app's settings gear →
   **Disconnect** (so the exe you send isn't tied to your account). Send him the exe, the
   link, and [HANDOFF.md](HANDOFF.md).

*(His first runs will re-create the folders in his own Drive.)*

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Tablet uploads, laptop never sees the sprite | The two OAuth clients are in different Cloud projects, or staging folder names differ between the two apps' settings. |
| `Error 400: origin_mismatch` on tablet sign-in | PWA origin missing from the Web client's Authorized JavaScript origins (or typo/trailing slash). |
| `Access blocked … has not completed the Google verification process` | Consent screen still in **Testing**. Publish to production (Part 1 step 5). |
| Laptop asks to re-login every week | Same cause: Testing status. |
| Friend's sign-in works but folders don't appear in his Drive | He signed in with a different Google account than he thinks. Settings gear → Disconnect, reconnect with the right one. |
| Sprite lands in the wrong folder tree | The apps only see folders **they created** (`drive.file`). Don't pre-create `Commissions/` by hand; let the app make it. |
| SmartScreen blocks the exe | Unsigned personal app: More info → Run anyway. |
| App opens on a setup screen asking for OAuth ids | The build/deploy wasn't baked: fill `tablet/config.js` (tablet) or redo Part 3 (laptop). |
