/*
 * eISCP (Integra Serial Control Protocol over Ethernet) client
 * Handles: TCP control connection, UDP auto-discovery, packet framing,
 * and NJA album-art chunk assembly.
 */
const net = require('net');
const dgram = require('dgram');
const os = require('os');
const http = require('http');
const { EventEmitter } = require('events');

const ISCP_PORT = 60128;

// Build an eISCP packet. dest '1' = receiver, 'x' = discovery broadcast.
function buildPacket(message, dest = '1') {
  const data = Buffer.from('!' + dest + message + '\r', 'ascii');
  const buf = Buffer.alloc(16 + data.length);
  buf.write('ISCP', 0, 'ascii');
  buf.writeUInt32BE(16, 4);            // header size
  buf.writeUInt32BE(data.length, 8);   // data size
  buf.writeUInt8(1, 12);               // version
  data.copy(buf, 16);
  return buf;
}

// Extract complete messages from a rolling buffer. Returns [messages, remainder].
function parseBuffer(buf) {
  const messages = [];
  while (buf.length >= 16) {
    const idx = buf.indexOf('ISCP');
    if (idx === -1) { buf = Buffer.alloc(0); break; }
    if (idx > 0) buf = buf.subarray(idx);
    if (buf.length < 16) break;
    const headerSize = buf.readUInt32BE(4);
    const dataSize = buf.readUInt32BE(8);
    if (headerSize < 16 || dataSize > 5_000_000) { buf = buf.subarray(4); continue; }
    if (buf.length < headerSize + dataSize) break;
    let data = buf.subarray(headerSize, headerSize + dataSize).toString('ascii');
    buf = buf.subarray(headerSize + dataSize);
    // strip "!1" prefix and EOF/CR/LF terminators
    data = data.replace(/^!1/, '').replace(/[\x1a\r\n\x00]+$/g, '');
    if (data.length >= 3) {
      messages.push({ cmd: data.slice(0, 3), data: data.slice(3) });
    }
  }
  return [messages, buf];
}

// The DRX's album_art.cgi emits a spurious CGI header block ("Content-Type: ...")
// inside the response body, ahead of the actual image bytes. Strip it.
function stripEmbeddedHeaders(buf) {
  if (buf.length < 4) return buf;
  const magic = (b) => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) ||
                       (b[0] === 0x42 && b[1] === 0x4d) || (b[0] === 0x47 && b[1] === 0x49);
  if (magic(buf)) return buf;
  const limit = Math.min(buf.length, 1024);
  const head = buf.subarray(0, limit);
  for (const sep of ['\r\n\r\n', '\n\n']) {
    const idx = head.indexOf(sep, 0, 'ascii');
    if (idx !== -1) {
      const rest = buf.subarray(idx + sep.length);
      if (magic(rest)) return rest;
    }
  }
  return buf;
}

function sniffMime(buf, headerMime) {
  if (headerMime && headerMime.startsWith('image/')) return headerMime;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
}

const PROBE_TIMEOUT = 7000;    // receiver must answer our first query this fast
const KEEPALIVE_EVERY = 20000; // idle query interval
const SILENCE_LIMIT = 55000;   // no inbound data for this long = link is dead

class EiscpClient extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.ip = null;
    this.port = ISCP_PORT;
    this.connected = false;   // TCP is up
    this.verified = false;    // receiver has actually answered us
    this.lastRx = 0;
    this._reconTimer = null;
    this._keepAlive = null;
    this._probeTimer = null;
    this._attempts = 0;
    this._wantConnection = false;
    this._sendQueue = [];
    this._sendTimer = null;
    // NJA album art assembly
    this._artHex = '';
    this._artType = null;
  }

  connect(ip, port = ISCP_PORT) {
    this._wantConnection = true;
    this.ip = ip;
    this.port = port;
    this._attempts = 0;
    this._teardown(false);
    this._open();
  }

  _open() {
    this._teardown(false);
    this.emit('status', { state: this._attempts ? 'reconnecting' : 'connecting', ip: this.ip });

    const sock = new net.Socket();
    this.sock = sock;
    sock.setNoDelay(true);

    sock.connect(this.port, this.ip, () => {
      // TCP is up, but the receiver may still ignore us — its eISCP session
      // slots are limited and stale sessions make it accept and stay mute.
      // Don't claim ONLINE until it actually answers.
      this.connected = true;
      this.verified = false;
      this.buf = Buffer.alloc(0);
      this.lastRx = Date.now();
      this.emit('status', { state: 'handshaking', ip: this.ip });
      this.sendRaw('PWRQSTN');
      this._probeTimer = setTimeout(() => {
        if (!this.verified) this._failAndRetry('no-response');
      }, PROBE_TIMEOUT);
    });

    sock.on('data', (chunk) => {
      this.lastRx = Date.now();
      if (!this.verified) {
        this.verified = true;
        this._attempts = 0;
        clearTimeout(this._probeTimer); this._probeTimer = null;
        this.emit('status', { state: 'connected', ip: this.ip });
        this._keepAlive = setInterval(() => {
          if (Date.now() - this.lastRx > SILENCE_LIMIT) { this._failAndRetry('silent'); return; }
          this.sendRaw('PWRQSTN');
        }, KEEPALIVE_EVERY);
      }
      this.buf = Buffer.concat([this.buf, chunk]);
      const [messages, rest] = parseBuffer(this.buf);
      this.buf = rest;
      for (const m of messages) this._handleMessage(m);
    });

    sock.on('error', () => {});
    sock.on('close', () => {
      if (!this._wantConnection) return;
      this._teardown(false);
      this._scheduleRetry(this.verified ? 'dropped' : 'refused');
    });
  }

  // The link is up at TCP level but useless — drop it cleanly and try again.
  _failAndRetry(reason) {
    this._teardown(false);
    this._scheduleRetry(reason);
  }

  _scheduleRetry(reason) {
    if (!this._wantConnection || this._reconTimer) return;
    // A mute receiver holds each refused session open for ~18s before resetting
    // it, so hammering makes the slot shortage worse. Back off harder for that.
    // Capped low enough that a receiver power cycle is picked up promptly,
    // high enough not to pile onto a receiver that's already out of slots.
    const mute = reason === 'no-response';
    const delay = Math.min(mute ? 25000 : 20000,
                           (mute ? 8000 : 3000) * Math.pow(1.6, this._attempts));
    this._attempts += 1;
    this.emit('status', {
      state: reason === 'no-response' ? 'no-response' : 'reconnecting',
      ip: this.ip, reason, attempt: this._attempts, retryIn: Math.round(delay / 1000),
    });
    this._reconTimer = setTimeout(() => { this._reconTimer = null; this._open(); }, delay);
  }

  disconnect() {
    this._wantConnection = false;
    this._teardown(true);
  }

  /*
   * Close the control session politely (FIN, not RST) and wait for the
   * receiver to acknowledge. Abrupt exits leave the session allocated on the
   * receiver, and once its slots are exhausted it accepts TCP connections but
   * answers nothing — which looks exactly like "connected but dead".
   */
  shutdown(done) {
    this._wantConnection = false;
    if (this._reconTimer) { clearTimeout(this._reconTimer); this._reconTimer = null; }
    if (this._keepAlive) { clearInterval(this._keepAlive); this._keepAlive = null; }
    if (this._probeTimer) { clearTimeout(this._probeTimer); this._probeTimer = null; }
    if (this._sendTimer) { clearTimeout(this._sendTimer); this._sendTimer = null; }
    this._sendQueue = [];
    const sock = this.sock;
    this.sock = null;
    this.connected = false;
    this.verified = false;
    if (!sock) { done(); return; }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      try { sock.destroy(); } catch (e) {}
      done();
    };
    const guard = setTimeout(finish, 1500);
    sock.removeAllListeners('close');
    sock.on('close', finish);
    sock.on('error', finish);
    try { sock.end(); } catch (e) { finish(); }
  }

  _teardown(emitStatus) {
    if (this._reconTimer) { clearTimeout(this._reconTimer); this._reconTimer = null; }
    if (this._keepAlive) { clearInterval(this._keepAlive); this._keepAlive = null; }
    if (this._probeTimer) { clearTimeout(this._probeTimer); this._probeTimer = null; }
    if (this._sendTimer) { clearTimeout(this._sendTimer); this._sendTimer = null; }
    this._sendQueue = [];
    if (this.sock) {
      const sock = this.sock;
      this.sock = null;
      sock.removeAllListeners('close');
      sock.on('error', () => {});
      // FIN first so the receiver frees the session, then hard-close.
      try { sock.end(); } catch (e) {}
      setTimeout(() => { try { sock.destroy(); } catch (e) {} }, 400);
    }
    this.connected = false;
    this.verified = false;
    if (emitStatus) this.emit('status', { state: 'disconnected', ip: this.ip });
  }

  // Queue commands with a small gap — receivers drop bursts sent back-to-back.
  send(message) {
    this._sendQueue.push(message);
    if (!this._sendTimer) this._drainQueue();
  }

  _drainQueue() {
    if (!this._sendQueue.length) { this._sendTimer = null; return; }
    this.sendRaw(this._sendQueue.shift());
    this._sendTimer = setTimeout(() => this._drainQueue(), 55);
  }

  sendRaw(message) {
    if (this.sock && this.connected) {
      try { this.sock.write(buildPacket(message)); } catch (e) { /* socket died; close handler reconnects */ }
    }
  }

  _handleMessage(m) {
    if (m.cmd === 'NJA') { this._handleArt(m.data); return; }
    this.emit('message', m);
  }

  /*
   * NJA: album art. data = <type><position><payload>
   *   type: 0=BMP 1=JPEG 2=URL n=no image
   *   position: 0=start 1=middle 2=end -=complete in one message
   */
  _handleArt(data) {
    const type = data[0];
    const pos = data[1];
    const payload = data.slice(2);
    if (type === 'n') { this.emit('art', null); return; }
    if (type === '2') {
      // URL form — fetch from the receiver's built-in HTTP server
      const url = payload.startsWith('-') ? payload.slice(1) : payload;
      this._fetchArtUrl(url.trim());
      return;
    }
    const mime = type === '0' ? 'image/bmp' : 'image/jpeg';
    if (pos === '0') { this._artHex = payload; this._artType = mime; }
    else if (pos === '1') { this._artHex += payload; }
    else if (pos === '2' || pos === '-') {
      this._artHex = (pos === '-') ? payload : this._artHex + payload;
      this._artType = mime;
      try {
        const buf = Buffer.from(this._artHex, 'hex');
        // tiny payloads are "no art" placeholders
        this.emit('art', buf.length > 200 ? `data:${this._artType};base64,${buf.toString('base64')}` : null);
      } catch (e) { this.emit('art', null); }
      this._artHex = '';
    }
  }

  _fetchArtUrl(url) {
    try {
      http.get(url, (res) => {
        if (res.statusCode !== 200) { res.resume(); this.emit('art', null); return; }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = stripEmbeddedHeaders(Buffer.concat(chunks));
          if (body.length < 200) { this.emit('art', null); return; }
          this.emit('art', `data:${sniffMime(body, res.headers['content-type'])};base64,${body.toString('base64')}`);
        });
      }).on('error', () => this.emit('art', null));
    } catch (e) { this.emit('art', null); }
  }

  // The receiver's built-in HTTP server exposes the current cover here even
  // when it doesn't push NJA art (e.g. Spotify Connect).
  fetchDeviceArt() {
    if (this.ip) this._fetchArtUrl(`http://${this.ip}/album_art.cgi`);
  }
}

/*
 * UDP auto-discovery. Broadcasts !xECNQSTN on 60128 to every interface's
 * broadcast address; receivers answer with ECN<model>/<port>/<region>/<mac>.
 */
function discover(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const pkt = buildPacket('ECNQSTN', 'x');

    sock.on('message', (msg, rinfo) => {
      const [messages] = parseBuffer(Buffer.from(msg));
      for (const m of messages) {
        if (m.cmd !== 'ECN') continue;
        const parts = m.data.split('/');
        found.set(rinfo.address, {
          ip: rinfo.address,
          model: parts[0] || 'Unknown',
          port: parseInt(parts[1], 10) || ISCP_PORT,
          region: parts[2] || '',
          mac: (parts[3] || '').replace(/[^0-9A-Fa-f]/g, '').replace(/(..)(?=.)/g, '$1:'),
        });
      }
    });
    sock.on('error', () => { try { sock.close(); } catch (e) {} resolve([...found.values()]); });

    sock.bind(0, () => {
      sock.setBroadcast(true);
      const targets = new Set(['255.255.255.255']);
      const ifaces = os.networkInterfaces();
      for (const list of Object.values(ifaces)) {
        for (const inf of list || []) {
          if (inf.family === 'IPv4' && !inf.internal) {
            const ip = inf.address.split('.').map(Number);
            const mask = inf.netmask.split('.').map(Number);
            targets.add(ip.map((o, i) => (o | (~mask[i] & 255))).join('.'));
          }
        }
      }
      for (const t of targets) {
        sock.send(pkt, 0, pkt.length, ISCP_PORT, t, () => {});
        // send twice — discovery over UDP is lossy
        setTimeout(() => { try { sock.send(pkt, 0, pkt.length, ISCP_PORT, t, () => {}); } catch (e) {} }, 400);
      }
      setTimeout(() => {
        try { sock.close(); } catch (e) {}
        resolve([...found.values()]);
      }, timeoutMs);
    });
  });
}

module.exports = { EiscpClient, discover, ISCP_PORT };
