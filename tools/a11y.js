/*
 * Accessibility audit against the real renderer.
 *
 * Runs axe-core (WCAG 2.1/2.2 A + AA) inside the actual pages, plus checks axe
 * can't make on its own: keyboard operability of the custom volume knob,
 * pointer target sizes, focus-visible styling, and reduced-motion support.
 *
 *   npm run a11y
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const RENDERER = path.join(__dirname, '..', 'renderer');
const DOCS = path.join(__dirname, '..', 'docs');

const PAGES = [
  { name: 'full view', file: path.join(RENDERER, 'full.html'), w: 1440, h: 940 },
  { name: 'mini view', file: path.join(RENDERER, 'mini.html'), w: 480, h: 620 },
  { name: 'landing page', file: path.join(DOCS, 'index.html'), w: 1280, h: 900 },
];

// Contrast maths — axe reports "incomplete" wherever a gradient sits behind
// text, which is most of this UI, so the key pairs are checked directly.
const CUSTOM = `(() => {
  const hex = (c) => {
    const m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };

  // sample the painted pixel behind an element by walking ancestors for a solid
  // colour, falling back to the page background
  const bgOf = (el) => {
    let n = el, gradient = false;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      // a gradient means the sampled colour isn't what's actually painted
      if (cs.backgroundImage && cs.backgroundImage !== 'none') gradient = true;
      const c = hex(cs.backgroundColor);
      const a = cs.backgroundColor.match(/rgba\\([^)]*,\\s*([\\d.]+)\\)/);
      if (c && (!a || parseFloat(a[1]) > 0.55)) return { c, gradient };
      n = n.parentElement;
    }
    return { c: hex(getComputedStyle(document.body).backgroundColor) || [11, 12, 13], gradient };
  };

  const textIssues = [];
  const uncertain = [];
  const seen = new Set();
  document.querySelectorAll('*').forEach((el) => {
    const kids = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!kids.length) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const fg = hex(cs.color);
    if (!fg) return;
    const size = parseFloat(cs.fontSize);
    const bold = +cs.fontWeight >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const bg = bgOf(el);
    const got = ratio(fg, bg.c);
    const label = (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName.toLowerCase());
    const key = label + '|' + cs.color + '|' + Math.round(size);
    if (got < need && !seen.has(key)) {
      seen.add(key);
      // a gradient behind the text means the sampled colour isn't what's painted
      const rect = { x: r.left, y: r.top, w: r.width, h: r.height };
      (bg.gradient ? uncertain : textIssues).push({ el: label,
        text: kids[0].textContent.trim().slice(0, 24), fg,
        color: cs.color, px: size, ratio: +got.toFixed(2), needs: need, rect });
    }
  });

  // WCAG 2.2 target size (minimum) is 24x24 CSS px
  const small = [];
  document.querySelectorAll('button, [role="button"], input[type="range"], select, a').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (r.width < 24 || r.height < 24) {
      small.push({ el: el.id || el.className || el.tagName, w: Math.round(r.width), h: Math.round(r.height),
        label: (el.textContent || '').trim().slice(0, 16) });
    }
  });

  // does anything define a visible focus style?
  let focusRules = 0, reducedMotion = 0;
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const rule of rules) {
      if (rule.selectorText && /:focus/.test(rule.selectorText)) focusRules++;
      if (rule.conditionText && /prefers-reduced-motion/.test(rule.conditionText)) reducedMotion++;
    }
  }

  // custom controls that take pointer input but may not take keyboard input
  const customControls = [...document.querySelectorAll('.knob')].map((el) => ({
    el: el.id || el.className,
    tabindex: el.getAttribute('tabindex'),
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    keyboardReachable: el.tabIndex >= 0,
  }));

  const imgsNoAlt = [...document.images].filter((i) => !i.hasAttribute('alt'))
    .map((i) => i.id || i.className || 'img');

  return {
    lang: document.documentElement.getAttribute('lang'),
    contrastFailures: textIssues.sort((a, b) => a.ratio - b.ratio),
    contrastUncertain: uncertain.sort((a, b) => a.ratio - b.ratio),
    smallTargets: small,
    focusRules, reducedMotion, customControls, imgsNoAlt,
  };
})()`;

// One window reused for every page — a second BrowserWindow in the same run
// fails with ERR_FAILED on this toolchain.
let win = null;

async function audit(page) {
  if (!win) {
    win = new BrowserWindow({
      width: page.w, height: page.h, show: false, frame: false, useContentSize: true,
      backgroundColor: '#0b0c0d', webPreferences: { contextIsolation: true },
    });
  }
  win.setContentSize(page.w, page.h);
  await win.loadFile(page.file);
  await new Promise((r) => setTimeout(r, 1200));

  await win.webContents.executeJavaScript(AXE);
  const axeRes = await win.webContents.executeJavaScript(
    `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] } })
       .then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length,
         sample: v.nodes.slice(0,3).map(n => n.target.join(' ')) })))`
  );
  const custom = await win.webContents.executeJavaScript(CUSTOM);

  // Press Tab for real — :focus-visible only matches keyboard-initiated focus,
  // so a programmatic .focus() would not prove the ring actually appears.
  win.webContents.focus();
  for (let i = 0; i < 3; i++) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '	' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await new Promise((r) => setTimeout(r, 120));
  }
  custom.focusProof = await win.webContents.executeJavaScript(`(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return { el: 'none' };
    const cs = getComputedStyle(a);
    return { el: a.tagName.toLowerCase() + (a.id ? '#' + a.id : ''),
             outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
             visible: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1 };
  })()`);

  /*
   * Anything sitting on a gradient can't be resolved from computed styles, so
   * sample the rendered frame: take the most common colour inside the element's
   * box, which is its background rather than its glyphs.
   */
  if (custom.contrastUncertain.length) {
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    };

    for (let idx = 0; idx < custom.contrastUncertain.length; idx++) {
      const item = custom.contrastUncertain[idx];
      // Bring the element fully into view first — sampling a element that is
      // half below the fold measures its border, not its background.
      const rect = await win.webContents.executeJavaScript(`(() => {
        const els = [...document.querySelectorAll('*')].filter((e) => {
          const r = e.getBoundingClientRect();
          return Math.round(r.width) === ${Math.round(item.rect.w)} &&
                 Math.round(r.height) === ${Math.round(item.rect.h)} &&
                 getComputedStyle(e).color === ${JSON.stringify(item.color)};
        });
        if (!els.length) return null;
        els[0].scrollIntoView({ block: 'center' });
        const r = els[0].getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      })()`);
      if (!rect) continue;
      await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      await new Promise((r) => setTimeout(r, 250));

      const img = await win.webContents.capturePage();
      const dip = img.getSize();
      const bmp = img.toBitmap();       // BGRA at device scale
      const scale = Math.sqrt(bmp.length / 4 / (dip.width * dip.height));
      const bw = Math.round(dip.width * scale), bh = Math.round(dip.height * scale);

      const counts = new Map();
      const x0 = Math.round(rect.x * scale), y0 = Math.round(rect.y * scale);
      const w = Math.round(rect.w * scale), h = Math.round(rect.h * scale);
      // inset past the border so only the fill is sampled
      const pad = Math.max(2, Math.round(3 * scale));
      for (let y = y0 + pad; y < y0 + h - pad; y++) {
        for (let x = x0 + pad; x < x0 + w - pad; x++) {
          if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
          const i = (y * bw + x) * 4;
          const key = `${bmp[i + 2]},${bmp[i + 1]},${bmp[i]}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
      let best = null, bestN = 0;
      for (const [k, n] of counts) if (n > bestN) { bestN = n; best = k; }
      if (!best) continue;
      item.sampledBg = best;
      item.measured = +ratio(item.fg, best.split(',').map(Number)).toFixed(2);
      item.passes = item.measured >= item.needs;
    }
  }
  return { axeRes, custom };
}

app.whenReady().then(async () => {
  for (const page of PAGES) {
    const { axeRes, custom } = await audit(page);
    console.log(`\n${'='.repeat(66)}\n${page.name.toUpperCase()}  (${page.w}x${page.h})\n${'='.repeat(66)}`);

    console.log(`lang="${custom.lang}"  focus-rules=${custom.focusRules}  reduced-motion-blocks=${custom.reducedMotion}`);

    console.log(`\naxe violations: ${axeRes.length}`);
    axeRes.forEach((v) => console.log(`  [${v.impact}] ${v.id} (${v.n}) — ${v.help}\n      ${v.sample.join(' | ')}`));

    console.log(`\ncontrast below AA: ${custom.contrastFailures.length}`);
    custom.contrastFailures.slice(0, 12).forEach((c) =>
      console.log(`  ${c.ratio}:1 (needs ${c.needs}) ${c.el} ${c.px}px "${c.text}" ${c.color}`));

    const grad = custom.contrastUncertain;
    const gradFail = grad.filter((c) => c.passes === false);
    console.log(`\ncontrast on gradients (measured from rendered pixels): ${grad.length} checked, ${gradFail.length} failing`);
    grad.slice(0, 8).forEach((c) => console.log(
      `  ${c.passes === undefined ? '?' : (c.passes ? 'PASS' : 'FAIL')} ` +
      `${c.measured != null ? c.measured : c.ratio}:1 (needs ${c.needs}) ` +
      `${c.el} ${c.px}px "${c.text}" on rgb(${c.sampledBg})`));

    console.log(`\ntargets under 24x24: ${custom.smallTargets.length}`);
    custom.smallTargets.slice(0, 10).forEach((t) => console.log(`  ${t.w}x${t.h} ${t.el} "${t.label}"`));

    if (custom.customControls.length) {
      console.log(`\ncustom controls:`);
      custom.customControls.forEach((c) => console.log(`  ${c.el} keyboard=${c.keyboardReachable} role=${c.role} label=${c.ariaLabel}`));
    }
    console.log(`
keyboard focus ring: ${custom.focusProof.el} -> ${custom.focusProof.outline || 'n/a'} ` +
      `(${custom.focusProof.visible ? 'VISIBLE' : 'NOT VISIBLE'})`);
    if (custom.imgsNoAlt.length) console.log(`\nimages without alt: ${custom.imgsNoAlt.join(', ')}`);
  }
  app.exit(0);
});
