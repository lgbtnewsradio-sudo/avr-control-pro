/*
 * Renders the app mark to every icon size the installer and the Microsoft
 * Store need. The mark is an original design (machined knob + VFD arc) — it
 * deliberately does not reproduce any manufacturer logo or wordmark.
 *
 *   npx electron tools/icons.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const BUILD = path.join(__dirname, '..', 'build');
const APPX = path.join(BUILD, 'appx');

// s = square edge length used for geometry
function markSvg(s) {
  const c = s / 2;
  const ticks = [];
  for (let i = 0; i <= 32; i++) {
    const a = ((-135 + (270 * i) / 32) - 90) * Math.PI / 180;
    const major = i % 4 === 0;
    const r1 = s * 0.40, r2 = s * (major ? 0.345 : 0.368);
    ticks.push(
      `<line x1="${(c + r1 * Math.cos(a)).toFixed(2)}" y1="${(c + r1 * Math.sin(a)).toFixed(2)}"`
      + ` x2="${(c + r2 * Math.cos(a)).toFixed(2)}" y2="${(c + r2 * Math.sin(a)).toFixed(2)}"`
      + ` stroke="#8ea0ad" stroke-opacity="${major ? 0.55 : 0.22}" stroke-width="${(s * (major ? 0.016 : 0.010)).toFixed(2)}"`
      + ` stroke-linecap="round"/>`
    );
  }
  // indicator sits at ~72% of travel, like a listening volume
  const START = -135, SWEEP = 270, POS = 0.72;
  const END = START + SWEEP * POS;
  const rad = (deg) => (deg - 90) * Math.PI / 180;
  const pt = (deg, r) => [(c + r * Math.cos(rad(deg))).toFixed(2), (c + r * Math.sin(rad(deg))).toFixed(2)];
  const ia = rad(END);
  const arcR = s * 0.325;
  const [ax0, ay0] = pt(START, arcR);
  const [ax1, ay1] = pt(END, arcR);
  const largeArc = SWEEP * POS > 180 ? 1 : 0;
  const levelArc = `M ${ax0} ${ay0} A ${arcR.toFixed(2)} ${arcR.toFixed(2)} 0 ${largeArc} 1 ${ax1} ${ay1}`;
  const [px0, py0] = pt(END, s * 0.085);
  const [px1, py1] = pt(END, s * 0.225);
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a4046"/><stop offset="0.18" stop-color="#242a2e"/>
      <stop offset="1" stop-color="#0e1113"/>
    </linearGradient>
    <radialGradient id="cap" cx="0.38" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#454b51"/><stop offset="0.55" stop-color="#252a2f"/>
      <stop offset="1" stop-color="#111417"/>
    </radialGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="${(s * 0.022).toFixed(2)}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="0" y="0" width="${s}" height="${s}" rx="${(s * 0.21).toFixed(1)}" fill="url(#steel)"/>
  <rect x="${(s * 0.012).toFixed(1)}" y="${(s * 0.012).toFixed(1)}"
        width="${(s * 0.976).toFixed(1)}" height="${(s * 0.976).toFixed(1)}"
        rx="${(s * 0.2).toFixed(1)}" fill="none"
        stroke="#ffffff" stroke-opacity="0.09" stroke-width="${(s * 0.012).toFixed(2)}"/>
  <g>${ticks.join('')}</g>
  <path d="${levelArc}" fill="none" stroke="#55ff86" stroke-opacity="0.9"
        stroke-width="${(s * 0.030).toFixed(2)}" stroke-linecap="round" filter="url(#glow)"/>
  <circle cx="${c}" cy="${c}" r="${(s * 0.255).toFixed(2)}" fill="url(#cap)"
          stroke="#000" stroke-opacity="0.85" stroke-width="${(s * 0.008).toFixed(2)}"/>
  <circle cx="${c}" cy="${(c - s * 0.010).toFixed(2)}" r="${(s * 0.255).toFixed(2)}" fill="none"
          stroke="#ffffff" stroke-opacity="0.14" stroke-width="${(s * 0.008).toFixed(2)}"/>
  <line x1="${px0}" y1="${py0}" x2="${px1}" y2="${py1}" stroke="#55ff86"
        stroke-width="${(s * 0.034).toFixed(2)}" stroke-linecap="round" filter="url(#glow)"/>
</svg>`;
}

function pageHtml(width, height, layout) {
  const inner = layout === 'wide'
    ? `<div style="display:flex;align-items:center;gap:${height * 0.09}px;white-space:nowrap;">
         <div style="width:${height * 0.56}px;height:${height * 0.56}px;flex:none;">${markSvg(256)}</div>
         <div style="font-family:Segoe UI,sans-serif;color:#e8eaec;">
           <div style="font-size:${height * 0.135}px;font-weight:800;letter-spacing:${height * 0.022}px;">AVR CONTROL</div>
           <div style="font-size:${height * 0.058}px;letter-spacing:${height * 0.020}px;color:#7d848b;margin-top:${height * 0.035}px;">NETWORK RECEIVER REMOTE</div>
         </div>
       </div>`
    : `<div style="width:${width}px;height:${height}px;">${markSvg(256)}</div>`;
  const bg = layout === 'square' ? 'transparent'
    : 'linear-gradient(160deg,#1b1f22 0%,#0d0f11 100%)';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${width}px;height:${height}px;background:${bg};
      display:flex;align-items:center;justify-content:center;overflow:hidden;}
    svg{display:block;width:100%;height:100%;}
  </style></head><body>${inner}</body></html>`;
}

// One window reused for every size — creating a second BrowserWindow in the
// same run reliably fails here with ERR_FAILED, and each page paints its own
// background so a single transparent window serves both layouts.
let win = null;

async function render(width, height, layout, out) {
  if (!win) {
    win = new BrowserWindow({
      width, height, show: false, frame: false, useContentSize: true,
      transparent: true, backgroundColor: '#00000000',
      webPreferences: { contextIsolation: true },
    });
  }
  win.setContentSize(width, height);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pageHtml(width, height, layout)));
  await new Promise((r) => setTimeout(r, 350));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  const sz = img.getSize();
  console.log(`${path.relative(path.join(__dirname, '..'), out)}  ${sz.width}x${sz.height}`);
}

const JOBS = [
  [1024, 1024, 'square', path.join(BUILD, 'icon.png')],
  [256, 256, 'square', path.join(BUILD, 'icon-256.png')],
  // Microsoft Store / MSIX tile assets
  [44, 44, 'square', path.join(APPX, 'Square44x44Logo.png')],
  [150, 150, 'square', path.join(APPX, 'Square150x150Logo.png')],
  [310, 310, 'square', path.join(APPX, 'Square310x310Logo.png')],
  [71, 71, 'square', path.join(APPX, 'Square71x71Logo.png')],
  [50, 50, 'square', path.join(APPX, 'StoreLogo.png')],
  [310, 150, 'wide', path.join(APPX, 'Wide310x150Logo.png')],
  [620, 300, 'wide', path.join(APPX, 'SplashScreen.png')],
];

app.whenReady().then(async () => {
  for (const [w, h, layout, out] of JOBS) {
    await render(w, h, layout, out);
  }
  app.exit(0);
});
