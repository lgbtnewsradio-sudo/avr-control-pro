/*
 * Measures whether icon glyphs and the volume knob actually sit on their
 * centres, rather than judging by eye.
 *
 *   npx electron tools/centring.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 940, show: false, frame: false, useContentSize: true,
    backgroundColor: '#0b0c0d',
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'full.html'));
  await new Promise((r) => setTimeout(r, 1300));

  const glyphs = await win.webContents.executeJavaScript(`(() => {
    const out = [];
    const sels = ['#btnPlayPause', '[data-cmd="NTCTRDN"]', '[data-cmd="NTCTRUP"]',
                  '[data-cmd="OSDUP"]', '#z2Power'];
    for (const sel of sels) {
      const b = document.querySelector(sel);
      if (!b) continue;
      const r = document.createRange();
      r.selectNodeContents(b);
      const g = r.getBoundingClientRect(), box = b.getBoundingClientRect();
      out.push({
        sel,
        letterSpacing: getComputedStyle(b).letterSpacing,
        dx: +(((g.left + g.right) / 2) - ((box.left + box.right) / 2)).toFixed(2),
        dy: +(((g.top + g.bottom) / 2) - ((box.top + box.bottom) / 2)).toFixed(2),
      });
    }
    return out;
  })()`);

  console.log('\\nicon glyph offset from button centre (px, want ~0):');
  glyphs.forEach((g) =>
    console.log('  ' + g.sel.padEnd(22) + 'dx=' + String(g.dx).padStart(6) +
                '  dy=' + String(g.dy).padStart(6) + '   letter-spacing=' + g.letterSpacing));

  const knob = await win.webContents.executeJavaScript(`(() => {
    const ring = document.querySelector('.knob-ring');
    const cv = ring.querySelector('canvas');
    const k = document.getElementById('volKnob');
    const c = (el) => { const r = el.getBoundingClientRect();
      return { cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, w: r.width, h: r.height }; };
    const R = c(ring), C = c(cv), K = c(k);
    return {
      ring: { w: R.w, h: R.h },
      canvas: { w: C.w, h: C.h, dx: +(C.cx - R.cx).toFixed(2), dy: +(C.cy - R.cy).toFixed(2) },
      knob: { w: K.w, h: K.h, dx: +(K.cx - R.cx).toFixed(2), dy: +(K.cy - R.cy).toFixed(2) },
      capInset: getComputedStyle(k, '::before').inset,
      highlight: getComputedStyle(k).backgroundImage.includes('38%') ? '38% 32% (off-centre by design)' : 'n/a',
    };
  })()`);

  console.log('\\nvolume knob geometry (dx/dy = offset from the tick-ring centre):');
  console.log('  ring   ' + knob.ring.w + 'x' + knob.ring.h);
  console.log('  canvas ' + knob.canvas.w + 'x' + knob.canvas.h + '  dx=' + knob.canvas.dx + ' dy=' + knob.canvas.dy);
  console.log('  knob   ' + knob.knob.w + 'x' + knob.knob.h + '  dx=' + knob.knob.dx + ' dy=' + knob.knob.dy);
  console.log('  cap inset ' + knob.capInset);
  console.log('  specular highlight ' + knob.highlight);

  app.exit(0);
});
