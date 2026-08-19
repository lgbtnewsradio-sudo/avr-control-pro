/*
 * Screenshot harness for docs/store assets.
 * Loads the real renderer HTML with no preload, so the demo stub in shared.js
 * supplies showcase state (synthetic cover art, never third-party artwork).
 *
 *   npx electron tools/shot.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const RENDERER = path.join(__dirname, '..', 'renderer');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// JS expressions that report the natural pixel height of each view
const MEASURE = {
  full: '(() => { const c = document.querySelector(".content");'
      + ' return Math.ceil(document.querySelector(".titlebar").offsetHeight + c.scrollHeight + 2); })()',
  mini: 'Math.ceil(document.querySelector(".mini-app").getBoundingClientRect().height)',
};

async function shot(file, width, height, out, { autoHeight = false } = {}) {
  const win = new BrowserWindow({
    width, height, show: false, frame: false, useContentSize: true,
    backgroundColor: '#0b0c0d',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(RENDERER, file));
  await wait(1400); // let fonts, canvas ticks and the VFD marquee settle

  if (autoHeight) {
    const h = await win.webContents.executeJavaScript(MEASURE[autoHeight]);
    win.setContentSize(width, h);
    await wait(600);
  }

  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  const { width: w, height: hh } = img.getSize();
  console.log(`${path.basename(out)}  ${w}x${hh}`);
  win.destroy();
}

// One view per process run — loading a second window in the same run
// intermittently fails with ERR_FAILED.
const TARGETS = {
  full: () => shot('full.html', 1440, 940, path.join(OUT, 'full-view.png'), { autoHeight: 'full' }),
  mini: () => shot('mini.html', 480, 620, path.join(OUT, 'mini-view.png'), { autoHeight: 'mini' }),
};

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const which = process.argv.find((a) => TARGETS[a]) || 'full';
  try {
    await TARGETS[which]();
    app.exit(0);
  } catch (e) {
    console.error('shot failed:', e.message);
    app.exit(1);
  }
});
