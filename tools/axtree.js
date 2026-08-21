/*
 * Dumps the accessibility tree Chromium exposes to the platform — the same
 * computed names, roles and values that Narrator reads through UI Automation.
 *
 *   npx electron tools/axtree.js [full|mini]
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const which = process.argv.find((a) => a === 'mini') ? 'mini' : 'full';
const FILE = path.join(__dirname, '..', 'renderer', `${which}.html`);

const SKIP_ROLES = new Set(['none', 'generic', 'InlineTextBox', 'StaticText', 'LineBreak']);

app.commandLine.appendSwitch('force-renderer-accessibility');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: which === 'mini' ? 480 : 1440, height: which === 'mini' ? 620 : 940,
    show: false, frame: false, useContentSize: true, backgroundColor: '#0b0c0d',
  });
  await win.loadFile(FILE);
  await new Promise((r) => setTimeout(r, 1500));

  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Accessibility.enable');
  const { nodes } = await win.webContents.debugger.sendCommand('Accessibility.getFullAXTree');

  const val = (p) => (p && p.value !== undefined ? p.value : '');
  const rows = [];
  for (const n of nodes) {
    if (n.ignored) continue;
    const role = val(n.role);
    const name = String(val(n.name) || '').replace(/\s+/g, ' ').trim();
    if (SKIP_ROLES.has(role)) continue;
    if (!name && !['slider', 'image', 'combobox', 'button'].includes(role)) continue;
    const props = {};
    for (const p of n.properties || []) {
      if (['valuetext', 'valuemin', 'valuemax', 'invalid', 'disabled', 'live', 'pressed', 'checked']
          .includes(p.name)) props[p.name] = val(p.value);
    }
    const v = val(n.value);
    rows.push({ role, name, value: v, props });
  }

  console.log(`\n===== ${which.toUpperCase()} VIEW — accessibility tree =====\n`);
  for (const r of rows) {
    const extra = Object.entries(r.props).filter(([, v]) => v !== '' && v !== false)
      .map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`[${r.role}] "${r.name}"${r.value ? ` value="${r.value}"` : ''}${extra ? '  {' + extra + '}' : ''}`);
  }
  console.log(`\ntotal exposed nodes: ${rows.length}`);

  const unnamed = rows.filter((r) => !r.name && ['button', 'slider', 'combobox', 'image'].includes(r.role));
  console.log(`controls with NO accessible name: ${unnamed.length}`);
  unnamed.forEach((r) => console.log(`  [${r.role}] (unnamed)`));

  app.exit(0);
});
