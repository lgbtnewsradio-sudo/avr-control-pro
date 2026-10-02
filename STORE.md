# Microsoft Store submission — eISCP AVR Remote Control at $5.99

The package builds, the tile assets are generated, the privacy policy is published, and
the app has been renamed off the Integra trademark. What's left needs your Partner Center
account.

---

## Naming — settled

The reserved Store name is **eISCP AVR Remote Control**. "AVR Control Pro" was
already taken by someone else, and the original reservation, "Onkyo Integra AVR
Control", put two Onkyo/Integra trademarks in the customer-facing name — Store
policy 10.1/10.2 covers branding you do not own, which risks rejection at
certification and a takedown later on a complaint.

Everything customers see now uses the reserved name: the listing, the window
title bar, the executable, the installer shortcut, the Store tiles, the site and
the docs.

Two things deliberately keep the old string, and neither is customer-facing:

- The identity `BlackDogDevelopersLLC.OnkyoIntegraAVRControl`, which is permanent
  once reserved.
- The repository and Pages URL slug, `avr-control-pro`.

Compatibility belongs in the description, which is the safe place for it:

> Works with Integra and Onkyo network receivers.

Keep this line at the end of the Store description — it is already in the site footer:

> Not affiliated with, endorsed by, or sponsored by Onkyo, Integra, Spotify, or Microsoft.
> All trademarks are the property of their respective owners.

---

## What you need to do

### 1. Partner Center account

Register at <https://partner.microsoft.com/dashboard>. One-time registration fee;
individual accounts are cheaper than company accounts and don't need business
verification. Then create the app and **reserve the name "eISCP AVR Remote Control"**.

### 2. Payout and tax profile — required before you can sell anything

This is the step that only applies to paid apps, and it blocks your money rather than
your submission, so do it early:

- **Payout account** — the bank account Microsoft deposits into.
- **Tax profile** — a W-9 if you're in the US, W-8 otherwise. Microsoft withholds tax
  until this is complete.

Both live under Partner Center → Settings → Account settings → Payout and tax.

### 3. Product identity — done

`build.appx` in `package.json` now carries the real values from Partner Center,
and a rebuilt package has been verified to match them exactly:

| package.json field     | value                                          |
| ---------------------- | ---------------------------------------------- |
| `identityName`         | `BlackDogDevelopersLLC.OnkyoIntegraAVRControl`  |
| `publisher`            | `CN=2143F09A-4C5B-4665-BDDB-40F66211FF64`       |
| `publisherDisplayName` | `Black Dog Developers, LLC`                     |
| `displayName`          | `eISCP AVR Remote Control` *(the reserved name)* |

Store ID **9NNRM8HRC8SP** · <https://apps.microsoft.com/detail/9NNRM8HRC8SP>

`displayName` must match a name you have **reserved**, or the package is rejected
at upload. See the naming note above — reserving "eISCP AVR Remote Control" is the one
remaining Partner Center step.

### 4. Set the price to $5.99

Pricing and availability → **Markets and custom prices** → base price.

Note: **$5.90 is not selectable.** Store price tiers start at $0.99 and step in fixed
increments that all end in 9 — $5.99 is the tier next to the number you had in mind.
The same applies if you ever move up: it's $6.99 or $7.99, never $7.00.

Microsoft takes **15%** of each sale on their commerce platform, so $5.99 nets you about
**$5.09**. Microsoft is the merchant of record — they collect and remit VAT and sales
tax, and they handle refunds, so you have no tax registration obligations per market.

### 5. Turn on the free trial

Pricing and availability → **Free trial** → choose a time-limited trial (7 days is
typical).

Do this. The single biggest reason someone won't buy a receiver remote is "will it work
with *my* unit?" — the app is confirmed on a DRX-3.4 and merely *likely* on everything
else, and a trial answers that question honestly instead of generating refunds. Once the
trial is live, add a line to the listing description saying so.

### 6. Build and upload

```bash
npm run dist:store
```

Produces `dist/eiscp-avr-remote-control-<version>-x64.msix`. Upload under **Packages**. Don't sign it
yourself — the Store re-signs on ingestion.

**Close the app before building.** If `dist/win-unpacked` is locked by a running
copy, electron-builder aborts with `EBUSY` before it stages anything.

Bump `version` in `package.json` only once the Store has *accepted* a package at
the current number. A rejected upload never counted, so you can fix and re-upload
at the same version.

### 7. Two things Partner Center says on upload

**MinVersion (blocking).** The Store refuses any MSIX targeting
`MinVersion <= 10.0.17134.0`. electron-builder defaults to `10.0.14316.0`, so
`build.appx` now pins:

```json
"minVersion": "10.0.17763.0",       // Windows 10 1809
"maxVersionTested": "10.0.22621.0"
```

That matches the minimum the listing already claims, so nothing else changes.

**runFullTrust (warning, not blocking).** `runFullTrust` is a restricted
capability, and Partner Center flags it. It is the normal and expected
declaration for a packaged Win32 desktop app — without it the app cannot open
the raw TCP and UDP sockets it needs to reach the receiver. Explain that in
**Submission Options → Notes for certification**, for example:

> This is a packaged Win32 (Electron) desktop app. runFullTrust is required to
> open raw TCP and UDP sockets on the local network: the app discovers an
> Integra/Onkyo receiver by UDP broadcast on port 60128 and controls it over a
> TCP connection on the same port. No other restricted capability is used, and
> the app makes no internet connections.

### 8. Submission Options — two required fields

**Why do you need the runFullTrust capability?**

> eISCP AVR Remote Control is a packaged Win32 desktop application (Electron)
> distributed via the Desktop Bridge. runFullTrust is required because it is a
> full-trust Win32 executable rather than a UWP app, and specifically because it
> must open raw TCP and UDP sockets on the local network, which the restricted
> UWP networking capabilities do not allow for this use.
>
> How it is used:
> 1. Discovery — the app sends a UDP broadcast datagram to port 60128 on the
>    local subnet and listens for replies from Integra/Onkyo A/V receivers.
> 2. Control — it opens a TCP client connection to the discovered receiver on
>    port 60128 and exchanges eISCP protocol frames to read and set power, input,
>    volume, listening mode, tone controls and zone settings.
> 3. Album art — it performs a plain HTTP GET to the receiver's own built-in
>    endpoint (http://<receiver-ip>/album_art.cgi) for the current cover image.
>
> All three are confined to the user's own local network and to receiver hardware
> they own. The app makes no internet connections, has no account or telemetry,
> collects no personal data, installs no services or drivers, and declares no
> other restricted capability. It writes only a small settings file (receiver IP
> and window preferences) to its per-user application data folder.

**Notes for certification.** Do not leave this blank. A tester will run the app
on a network with no receiver on it, see OFFLINE, and can reasonably conclude the
app does not work.

> IMPORTANT: this app controls physical hardware. It requires an Integra or Onkyo
> network A/V receiver on the same local network — without one there is nothing
> for it to connect to.
>
> If no receiver is available for testing, the app can still be evaluated:
> - It launches to the full window with all controls visible.
> - The Connection panel status reads OFFLINE or NO RESPONSE with a red indicator
>   and retries on a backoff. This is correct behaviour, not a failure.
> - AUTO DISCOVER performs a UDP broadcast and reports "No receivers found".
> - A manual IP can be entered; an unreachable address shows NO RESPONSE rather
>   than hanging or crashing.
> - MINI VIEW switches to the compact window and back.
> - No account, sign-in, or internet connection is required at any point.
>
> Tested against an Integra DRX-3.4. The eISCP protocol (TCP/UDP port 60128) is
> shared across Integra and Onkyo network receivers.

---

## Local testing vs the Store package

`dist/` holds two very different files:

| file | purpose |
| --- | --- |
| `eiscp-avr-remote-control-<version>-x64.exe` | install locally to test; no certificate needed |
| `eiscp-avr-remote-control-<version>-x64.msix` | upload to Partner Center; **unsigned by design** |

Double-clicking the MSIX fails with `0x800B010A` ("publisher certificate could
not be verified"). That is expected: Windows will only sideload a signed package,
and the Store re-signs on ingestion. Signing it locally would break the publisher
match and get the upload rejected, so leave it unsigned and use the .exe to test.

---

## Listing content you can reuse

**Privacy policy URL** (required — the app uses the network):
`https://lgbtnewsradio-sudo.github.io/avr-control-pro/privacy.html`

**Short description**

> Control your Integra or Onkyo network receiver from your Windows desktop. Every input,
> zone, listening mode and tone trim, a live replica of the receiver's front-panel
> display, and Spotify Connect track info with album art. No account, no cloud, no
> subscription.

**Screenshots** — `docs/screenshots/full-view.png` (1440×1191) clears the Store's
1366×768 desktop minimum. `docs/screenshots/mini-view.png` (480×369) is below it, so pad
it onto a 1366×768 canvas if you want it as a second image. Regenerate both any time with
`npm run shots`.

**System requirements → hardware preferences**

Leave every peripheral box unchecked under both Minimum and Recommended —
touch, keyboard, mouse, camera, NFC, Bluetooth, microphone and telephony are all
genuinely not required. In particular **do not tick Bluetooth**: the BLUETOOTH
button in the app selects the *receiver's* Bluetooth input over the network and
has nothing to do with the PC's radio.

What is actually required, for the description field:

> Requires a network connection to an Integra or Onkyo receiver on the same
> local network — the app controls hardware and does nothing on its own. The
> receiver's "Network Standby" setting must be on to control it from standby.
> 64-bit Windows 10 (1809) or Windows 11. Minimum window 900 x 600, so any
> display from 1024 x 768 upward works; the full layout needs about 1150 px of
> window height, and scrolls on shorter screens. No dedicated graphics, and
> about 250 MB of memory in use.

Verified sizes: the layout is clipping-free and fully scrollable at 1366 x 728
(a 1366 x 768 laptop after the taskbar), 1280 x 700, 1024 x 640 and down to
700 x 520, where it collapses to a single column.

**Architecture:** the package is **x64 only**. It will run on Windows on ARM
under emulation, but if you want native ARM64 you would need to add that target
and test it — nothing here has been.

**Category:** Music → Tools, or Utilities + tools.

**Age rating:** the questionnaire lands on 3+ / Everyone — no user content, ads, or data
collection.

---

## Already handled

- **Full-trust desktop app.** electron-builder declares `runFullTrust`, which is what
  permits raw TCP and UDP sockets inside an MSIX container — needed for the discovery
  broadcast and the eISCP control connection.
- **Settings location.** Settings go to the standard per-user data folder, which MSIX
  redirects into the package's writable store. Nothing is written next to the executable,
  which the Store forbids.
- **Licensing.** Store-installed copies are license-enforced by the Store; only
  purchasers can install. No licence-check code is needed in the app.
- **Tile assets.** All required logos generate into `build/appx/` via `npm run icons`.
- **No third-party artwork.** Screenshots use synthetic cover art from the app's demo
  mode, not a real album cover.

## What changed when the app went paid

- Free installer binaries were removed from the GitHub releases page. Publishing a free
  build of the same app one click from the Store listing would undercut the price.
- The licence changed from MIT to a source-available personal-use licence (see `LICENSE`).
  Version 1.0.0 stays MIT for anyone who already has it — that can't be revoked — so this
  applies from 1.1.0 onward.
- The repository stays public so buyers can audit what the app does on their network,
  but redistribution and resale now require permission.

## Known toolchain quirk

`electron-builder --win appx` stages correctly and then fails with `spawn UNKNOWN` when
it runs `makeappx.exe`. `npm run dist:store` works around it: electron-builder stages the
payload, then `tools/msix.js` calls `makeappx.exe` from the installed Windows SDK
directly. If you see "makeappx.exe not found", install the Windows 10/11 SDK.
