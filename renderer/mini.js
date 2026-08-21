/* Mini view controller */

buildVFD(document.getElementById('vfdHost'));

let S = null;
let pinned = true;
let collapsed = false;

document.querySelectorAll('[data-cmd]').forEach((b) =>
  b.addEventListener('click', () => cmd(b.dataset.cmd)));

document.getElementById('wClose').onclick = () => window.integra.win('close');
document.getElementById('btnFull').onclick = () => window.integra.setView('full');
document.getElementById('btnPower').onclick = () => cmd(S && S.power ? 'PWR00' : 'PWR01');
document.getElementById('btnMute').onclick = () => cmd('AMTTG');
document.getElementById('btnPlayPause').onclick = () =>
  cmd(S && S.net.status === 'P' ? 'NTCPAUSE' : 'NTCPLAY');

const btnPin = document.getElementById('btnPin');
btnPin.classList.add('on');
btnPin.onclick = () => {
  pinned = !pinned;
  btnPin.classList.toggle('on', pinned);
  window.integra.miniPin(pinned);
};

function fitWindow() {
  requestAnimationFrame(() => {
    const h = document.getElementById('miniApp').getBoundingClientRect().height;
    window.integra.miniResize(h + 2);
  });
}
document.getElementById('btnCollapse').onclick = () => {
  collapsed = !collapsed;
  document.getElementById('miniApp').classList.toggle('collapsed', collapsed);
  fitWindow();
};

/* input select */
const mInput = document.getElementById('mInput');
mInput.innerHTML = INPUTS.map((i) => `<option value="${i.code}">${i.label}</option>`).join('');
mInput.onchange = () => cmd('SLI' + mInput.value);

/* volume slider */
const mVol = document.getElementById('mVol');
let volT = null;
let volDragging = false;
mVol.addEventListener('pointerdown', () => { volDragging = true; });
mVol.addEventListener('pointerup', () => { volDragging = false; });
mVol.addEventListener('input', () => {
  document.getElementById('mVolNum').textContent =
    fmtVol(+mVol.value, S ? mainScale(S).step : 1);
  clearTimeout(volT);
  volT = setTimeout(() => cmd('MVL' + h2(+mVol.value)), 100);
});

function render(s) {
  S = s;
  updateVFD(s);

  updateConnLed(s);
  document.getElementById('connLed').title = connLabel(s.connection);

  document.getElementById('btnPower').classList.toggle('power-on', s.power);
  document.getElementById('btnMute').classList.toggle('active', s.mute);
  const step = mainScale(s).step;
  if (+mVol.max !== mainScale(s).maxRaw) mVol.max = mainScale(s).maxRaw;
  document.getElementById('mVolNum').textContent = s.power ? fmtVol(s.volume, step) : '--';
  if (!volDragging) mVol.value = s.volume;
  if (s.input) mInput.value = s.input;

  const n = s.net;
  const showPlayer = s.input === '2B' || s.input === '2E' || !!n.title;
  document.getElementById('miniPlayer').classList.toggle('show', showPlayer);
  document.getElementById('mSvc').textContent = s.input === '2E' ? 'BLUETOOTH' : 'SPOTIFY CONNECT';
  document.getElementById('mTitle').textContent = n.title || '—';
  document.getElementById('mArtist').textContent = n.artist || '';
  const art = document.getElementById('mArt');
  if (n.art) {
    if (!art.dataset.src || art.dataset.src !== n.art) {
      art.dataset.src = n.art;
      art.innerHTML = '';
      art.removeAttribute('aria-hidden'); // the <img> alt now carries the meaning
      const im = new Image();
      im.alt = [n.title, n.artist].filter(Boolean).length
        ? `Cover art: ${[n.title, n.artist].filter(Boolean).join(' by ')}` : 'Album cover art';
      im.onerror = () => { art.innerHTML = '&#x266B;'; }; // keep dataset.src so the failed URL isn't retried
      im.src = n.art;
      art.appendChild(im);
    }
  } else if (art.dataset.src) {
    art.innerHTML = '&#x266B;';           // placeholder glyph, nothing to announce
    art.setAttribute('aria-hidden', 'true');
    delete art.dataset.src;
  }
  document.getElementById('btnPlayPause').innerHTML = n.status === 'P' ? '&#x23F8;' : '&#x25B6;';
  document.getElementById('btnShuffle').classList.toggle('active', n.shuffle !== '-' && !!n.shuffle);
  document.getElementById('btnRepeat').classList.toggle('active', n.repeat !== '-' && !!n.repeat);
  const t = parseTime(n.time);
  document.getElementById('mFill').style.width = t.tot ? (100 * t.cur / t.tot) + '%' : '0%';

  fitWindow();
}

window.integra.onState(render);
window.integra.getState().then(({ state, settings }) => {
  pinned = settings.miniPinned !== false;
  btnPin.classList.toggle('on', pinned);
  render(state);
});
