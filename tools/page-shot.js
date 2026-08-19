/*
 * Renders docs/index.html at a few scroll positions for visual review.
 *   npx electron tools/page-shot.js [width]
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = process.env.SHOT_OUT || path.join(require('os').tmpdir(), 'page-shots');
const WIDTH = parseInt(process.argv.find((a) => /^\d+$/.test(a)) || '1440', 10);
const HEIGHT = 900;

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: WIDTH, height: HEIGHT, show: false, useContentSize: true,
    backgroundColor: '#08090a', webPreferences: { contextIsolation: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'docs', 'index.html'));
  await new Promise((r) => setTimeout(r, 2600)); // webfonts + animations

  const total = await win.webContents.executeJavaScript('document.body.scrollHeight');
  console.log(`page height ${total}px at ${WIDTH}px wide`);

  const diag = await win.webContents.executeJavaScript(`(() => {
    const over = [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 6)
      .map((el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '')
        + ' → ' + Math.round(el.getBoundingClientRect().right));
    const h1 = document.querySelector('h1').getBoundingClientRect();
    return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
             h1Left: Math.round(h1.left), overflowing: over };
  })()`);
  console.log('DIAG ' + JSON.stringify(diag));

  let i = 0;
  for (let y = 0; y < total; y += HEIGHT) {
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${y})`);
    await new Promise((r) => setTimeout(r, 450));
    const img = await win.webContents.capturePage();
    const f = path.join(OUT, `p${WIDTH}-${String(++i).padStart(2, '0')}.png`);
    fs.writeFileSync(f, img.toPNG());
    console.log(f);
  }
  app.exit(0);
});
