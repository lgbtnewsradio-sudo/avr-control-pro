# AVR Control Pro

A Windows desktop app that controls Integra and Onkyo network receivers over IP, with a
live replica of the receiver's front-panel display, full control of every input, zone,
listening mode and trim, and Spotify Connect track info with album art.

**[Landing page →](https://lgbtnewsradio-sudo.github.io/avr-control-pro/)** · **$5.99 on the
Microsoft Store** (not yet submitted)

![The full window](docs/screenshots/full-view.png)

Built and tested against an **Integra DRX-3.4**. Other Integra and Onkyo network
receivers use the same eISCP protocol and are likely to work, but are untested.

---

## What it does

- **Finds the receiver by itself** — UDP discovery on launch, manual IP entry as a
  fallback, and it remembers what it found.
- **Front-panel replica** — source, scrolling track/station line, volume in dB, and the
  indicator lamps (listening mode, NET/USB, Zone 2/3, sleep, muting) — in both views.
- **Every input and listening mode** — 13 source selectors, quick modes, and direct
  picks like Pure Audio, Neural:X, All Channel Stereo and Full Mono.
- **Master volume** — draggable machined knob, scroll wheel, or step buttons, with the
  receiver's own dB readout and mute.
- **Zone 2 and Zone 3** — power, source, volume and mute for each.
- **Tone and setup** — bass, treble, subwoofer and centre on vertical faders in half-dB
  steps, plus dimmer, HDMI output, Late Night, Music Optimizer and sleep timer.
- **Spotify Connect** — cover art, title, artist, album, progress, and full transport
  (play/pause, skip, shuffle, repeat, stop). No Spotify login: the receiver reports it.
- **Mini view** — compact always-on-top window that collapses to just the display and
  volume strip.
- **Honest connection state** — the status lamp goes green only after the receiver
  actually answers, and the app reconnects on its own if the link goes quiet.
- **Straight to the receiver's own setup page** — one click opens its built-in web
  interface in your default browser, for the settings eISCP doesn't expose.
- **No cloud, no account** — direct eISCP on your LAN.

## Two views

| Full window | Mini window |
| --- | --- |
| ![Full view](docs/screenshots/full-view.png) | ![Mini view](docs/screenshots/mini-view.png) |

Screenshots show sample playback data; the cover art in them is an original graphic, not
a real album.

---

## Running from source

The source is published so you can see exactly what the app does on your network, and so
you can build it for your own use. It is not open source — see [Licence](#licence).

```bash
npm install
npm start
```

If Electron's binary fails to download during `npm install` (common on restricted
networks), fetch `electron-v<version>-win32-x64.zip` from the
[Electron releases](https://github.com/electron/electron/releases), extract it into
`node_modules/electron/dist`, and write `electron.exe` into
`node_modules/electron/path.txt`.

## Building

```bash
npm run dist         # NSIS installer  → dist/*.exe
npm run dist:store   # Store MSIX      → dist/*.msix
npm run icons        # regenerate app icon + Store tiles
npm run shots        # regenerate docs screenshots
npm run a11y         # accessibility audit (axe-core + custom checks)
npm run axtree       # dump the accessibility tree a screen reader reads
```

## Accessibility

`npm run a11y` runs axe-core against both app views and the landing page at
WCAG 2.1/2.2 A and AA, and adds checks axe can't make on its own: it measures
text contrast against the *rendered pixels* (this UI is almost entirely
gradients, which axe can only mark "incomplete"), checks pointer targets against
the 24x24 minimum, presses Tab for real and confirms a focus ring appears, and
verifies the custom volume knob is keyboard-operable.

All three surfaces currently report zero axe violations and zero contrast
failures. One deliberate exception: the **unlit** indicator lamps on the
front-panel replica sit at about 1.2:1, matching real hardware where an inactive
indicator is invisible. WCAG 1.4.3 exempts inactive user-interface components,
and nothing is lost to assistive technology — the panel is exposed as a single
image whose label is rebuilt from live state ("Front panel display. Source NET.
Volume 64.0, -18.0dB. Listening mode DTS NEURAL:X...").

Keyboard notes: the volume knob is a `role="slider"` — arrows step, Shift+arrow
steps by five, Page Up/Down jump by ten, Home/End go to the ends. Connection
state changes are announced through a polite live region.

### Screen readers

`npm run axtree` prints the computed accessibility tree — the same names, roles
and values Chromium hands to Narrator, NVDA and JAWS through the platform
bridge. Both views currently expose **zero unnamed controls**. The panel
replica reads as one sentence rebuilt from live state, for example:

> Front panel display. Source NET. Volume 64.0, -18.0dB. Listening mode DTS
> NEURAL:X. Playing Aurora Field — Neon Cascade. Zone 2 on.

and the knob reads as `Master volume, slider, 64.0, -18.0dB`.

Note that this verifies the data a screen reader is given, not the audio it
produces. Windows offers no way to capture Narrator's speech, so confirming how
it *sounds* — pacing, pronunciation of "dB", whether the panel sentence is too
long in practice — still needs a manual pass with Narrator on
(Ctrl+Win+Enter, then Caps Lock + arrow keys to move through the window).

See [STORE.md](STORE.md) for the Microsoft Store submission checklist — product identity,
the payout and tax profile required for paid apps, price tier, and the free trial.

---

## How it works

Control runs over **eISCP**, the Integra/Onkyo protocol, on TCP port 60128. Discovery is
a UDP broadcast of `ECNQSTN` on the same port.

Two behaviours are worth knowing about, both learned from a live DRX-3.4:

- **Tone and level values are in half-decibel units.** A reported `+5` is +2.5 dB.
- **Volume resolution varies by model, and the receiver will tell you.** `NRIQSTN`
  returns a device description whose zone list carries `volmax` and `volstep`; a
  `volstep` of `0` means half-dB steps, so the raw `MVL` value is double the number on
  the front panel (raw 72 = 36.0 = -46.0 dB), while `1` means they match. The app reads
  this on connect and scales the readout, the knob and the zone sliders to suit. If a
  receiver doesn't answer `NRIQSTN`, it falls back to whole-dB — deliberately the
  cautious guess, since assuming a finer scale than the receiver has would send raw
  values it clamps to maximum volume.
- **Spotify Connect cover art does not arrive over eISCP.** The receiver answers the
  `NJA` artwork request with "no image" and instead serves the current cover from its own
  HTTP endpoint at `/album_art.cgi`. That response also carries a stray CGI header block
  ahead of the JPEG bytes, which has to be stripped before the image will decode.

### Session hygiene

The receiver has very few eISCP control-session slots and does **not** reclaim them from
clients that disappear without closing the connection properly. Exhaust them and it will
accept TCP connections and then answer nothing — while UDP discovery and its web server
keep working normally, which makes it look like the app is broken when the receiver is
the one that's stuck. Only a power cycle clears it (standby is not enough, because the
network module stays powered).

Because of that, this app:

- closes its control session with a proper FIN on exit, and waits for it;
- verifies the receiver actually replies before reporting itself online;
- holds a single-instance lock so two copies never compete for a slot;
- backs off harder when the receiver is mute, instead of hammering it.

## Project layout

```
main/          Electron main process
  eiscp.js       protocol client: framing, discovery, artwork, reconnect logic
  main.js        window management, receiver state model, IPC
  preload.js     context-isolated bridge
renderer/      UI (full + mini views, shared theme and logic)
tools/         icon generation, screenshots, MSIX packaging
docs/          landing page + privacy policy (GitHub Pages)
```

## Licence

Copyright (c) 2026 Black Dog Developers, LLC. All rights reserved. You may read and audit this source,
and build it for your own personal use on hardware you own. Redistributing builds, or
selling this software or derivatives of it, requires written permission. See
[LICENSE](LICENSE) for the exact terms.

Version 1.0.0 was released under the MIT Licence and stays MIT for anyone who obtained
it; this licence governs 1.1.0 onward.

Not affiliated with, endorsed by, or sponsored by Onkyo, Integra, Spotify, or Microsoft;
all trademarks belong to their respective owners.
