/* Shared logic for full + mini views: command maps, VFD replica, helpers. */

const INPUTS = [
  { code: '10', label: 'BD/DVD' },
  { code: '01', label: 'CBL/SAT' },
  { code: '02', label: 'GAME' },
  { code: '11', label: 'STRM BOX' },
  { code: '05', label: 'PC' },
  { code: '03', label: 'AUX' },
  { code: '23', label: 'CD' },
  { code: '12', label: 'TV' },
  { code: '22', label: 'PHONO' },
  { code: '26', label: 'TUNER' },
  { code: '2B', label: 'NET' },
  { code: '2E', label: 'BLUETOOTH' },
  { code: '29', label: 'USB' },
];
const INPUT_LABEL = Object.fromEntries(INPUTS.map((i) => [i.code, i.label]));

const MODES = [
  { code: '00', label: 'Stereo' },
  { code: '01', label: 'Direct' },
  { code: '11', label: 'Pure Audio' },
  { code: '0C', label: 'All Ch Stereo' },
  { code: '13', label: 'Full Mono' },
  { code: '40', label: 'Str. Decode' },
  { code: '80', label: 'Dolby Surr' },
  { code: '82', label: 'Neural:X' },
];
const MODE_LABEL = {
  '00': 'STEREO', '01': 'DIRECT', '02': 'SURROUND', '03': 'FILM', '0C': 'ALL CH ST',
  '0D': 'T-D', '11': 'PURE AUDIO', '13': 'FULL MONO', '40': 'STR DECODE', '41': 'DOLBY EX',
  '80': 'DOLBY SURR', '82': 'DTS NEURAL:X', '84': 'DOLBY THX', '8B': 'THX MUSIC',
};

const DIM_LABEL = { '00': 'BRIGHT', '01': 'DIM', '02': 'DARK', '03': 'OFF' };
const HDO_LABEL = { '00': 'ANALOG', '01': 'MAIN', '02': 'SUB', '03': 'MAIN+SUB', '04': 'MAIN+SUB', '05': 'BOTH' };
const LTN_LABEL = { '00': 'OFF', '01': 'LOW', '02': 'HIGH', '03': 'AUTO' };

const cmd = (m) => window.integra.cmd(m);
const h2 = (n) => Math.max(0, Math.round(n)).toString(16).toUpperCase().padStart(2, '0');
const signed = (n) => (n === 0 ? '00' : (n > 0 ? '+' : '-') + Math.abs(n).toString(16).toUpperCase());
const volDb = (v) => (v <= 0 ? '---' : ((v - 82) > 0 ? '+' : '') + (v - 82).toFixed(1) + 'dB');
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtTuner(d) {
  if (!d) return '';
  const n = parseInt(d, 10);
  if (Number.isNaN(n)) return d;
  return n > 2000 ? (n / 100).toFixed(2) + ' MHz' : n + ' kHz';
}

/* ---------------- VFD front-panel replica ---------------- */
function buildVFD(container) {
  container.innerHTML = `
    <div class="vfd">
      <div class="vfd-glass">
        <div class="vfd-row-top">
          <span class="vfd-input" id="vfdInput">STANDBY</span>
          <span class="vfd-vol">
            <span class="lbl">VOL</span>
            <span class="num" id="vfdVolNum">--</span>
            <span class="db" id="vfdVolDb"></span>
          </span>
        </div>
        <div class="vfd-main" id="vfdMainWrap"><span class="scroll-inner" id="vfdMain"></span></div>
        <div class="vfd-ind">
          <span id="indMode"></span>
          <span class="spacer"></span>
          <span id="indNet">NET</span>
          <span id="indUsb">USB</span>
          <span id="indZ2">Z2</span>
          <span id="indZ3">Z3</span>
          <span id="indSleep">SLEEP</span>
          <span id="indMute">MUTING</span>
        </div>
      </div>
    </div>`;
}

let _lastVfdText = '';
function updateVFD(s) {
  const on = s.power;
  const el = (id) => document.getElementById(id);
  if (!el('vfdInput')) return;

  el('vfdInput').textContent = on ? (INPUT_LABEL[s.input] || (s.input ? 'IN ' + s.input : '—')) : 'STANDBY';
  el('vfdVolNum').textContent = on ? (s.mute ? '--' : String(s.volume)) : '';
  el('vfdVolDb').textContent = on && !s.mute ? volDb(s.volume) : '';

  // main line: track info when NET source is playing, else input + mode
  let main = '';
  if (on) {
    const isNet = ['2B', '2E', '29', '2A'].includes(s.input);
    if (isNet && (s.net.title || s.net.artist)) {
      main = [s.net.artist, s.net.title].filter(Boolean).join('  •  ');
    } else if (s.input === '26' && s.tuner) {
      main = fmtTuner(s.tuner);
    } else {
      main = INPUT_LABEL[s.input] || '';
    }
  }
  const mainEl = el('vfdMain');
  if (main !== _lastVfdText) {
    _lastVfdText = main;
    mainEl.textContent = main;
    const wrap = el('vfdMainWrap');
    requestAnimationFrame(() => {
      const overflow = mainEl.scrollWidth - wrap.clientWidth;
      if (overflow > 4) {
        mainEl.style.setProperty('--scroll-dist', `-${overflow + 30}px`);
        wrap.classList.add('scrolling');
      } else {
        wrap.classList.remove('scrolling');
      }
    });
  }

  el('indMode').textContent = on ? (MODE_LABEL[s.mode] || '') : '';
  el('indMode').classList.toggle('on', on && !!MODE_LABEL[s.mode]);
  el('indNet').classList.toggle('on', on && s.input === '2B');
  el('indUsb').classList.toggle('on', on && (s.input === '29' || s.input === '2A'));
  el('indZ2').classList.toggle('on', s.z2.power);
  el('indZ3').classList.toggle('on', s.z3.power);
  el('indSleep').classList.toggle('on', on && s.sleep > 0);
  el('indMute').classList.toggle('on', on && s.mute);
}

/* ---------------- connection LED ---------------- */
const CONN_LABEL = {
  connected: 'ONLINE',
  connecting: 'CONNECTING',
  handshaking: 'HANDSHAKING',
  reconnecting: 'RECONNECTING',
  'no-response': 'NO RESPONSE',
  unreachable: 'UNREACHABLE',
  disconnected: 'OFFLINE',
};

function connLabel(c) {
  const label = CONN_LABEL[c.state] || String(c.state || '').toUpperCase();
  if (c.state === 'no-response' || (c.state === 'reconnecting' && c.retryIn)) {
    return `${label} • RETRY ${c.retryIn}s`;
  }
  return label;
}

function updateConnLed(s) {
  const led = document.getElementById('connLed');
  const txt = document.getElementById('connText');
  if (!led) return;
  const c = s.connection;
  const warn = ['connecting', 'handshaking', 'reconnecting'].includes(c.state);
  const bad = ['no-response', 'unreachable'].includes(c.state);
  led.className = 'led' + (c.state === 'connected' ? ' ok' : (warn ? ' warn' : (bad ? ' bad' : '')));
  const label = connLabel(c);
  txt.textContent = c.ip ? `${label} • ${c.ip}` : label;
}

/* ---------------- NET / Spotify helpers ---------------- */
function parseTime(t) {
  // "mm:ss/mm:ss" or "hh:mm:ss/hh:mm:ss"
  const toSec = (x) => x.split(':').reduce((a, b) => a * 60 + (parseInt(b, 10) || 0), 0);
  const [cur, tot] = (t || '').split('/');
  return { cur: cur ? toSec(cur) : 0, tot: tot ? toSec(tot) : 0, curStr: cur || '', totStr: tot || '' };
}

/* ---------------- demo stub (browser preview outside Electron) ---------------- */
// Synthetic cover for previews and store screenshots — never third-party artwork.
function demoArt() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">',
    '<defs>',
    '<linearGradient id="b" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0" stop-color="#0d2a1c"/><stop offset="0.55" stop-color="#08131b"/>',
    '<stop offset="1" stop-color="#1a0d24"/></linearGradient>',
    '<linearGradient id="s" x1="0" y1="1" x2="1" y2="0">',
    '<stop offset="0" stop-color="#55ff86"/><stop offset="1" stop-color="#4ea1ff"/></linearGradient>',
    '</defs>',
    '<rect width="400" height="400" fill="url(#b)"/>',
    '<g fill="none" stroke="url(#s)" stroke-linecap="round">',
    '<circle cx="200" cy="196" r="112" stroke-opacity="0.20" stroke-width="1.5"/>',
    '<circle cx="200" cy="196" r="76" stroke-opacity="0.32" stroke-width="1.5"/>',
    '<path d="M64 236 Q124 128 200 196 T336 156" stroke-opacity="0.85" stroke-width="3"/>',
    '<path d="M64 268 Q124 168 200 228 T336 196" stroke-opacity="0.45" stroke-width="2"/>',
    '<path d="M64 204 Q124 96 200 164 T336 120" stroke-opacity="0.22" stroke-width="2"/>',
    '</g>',
    '<circle cx="200" cy="196" r="7" fill="#55ff86"/>',
    '<text x="40" y="352" font-family="Segoe UI,sans-serif" font-size="19" font-weight="700"',
    ' letter-spacing="5" fill="#dfe7ec" fill-opacity="0.85">NIGHT CIRCUIT</text>',
    '<text x="40" y="374" font-family="Segoe UI,sans-serif" font-size="11"',
    ' letter-spacing="3.5" fill="#7d9aa8">AURORA FIELD</text>',
    '</svg>',
  ].join('');
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

if (!window.integra) {
  const demoState = {
    connection: { state: 'connected', ip: '192.168.1.120', model: 'DRX-3.4' },
    power: true, volume: 46, maxVolume: 100, mute: false,
    input: '2B', mode: '82',
    bass: 2, treble: 0, swl: 3, ctl: 0,
    dimmer: '00', sleep: 0, hdo: '01', ltn: '00', mot: '01',
    z2: { power: true, volume: 32, mute: false, input: '2B' },
    z3: { power: false, volume: 0, mute: false, input: null },
    tuner: '09790',
    audioInfo: 'NET,Spotify,48 kHz,2.0 ch,,Neural:X,5.1.2 ch',
    videoInfo: '—',
    net: {
      title: 'Neon Cascade', artist: 'Aurora Field', album: 'Night Circuit',
      status: 'P', repeat: '-', shuffle: 'S', time: '2:14/4:03', art: demoArt(),
    },
  };
  window.integra = {
    cmd: (m) => console.log('[demo] cmd', m),
    getState: async () => ({ state: demoState, settings: { ip: '192.168.1.120' } }),
    discover: async () => [{ ip: '192.168.1.120', model: 'DRX-3.4', port: 60128, mac: '00:09:B0:AA:BB:CC' }],
    connect: async () => true,
    reconnect: async () => true,
    onState: () => {}, onDiscovered: () => {},
    win: () => {}, setView: () => {}, miniResize: () => {}, miniPin: () => {},
  };
}
