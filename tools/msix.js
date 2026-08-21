/*
 * Builds the Microsoft Store package (.msix).
 *
 * electron-builder stages the payload and writes AppxManifest.xml + mapping.txt
 * correctly, but its own invocation of makeappx.exe fails with "spawn UNKNOWN"
 * on this toolchain. So: let it stage, then call makeappx from the Windows SDK
 * ourselves.
 *
 *   npm run dist:store
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const pkg = require(path.join(ROOT, 'package.json'));

function findMakeAppx() {
  const roots = [
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin',
    'C:\\Program Files\\Windows Kits\\10\\bin',
  ];
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const ver of fs.readdirSync(root)) {
      const exe = path.join(root, ver, 'x64', 'makeappx.exe');
      if (fs.existsSync(exe)) found.push({ ver, exe });
    }
  }
  if (!found.length) return null;
  // highest SDK version wins
  found.sort((a, b) => a.ver.localeCompare(b.ver, undefined, { numeric: true }));
  return found[found.length - 1].exe;
}

// 1. Stage. electron-builder exits non-zero on its failed pack step; the
//    staged output is still what we need, so check for that rather than status.
//    shell:true is required — Node refuses to spawn .cmd shims directly since
//    the CVE-2024-27980 mitigation, and fails silently without it.
console.log('> staging appx payload with electron-builder');
const stage = spawnSync('npx electron-builder --win appx', {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
});
if (stage.error) {
  console.error('could not run electron-builder:', stage.error.message);
  process.exit(1);
}

const mapping = path.join(DIST, '__appx-x64', 'mapping.txt');
if (!fs.existsSync(mapping)) {
  console.error('staging failed: no dist/__appx-x64/mapping.txt was produced');
  process.exit(1);
}

// 2. Pack.
const makeappx = findMakeAppx();
if (!makeappx) {
  console.error('makeappx.exe not found. Install the Windows 10/11 SDK, then re-run.');
  process.exit(1);
}
const out = path.join(DIST, `${pkg.name}-${pkg.version}-x64.msix`);
console.log(`> packing with ${makeappx}`);
const res = spawnSync(makeappx, ['pack', '/f', mapping, '/p', out, '/o'], { stdio: ['ignore', 'pipe', 'inherit'] });
const log = (res.stdout || '').toString();
if (res.status !== 0 || !fs.existsSync(out)) {
  console.error(log.split('\n').slice(-15).join('\n'));
  process.exit(1);
}
const mb = (fs.statSync(out).size / 1048576).toFixed(1);
console.log(`\nMSIX ready: ${path.relative(ROOT, out)}  (${mb} MB)`);
console.log('Unsigned — Partner Center signs it on upload. Replace the appx identity');
console.log('fields in package.json with your Partner Center values first (see STORE.md).');
