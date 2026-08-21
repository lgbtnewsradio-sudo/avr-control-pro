/* Full-size view controller */

buildVFD(document.getElementById('vfdHost'));

let S = null;          // latest receiver state
let progTimer = null;  // local progress ticker between NTM updates
let prog = { cur: 0, tot: 0 };

/* ---------------- static wiring ---------------- */
document.querySelectorAll('[data-cmd]').forEach((b) =>
  b.addEventListener('click', () => cmd(b.dataset.cmd)));

document.getElementById('wMin').onclick = () => window.integra.win('min');
document.getElementById('wMax').onclick = () => window.integra.win('max');
document.getElementById('wClose').onclick = () => window.integra.win('close');
document.getElementById('btnMini').onclick = () => window.integra.setView('mini');

document.getElementById('btnPower').onclick = () => cmd(S && S.power ? 'PWR00' : 'PWR01');
document.getElementById('btnAllOff').onclick = () => { cmd('PWR00'); cmd('ZPW00'); cmd('PW300'); };
document.getElementById('btnMute').onclick = () => cmd('AMTTG');
document.getElementById('btnPlayPause').onclick = () =>
  cmd(S && S.net.status === 'P' ? 'NTCPAUSE' : 'NTCPLAY');
document.getElementById('btnRefresh').onclick = () =>
  ['PWRQSTN','MVLQSTN','AMTQSTN','SLIQSTN','LMDQSTN','TFRQSTN','SWLQSTN','CTLQSTN','DIMQSTN','SLPQSTN',
   'HDOQSTN','LTNQSTN','MOTQSTN','ZPWQSTN','ZVLQSTN','ZMTQSTN','SLZQSTN','PW3QSTN','VL3QSTN','MT3QSTN',
   'SL3QSTN','TUNQSTN','IFAQSTN','IFVQSTN','NTIQSTN','NATQSTN','NALQSTN','NSTQSTN','NTMQSTN','NJAREQ']
    .forEach((q) => cmd(q));

/* input + mode grids */
const inputGrid = document.getElementById('inputGrid');
INPUTS.forEach((i) => {
  const b = document.createElement('button');
  b.className = 'btn'; b.textContent = i.label; b.dataset.input = i.code;
  b.onclick = () => cmd('SLI' + i.code);
  inputGrid.appendChild(b);
});
const modeGrid = document.getElementById('modeGrid');
MODES.forEach((m) => {
  const b = document.createElement('button');
  b.className = 'btn'; b.textContent = m.label; b.dataset.mode = m.code;
  b.onclick = () => cmd('LMD' + m.code);
  modeGrid.appendChild(b);
});

/* zone selects */
for (const z of ['z2', 'z3']) {
  const sel = document.getElementById(z + 'Input');
  sel.innerHTML = '<option value="">SOURCE…</option>' +
    INPUTS.map((i) => `<option value="${i.code}">${i.label}</option>`).join('');
}

/* toggles that cycle receiver-side */
document.getElementById('tglDim').onclick = () => cmd('DIMDIM');
document.getElementById('tglHdo').onclick = () => cmd('HDOUP');
document.getElementById('tglLtn').onclick = () => cmd('LTNUP');
document.getElementById('tglMot').onclick = () => cmd(S && S.mot === '01' ? 'MOT00' : 'MOT01');
document.getElementById('tglSlp').onclick = () => {
  const cur = S ? S.sleep : 0;
  const steps = [0, 30, 60, 90];
  const next = steps[(steps.indexOf(cur) + 1) % steps.length] ?? 30;
  cmd(next === 0 ? 'SLPOFF' : 'SLP' + h2(next));
};

/* sliders — send on release/input with light debounce */
function bindSlider(id, send, fmt) {
  const el = document.getElementById(id);
  const val = document.getElementById(id + 'Val');
  let t = null;
  el.addEventListener('input', () => {
    val.textContent = fmt ? fmt(+el.value) : el.value;
    clearTimeout(t);
    t = setTimeout(() => send(+el.value), 120);
  });
  return el;
}
const halfDb = (v) => (v / 2).toFixed(1);
bindSlider('adjBass', (v) => cmd('TFRB' + signed(v)), halfDb);
bindSlider('adjTreble', (v) => cmd('TFRT' + signed(v)), halfDb);
bindSlider('adjSwl', (v) => cmd('SWL' + signed(v)), halfDb);
bindSlider('adjCtl', (v) => cmd('CTL' + signed(v)), halfDb);
bindSlider('z2Vol', (v) => cmd('ZVL' + h2(v)));
bindSlider('z3Vol', (v) => cmd('VL3' + h2(v)));

/* zone controls */
document.getElementById('z2Power').onclick = () => cmd(S && S.z2.power ? 'ZPW00' : 'ZPW01');
document.getElementById('z3Power').onclick = () => cmd(S && S.z3.power ? 'PW300' : 'PW301');
document.getElementById('z2Mute').onclick = () => cmd('ZMTTG');
document.getElementById('z3Mute').onclick = () => cmd('MT3TG');
document.getElementById('z2Input').onchange = (e) => e.target.value && cmd('SLZ' + e.target.value);
document.getElementById('z3Input').onchange = (e) => e.target.value && cmd('SL3' + e.target.value);

/* ---------------- volume knob ---------------- */
const knob = document.getElementById('volKnob');
const knobDot = document.getElementById('knobDot');
// Knob spans silence to 0 dB. Expressed in raw steps, so it follows whatever
// resolution the receiver reported rather than assuming whole-dB units.
let MAXV = 82;
const A0 = -135, A1 = 135;
function setKnobRange(step) { MAXV = Math.round(ZERO_DB_ABS / (step || 1)); }

(function drawTicks() {
  const c = document.getElementById('tickRing').getContext('2d');
  c.clearRect(0, 0, 196, 196);
  for (let i = 0; i <= 40; i++) {
    const a = ((A0 + (A1 - A0) * (i / 40)) - 90) * Math.PI / 180;
    const r1 = 90, r2 = i % 5 === 0 ? 82 : 86;
    c.strokeStyle = i % 5 === 0 ? 'rgba(199,204,209,0.5)' : 'rgba(199,204,209,0.18)';
    c.lineWidth = i % 5 === 0 ? 2 : 1;
    c.beginPath();
    c.moveTo(98 + r1 * Math.cos(a), 98 + r1 * Math.sin(a));
    c.lineTo(98 + r2 * Math.cos(a), 98 + r2 * Math.sin(a));
    c.stroke();
  }
})();

function knobAngleFor(vol) { return A0 + (A1 - A0) * Math.min(1, Math.max(0, vol / MAXV)); }
function setKnob(vol) { knobDot.style.transform = `rotate(${knobAngleFor(vol)}deg) translateY(-66px)`; }

let dragging = false;
function volFromEvent(e) {
  const r = knob.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2);
  const dy = e.clientY - (r.top + r.height / 2);
  let ang = Math.atan2(dx, -dy) * 180 / Math.PI; // 0 = up
  ang = Math.max(A0, Math.min(A1, ang));
  return Math.round(((ang - A0) / (A1 - A0)) * MAXV);
}
let volSendT = null;
knob.addEventListener('pointerdown', (e) => { dragging = true; knob.setPointerCapture(e.pointerId); });
knob.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const v = volFromEvent(e);
  const step = S ? mainScale(S).step : 1;
  setKnob(v);
  document.getElementById('volNum').textContent = fmtVol(v, step);
  document.getElementById('volDb').textContent = volDb(v, step);
  clearTimeout(volSendT);
  volSendT = setTimeout(() => cmd('MVL' + h2(v)), 80);
});
knob.addEventListener('pointerup', () => { dragging = false; });
knob.addEventListener('wheel', (e) => {
  e.preventDefault();
  cmd(e.deltaY < 0 ? 'MVLUP' : 'MVLDOWN');
}, { passive: false });

/* ---------------- connection panel ---------------- */
async function runDiscovery() {
  const list = document.getElementById('discList');
  list.innerHTML = '<span class="muted" style="font-size:11px;">Scanning network…</span>';
  const devices = await window.integra.discover();
  renderDiscovered(devices);
}
function renderDiscovered(devices) {
  const list = document.getElementById('discList');
  if (!devices || !devices.length) {
    list.innerHTML = '<span class="muted" style="font-size:11px;">No receivers found. Check the network or use manual IP.</span>';
    return;
  }
  list.innerHTML = '';
  devices.forEach((d) => {
    const el = document.createElement('div');
    el.className = 'disc-item';
    el.innerHTML = `<span class="m">${esc(d.model)}</span><span class="ip">${esc(d.ip)}</span>`;
    el.onclick = () => window.integra.connect({ ip: d.ip, port: d.port, mode: 'auto', model: d.model });
    list.appendChild(el);
  });
}
document.getElementById('btnDiscover').onclick = runDiscovery;
document.getElementById('btnReconnect').onclick = () => window.integra.reconnect();
document.getElementById('btnConnect').onclick = () => {
  const ip = document.getElementById('manualIp').value.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) window.integra.connect({ ip, mode: 'manual' });
};
window.integra.onDiscovered(renderDiscovered);

/* ---------------- render ---------------- */
function setSliderIfIdle(id, v, fmt) {
  const el = document.getElementById(id);
  if (document.activeElement !== el) {
    el.value = v;
    document.getElementById(id + 'Val').textContent = fmt ? fmt(v) : v;
  }
}

function render(s) {
  S = s;
  updateVFD(s);
  updateConnLed(s);
  document.getElementById('brandModel').textContent =
    s.connection.model ? '·  ' + s.connection.model : '';

  const on = s.power;
  document.getElementById('btnPower').classList.toggle('power-on', on);
  document.getElementById('btnMute').classList.toggle('active', s.mute);

  const step = mainScale(s).step;
  setKnobRange(step);
  document.getElementById('volNum').textContent = on ? fmtVol(s.volume, step) : '--';
  document.getElementById('volDb').textContent = on ? volDb(s.volume, step) : '';
  if (!dragging) setKnob(s.volume);

  inputGrid.querySelectorAll('.btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.input === s.input));
  modeGrid.querySelectorAll('.btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === s.mode));

  /* NET / Spotify */
  const n = s.net;
  const isNet = s.input === '2B';
  document.getElementById('svcBadge').style.display = isNet && (n.title || n.artist) ? '' : 'none';
  document.getElementById('ntTitle').textContent = n.title || '—';
  document.getElementById('ntArtist').textContent = n.artist || '';
  document.getElementById('ntAlbum').textContent = n.album || '';
  const img = document.getElementById('artImg');
  const ph = document.getElementById('artPh');
  img.onerror = () => { img.dataset.failed = img.src; img.style.display = 'none'; ph.style.display = ''; };
  if (n.art && n.art !== img.dataset.failed) {
    if (img.src !== n.art) img.src = n.art;
    img.style.display = ''; ph.style.display = 'none';
  } else {
    img.style.display = 'none'; ph.style.display = '';
  }
  document.getElementById('btnPlayPause').innerHTML = n.status === 'P' ? '&#x23F8;' : '&#x25B6;';
  document.getElementById('btnShuffle').classList.toggle('active', n.shuffle !== '-' && !!n.shuffle);
  document.getElementById('btnRepeat').classList.toggle('active', n.repeat !== '-' && !!n.repeat);

  const t = parseTime(n.time);
  prog = { cur: t.cur, tot: t.tot };
  document.getElementById('tCur').textContent = t.curStr;
  document.getElementById('tTot').textContent = t.totStr;
  document.getElementById('tFill').style.width = t.tot ? (100 * t.cur / t.tot) + '%' : '0%';
  clearInterval(progTimer);
  if (n.status === 'P' && t.tot) {
    progTimer = setInterval(() => {
      prog.cur = Math.min(prog.tot, prog.cur + 1);
      document.getElementById('tFill').style.width = (100 * prog.cur / prog.tot) + '%';
      const m = Math.floor(prog.cur / 60), sec = String(prog.cur % 60).padStart(2, '0');
      document.getElementById('tCur').textContent = `${m}:${sec}`;
    }, 1000);
  }

  /* zones */
  document.getElementById('z2Power').classList.toggle('power-on', s.z2.power);
  document.getElementById('z3Power').classList.toggle('power-on', s.z3.power);
  document.getElementById('z2Mute').classList.toggle('active', s.z2.mute);
  document.getElementById('z3Mute').classList.toggle('active', s.z3.mute);
  for (const z of ['z2', 'z3']) {
    const zs = zoneScale(s, z);
    const el = document.getElementById(z + 'Vol');
    if (+el.max !== zs.maxRaw) el.max = zs.maxRaw;
    setSliderIfIdle(z + 'Vol', s[z].volume, (v) => fmtVol(v, zs.step));
  }
  if (s.z2.input) document.getElementById('z2Input').value = s.z2.input;
  if (s.z3.input) document.getElementById('z3Input').value = s.z3.input;

  /* audio adjust */
  setSliderIfIdle('adjBass', s.bass, halfDb);
  setSliderIfIdle('adjTreble', s.treble, halfDb);
  setSliderIfIdle('adjSwl', s.swl, halfDb);
  setSliderIfIdle('adjCtl', s.ctl, halfDb);
  document.getElementById('dimVal').textContent = DIM_LABEL[s.dimmer] || s.dimmer;
  document.getElementById('hdoVal').textContent = HDO_LABEL[s.hdo] || s.hdo;
  document.getElementById('ltnVal').textContent = LTN_LABEL[s.ltn] || s.ltn;
  document.getElementById('motVal').textContent = s.mot === '01' ? 'ON' : 'OFF';
  document.getElementById('slpVal').textContent = s.sleep ? s.sleep + ' MIN' : 'OFF';
  document.getElementById('infoAudio').textContent = s.audioInfo || '—';
  document.getElementById('infoVideo').textContent = s.videoInfo || '—';
  document.getElementById('tunerFreq').textContent = fmtTuner(s.tuner) || '—';
  const detail = document.getElementById('connDetail');
  detail.textContent = `${connLabel(s.connection)}${s.connection.ip ? ' @ ' + s.connection.ip : ''}`;
  detail.className = ['no-response', 'unreachable'].includes(s.connection.state) ? 'bad'
    : (['connecting', 'handshaking', 'reconnecting'].includes(s.connection.state) ? 'warn' : '');
  // Repeated mute handshakes mean the receiver itself needs a power cycle —
  // say so instead of leaving the user watching a retry counter.
  document.getElementById('connHint').style.display =
    (s.connection.state === 'no-response' && s.connection.attempt >= 2) ? '' : 'none';

  const manual = document.getElementById('manualIp');
  if (!manual.value && s.connection.ip) manual.value = s.connection.ip;
}

window.integra.onState(render);
window.integra.getState().then(({ state }) => render(state));
