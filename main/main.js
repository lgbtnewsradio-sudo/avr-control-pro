const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { EiscpClient, discover } = require('./eiscp');

let fullWin = null;
let miniWin = null;
let artFetchTimer = null;
const client = new EiscpClient();

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { ip: null, port: 60128, mode: 'auto', miniPinned: true, model: null };
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch (e) {}
}
function saveSettings() {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch (e) {}
}

/* ------------------------------------------------------------------ */
/* Receiver state model — mirrored to both windows                     */
/* ------------------------------------------------------------------ */
const state = {
  connection: { state: 'disconnected', ip: null, model: null },
  /*
   * Volume scale, read from the receiver's own NRI device description.
   * volstep=0 means half-dB steps, so the raw MVL value is twice the number
   * shown on the front panel; volstep=1 means raw == displayed. Defaulting to
   * whole-dB is the safe guess: if we under-estimate the scale the knob simply
   * can't reach full output, whereas over-estimating would send a raw value the
   * receiver clamps to maximum volume.
   */
  scale: {
    main: { step: 1, volmax: 100, maxRaw: 100 },
    z2: { step: 1, volmax: 100, maxRaw: 100 },
    z3: { step: 1, volmax: 100, maxRaw: 100 },
  },
  power: false,
  volume: 0, maxVolume: 100, mute: false,
  input: null,            // SLI hex code
  mode: null,             // LMD hex code
  bass: 0, treble: 0, swl: 0, ctl: 0,
  dimmer: '00', sleep: 0, hdo: '01', ltn: '00', mot: '00',
  z2: { power: false, volume: 0, mute: false, input: null },
  z3: { power: false, volume: 0, mute: false, input: null },
  tuner: null,
  audioInfo: '', videoInfo: '',
  net: { title: '', artist: '', album: '', status: 'S', repeat: '-', shuffle: '-', time: '', art: null },
};

function broadcast(channel, payload) {
  for (const w of [fullWin, miniWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}
function pushState() { broadcast('state', state); }

/* ------------------------------------------------------------------ */
/* eISCP message handling                                              */
/* ------------------------------------------------------------------ */
const hex = (d) => { const v = parseInt(d, 16); return Number.isNaN(v) ? 0 : v; };
// signed level format: "+3" / "-A" / "00"
function signedHex(d) {
  if (!d) return 0;
  if (d[0] === '+') return hex(d.slice(1));
  if (d[0] === '-') return -hex(d.slice(1));
  return hex(d);
}

const QUERIES_MAIN = ['NRIQSTN','PWRQSTN','MVLQSTN','AMTQSTN','SLIQSTN','LMDQSTN','TFRQSTN','SWLQSTN','CTLQSTN',
  'DIMQSTN','SLPQSTN','HDOQSTN','LTNQSTN','MOTQSTN','TUNQSTN','IFAQSTN','IFVQSTN'];
const QUERIES_ZONES = ['ZPWQSTN','ZVLQSTN','ZMTQSTN','SLZQSTN','PW3QSTN','VL3QSTN','MT3QSTN','SL3QSTN'];
const QUERIES_NET = ['NJAENA','NTIQSTN','NATQSTN','NALQSTN','NSTQSTN','NTMQSTN','NJAREQ'];

// <zone id="1" value="1" name="Main" volmax="100" volstep="0" ... />
function parseNri(xml) {
  const zoneKey = { 1: 'main', 2: 'z2', 3: 'z3' };
  const re = /<zone\s+id="(\d)"[^>]*?volmax="(\d+)"[^>]*?volstep="(\d)"/g;
  let m, found = false;
  while ((m = re.exec(xml)) !== null) {
    const key = zoneKey[Number(m[1])];
    const volmax = Number(m[2]);
    if (!key || !volmax) continue;
    const step = Number(m[3]) === 0 ? 0.5 : 1;
    state.scale[key] = { step, volmax, maxRaw: Math.round(volmax / step) };
    found = true;
  }
  return found;
}

function queryAll() {
  [...QUERIES_MAIN, ...QUERIES_ZONES, ...QUERIES_NET].forEach((q) => client.send(q));
}

client.on('status', (s) => {
  state.connection.state = s.state;
  state.connection.ip = s.ip;
  state.connection.reason = s.reason || null;
  state.connection.retryIn = s.retryIn || 0;
  state.connection.attempt = s.attempt || 0;
  // 'connected' now means the receiver actually answered us, not just that the
  // TCP handshake succeeded — so this is the right moment to resync everything.
  if (s.state === 'connected') queryAll();
  pushState();
});

// Safety net: while the network player is playing but we have no cover yet,
// re-poll the receiver's art endpoint (it often lags a few seconds behind
// track start, and a one-shot fetch can land too early).
setInterval(() => {
  const netInput = ['2B', '2E', '29', '2A'].includes(state.input);
  if (client.connected && state.power && netInput && state.net.status === 'P' && !state.net.art) {
    artFallbackTried = true; // route the result straight to state, no double-fetch
    client.fetchDeviceArt();
  }
}, 10000);

let artFallbackTried = false;
client.on('art', (dataUrl) => {
  if (dataUrl) {
    state.net.art = dataUrl;
  } else if (!artFallbackTried) {
    // NJA said "no image" — Spotify Connect art lives on the receiver's HTTP
    // server instead. Try that once per track before accepting no art.
    artFallbackTried = true;
    client.fetchDeviceArt();
    return;
  } else {
    state.net.art = null;
  }
  pushState();
});

client.on('message', ({ cmd, data }) => {
  switch (cmd) {
    case 'PWR': state.power = data === '01'; break;
    case 'MVL':
      state.volume = hex(data);
      // Safety net for units that don't answer NRIQSTN: a raw value above the
      // assumed maximum can only mean the scale is finer than we thought.
      if (state.volume > state.scale.main.maxRaw && state.scale.main.step === 1) {
        state.scale.main = { step: 0.5, volmax: state.scale.main.volmax,
                             maxRaw: state.scale.main.volmax * 2 };
      }
      break;
    case 'AMT': state.mute = data === '01'; break;
    case 'SLI':
      state.input = data;
      if (data === '2B' || data === '2E' || data === '29' || data === '2A') {
        QUERIES_NET.forEach((q) => client.send(q));
      }
      break;
    case 'LMD': state.mode = data; break;
    case 'TFR': {
      const b = data.match(/B([+-][0-9A-F]|00)/i);
      const t = data.match(/T([+-][0-9A-F]|00)/i);
      if (b) state.bass = signedHex(b[1]);
      if (t) state.treble = signedHex(t[1]);
      break;
    }
    case 'SWL': state.swl = signedHex(data); break;
    case 'CTL': state.ctl = signedHex(data); break;
    case 'DIM': state.dimmer = data; break;
    case 'SLP': state.sleep = data === 'OFF' ? 0 : hex(data); break;
    case 'HDO': state.hdo = data; break;
    case 'LTN': state.ltn = data; break;
    case 'MOT': state.mot = data; break;
    case 'ZPW': state.z2.power = data === '01'; break;
    case 'ZVL': state.z2.volume = hex(data); break;
    case 'ZMT': state.z2.mute = data === '01'; break;
    case 'SLZ': state.z2.input = data; break;
    case 'PW3': state.z3.power = data === '01'; break;
    case 'VL3': state.z3.volume = hex(data); break;
    case 'MT3': state.z3.mute = data === '01'; break;
    case 'SL3': state.z3.input = data; break;
    case 'TUN': state.tuner = data; break;
    case 'IFA': state.audioInfo = data; break;
    case 'IFV': state.videoInfo = data; break;
    case 'NRI': parseNri(data); break;
    case 'NTI':
      if (data !== state.net.title) {
        state.net.title = data;
        artFallbackTried = false;
        // NJA art may not arrive for Spotify Connect; pull the cover from the
        // receiver's HTTP endpoint shortly after the track changes.
        clearTimeout(artFetchTimer);
        artFetchTimer = setTimeout(() => client.fetchDeviceArt(), 1200);
      }
      break;
    case 'NAT': state.net.artist = data; break;
    case 'NAL': state.net.album = data; break;
    case 'NST': {
      const wasPlaying = state.net.status === 'P';
      state.net.status = data[0] || 'S';
      state.net.repeat = data[1] || '-';
      state.net.shuffle = data[2] || '-';
      if (!wasPlaying && state.net.status === 'P') {
        // playback just started — art appears on the receiver shortly after
        artFallbackTried = false;
        clearTimeout(artFetchTimer);
        artFetchTimer = setTimeout(() => client.fetchDeviceArt(), 1500);
      }
      break;
    }
    case 'NTM': state.net.time = data; break;
    default: break; // unknown messages are ignored but connection stays healthy
  }
  pushState();
});

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */
ipcMain.handle('get-state', () => ({ state, settings }));

ipcMain.on('cmd', (_e, message) => client.send(message));

ipcMain.handle('discover', async () => {
  const devices = await discover();
  return devices;
});

ipcMain.handle('connect', (_e, { ip, port, mode, model }) => {
  settings.ip = ip;
  settings.port = port || 60128;
  if (mode) settings.mode = mode;
  // Only discovery knows the model name; a manual IP leaves it blank.
  settings.model = model || null;
  state.connection.model = settings.model;
  saveSettings();
  client.connect(ip, settings.port);
  return true;
});

/*
 * Open the receiver's own web setup page in the default browser.
 * The renderer supplies no URL: it's built here from the address we're actually
 * connected to and checked against a strict IPv4 pattern, so this can't be used
 * to open anything other than the receiver on the local network.
 */
ipcMain.handle('open-setup', async () => {
  const ip = state.connection.ip || settings.ip;
  if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  if (ip.split('.').some((o) => Number(o) > 255)) return false;
  await shell.openExternal(`http://${ip}/`);
  return true;
});

// Force a fresh session — used by the RECONNECT button when the receiver has
// gone mute on an established link.
ipcMain.handle('reconnect', () => {
  if (!settings.ip) return false;
  client.shutdown(() => client.connect(settings.ip, settings.port));
  return true;
});

ipcMain.on('win', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (action === 'min') w.minimize();
  else if (action === 'max') w.isMaximized() ? w.unmaximize() : w.maximize();
  else if (action === 'close') { app.quit(); }
});

ipcMain.on('set-view', (_e, view) => {
  if (view === 'mini') { createMiniWin(); if (fullWin) fullWin.hide(); }
  else { createFullWin(); if (miniWin) miniWin.hide(); }
});

ipcMain.on('mini-resize', (_e, height) => {
  if (miniWin && !miniWin.isDestroyed()) {
    const [w] = miniWin.getSize();
    miniWin.setSize(w, Math.round(height), true);
  }
});

ipcMain.on('mini-pin', (_e, pinned) => {
  settings.miniPinned = pinned;
  saveSettings();
  if (miniWin && !miniWin.isDestroyed()) miniWin.setAlwaysOnTop(pinned);
});

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */
const winCommon = {
  frame: false,
  backgroundColor: '#0b0c0d',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
  },
};

function createFullWin() {
  if (fullWin && !fullWin.isDestroyed()) { fullWin.show(); fullWin.focus(); return; }
  fullWin = new BrowserWindow({
    ...winCommon,
    width: 1440, height: 940, minWidth: 1150, minHeight: 780,
    title: 'AVR Control Pro',
  });
  fullWin.loadFile(path.join(__dirname, '..', 'renderer', 'full.html'));
  fullWin.on('closed', () => { fullWin = null; });
}

function createMiniWin() {
  if (miniWin && !miniWin.isDestroyed()) { miniWin.show(); miniWin.focus(); return; }
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  miniWin = new BrowserWindow({
    ...winCommon,
    width: 480, height: 560, minWidth: 480, minHeight: 148, maxWidth: 480,
    x: sw - 500, y: 40,
    resizable: false,
    alwaysOnTop: settings.miniPinned,
    skipTaskbar: false,
    title: 'AVR Control — Mini',
  });
  miniWin.loadFile(path.join(__dirname, '..', 'renderer', 'mini.html'));
  miniWin.on('closed', () => { miniWin = null; });
}

/* ------------------------------------------------------------------ */
// Only one copy may run: the receiver has very few eISCP session slots, and a
// second instance competing for them is indistinguishable from a hung link.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  const w = (fullWin && !fullWin.isDestroyed() && fullWin.isVisible()) ? fullWin : (miniWin || fullWin);
  if (w && !w.isDestroyed()) { w.show(); if (w.isMinimized()) w.restore(); w.focus(); }
});

app.whenReady().then(async () => {
  loadSettings();
  state.connection.model = settings.model || null;
  createFullWin();

  if (settings.mode === 'manual' && settings.ip) {
    client.connect(settings.ip, settings.port);
  } else {
    // auto-discover on launch; fall back to last known IP
    const devices = await discover();
    const integra = devices.find((d) => /DRX|integra/i.test(d.model)) || devices[0];
    if (integra) {
      state.connection.model = integra.model;
      settings.ip = integra.ip;
      settings.port = integra.port;
      settings.model = integra.model;
      saveSettings();
      client.connect(integra.ip, integra.port);
    } else if (settings.ip) {
      client.connect(settings.ip, settings.port);
    }
    broadcast('discovered', devices);
  }
});

app.on('window-all-closed', () => app.quit());

// Hold the quit until the control session is closed politely — otherwise the
// receiver keeps the slot allocated and refuses to talk on the next launch.
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  clearTimeout(artFetchTimer);
  client.shutdown(() => app.exit(0));
});
