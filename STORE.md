# Microsoft Store submission

Everything here is prepared: the MSIX builds, the tile assets are generated, and the
privacy policy the Store requires is published. Three things still need a human —
they depend on your Partner Center account and can't be filled in ahead of time.

---

## Read this first: the app name is a trademark risk

The app is currently called **Integra Control Pro**, and the in-app title bar renders
"INTEGRA" as a wordmark. "Integra" is a trademark of Onkyo/Integra, and Microsoft Store
policy (10.1 and 10.2) requires that your listing not use branding you don't own or
imply an endorsement you don't have. Submitting under this name risks rejection at
certification, or removal later after a trademark complaint.

Two ways through it, in order of safety:

1. **Rename the product** to something you own — e.g. *AVR Control Pro* — and describe
   compatibility in the listing text instead: "Works with Integra and Onkyo network
   receivers." The Store name and the description are treated differently; describing
   what hardware your app supports is normal and expected.
2. **Use a nominative name** such as *Remote for Integra Receivers*. This is the pattern
   many third-party remotes use, and it is more often accepted than a bare brand name —
   but it is still the reviewer's call, so it carries some risk.

Whichever you choose, keep the disclaimer that's already in the site footer and put the
same line at the end of your Store description:

> Not affiliated with, endorsed by, or sponsored by Onkyo, Integra, Spotify, or Microsoft.
> All trademarks are the property of their respective owners.

To rename, change `productName` and `build.productName` in `package.json`, the
`build.appx.displayName`, and the `.wordmark` text in `renderer/full.html` and
`renderer/mini.html`. Nothing else depends on the name.

---

## What you need to do

### 1. Get a Partner Center account and reserve the name

- Register at <https://partner.microsoft.com/dashboard> — a one-time fee
  (individual accounts are cheaper than company accounts; company accounts require
  business verification).
- Create the app and **reserve the name** you settled on above.

### 2. Copy your product identity into `package.json`

Partner Center → your app → **Product management → Product identity**. Copy the three
values into `build.appx` in `package.json`, replacing the placeholders:

| package.json field     | Partner Center value        | Looks like                          |
| ---------------------- | --------------------------- | ----------------------------------- |
| `identityName`         | Package/Identity/Name       | `12345MikeMoran.IntegraControlPro`  |
| `publisher`            | Package/Identity/Publisher  | `CN=A1B2C3D4-1234-5678-9ABC-...`    |
| `publisherDisplayName` | Package/Properties/PublisherDisplayName | your publisher display name |

These must match **exactly**, or the upload is rejected.

### 3. Build and upload

```bash
npm run dist:store
```

That produces `dist/integra-control-pro-1.0.0-x64.msix`. Upload it in Partner Center
under **Packages**. Do not sign it yourself — the Store re-signs packages with its own
certificate on ingestion.

Bump `version` in `package.json` for every resubmission; the Store rejects a package
whose version isn't higher than the last one you uploaded.

---

## Listing content you can reuse

**Privacy policy URL** (required — the app uses the network):
`https://lgbtnewsradio-sudo.github.io/integra-control-pro/privacy.html`

**Short description**

> Control your Integra or Onkyo network receiver from your Windows desktop. Full input,
> zone, listening-mode and tone control, a live replica of the receiver's front-panel
> display, and Spotify Connect track info with album art. No account required.

**Screenshots** — `docs/screenshots/full-view.png` (1440×1191) and
`docs/screenshots/mini-view.png` (480×369). The Store wants at least one desktop
screenshot at 1366×768 or larger, so the full view qualifies; the mini view is below the
minimum and should be used only as a secondary image if the uploader accepts it, or
padded onto a 1366×768 canvas first.

**Category:** Music → Tools, or Utilities + tools.

**Age rating:** the questionnaire will land on 3+ / Everyone — the app has no user
content, ads, or data collection.

---

## Things certification will check that are already handled

- **Full-trust desktop app.** electron-builder declares `runFullTrust`, which is what
  lets a Win32/Electron app use raw TCP and UDP sockets inside an MSIX container. The
  discovery broadcast and eISCP control connection work under that capability.
- **Settings location.** The app writes its settings file to the standard per-user data
  folder, which MSIX redirects into the package's own writable store. Nothing is written
  next to the executable, which the Store forbids.
- **Tile assets.** All required logos are generated into `build/appx/` by
  `npm run icons` — 44, 71, 150, 310 square, 310×150 wide, 50 store logo, and a splash
  screen.
- **No third-party artwork.** The screenshots use synthetic cover art generated by the
  app's demo mode, not a real album cover.

## Known toolchain quirk

`electron-builder --win appx` stages the package correctly and then fails at the final
step with `spawn UNKNOWN` when it tries to run `makeappx.exe`. `npm run dist:store` works
around this: it lets electron-builder stage the payload, then invokes `makeappx.exe` from
the installed Windows SDK directly. If you ever see "makeappx.exe not found", install the
Windows 10/11 SDK and re-run.
