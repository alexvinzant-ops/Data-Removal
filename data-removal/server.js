// Data Removal — a small, self-hosted take on Optery. It keeps your profile and a
// checklist of data brokers on your own computer, builds links that look you up on
// each site, tracks what you've requested, reminds you to re-check, and drafts
// opt-out emails. Nothing is sent anywhere; you open each site yourself.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BROKERS = require('./brokers');

const PORT = Number(process.env.PORT) || 7100;
const HOST = process.env.HOST || '127.0.0.1';
const PASSWORD = process.env.PASSWORD || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json');
const PAGE = path.join(__dirname, 'public', 'index.html');
const STATUSES = ['unchecked', 'not_found', 'found', 'submitted', 'removed'];
const MAX_BODY = 1_000_000;

// --- Storage ---------------------------------------------------------------

const emptyState = () => ({
  profile: { first: '', middle: '', last: '', aliases: [], birthYear: '', emails: [], phones: [], addresses: [] },
  settings: { recheckDays: 90, followUpDays: 30 },
  records: {}, // broker id -> { status, notes, listingUrls, history: [{ at, status, note }] }
  custom: [], // sites you add yourself: { id, name, url, optOut, email }
});

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const base = emptyState();
    return { ...base, ...saved, profile: { ...base.profile, ...saved.profile }, settings: { ...base.settings, ...saved.settings } };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Could not read ${DATA_FILE}: ${err.message}`);
    return emptyState();
  }
}

let state = load();

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE); // atomic, so a crash never leaves half a file
}

// --- Brokers as the page sees them ----------------------------------------

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, max = 50) => (Array.isArray(v) ? v.map((s) => str(s)).filter(Boolean).slice(0, max) : []);

// Every name you go by, split into first/last, paired with every city you've lived in.
function lookups(profile) {
  const names = [];
  if (profile.first && profile.last) names.push({ first: profile.first, last: profile.last });
  for (const alias of profile.aliases) {
    const parts = alias.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) names.push({ first: parts[0], last: parts[parts.length - 1] });
  }
  const places = profile.addresses.filter((a) => a.city || a.state).map((a) => ({ city: a.city || '', state: (a.state || '').toUpperCase() }));
  if (!places.length) places.push({ city: '', state: '' });
  const seen = new Set();
  const out = [];
  for (const n of names) {
    for (const p of places) {
      const label = [`${n.first} ${n.last}`, [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
      if (!seen.has(label.toLowerCase())) {
        seen.add(label.toLowerCase());
        out.push({ ...n, ...p, label });
      }
    }
  }
  return out.slice(0, 8);
}

const uniqueBy = (list, key) => list.filter((x, i) => list.findIndex((y) => key(y) === key(x)) === i);

// Some sites only search by name; don't label those links with a city.
function searchLink(broker, q) {
  const url = broker.search(q);
  const nameOnly = url === broker.search({ ...q, city: '', state: '' });
  return { label: nameOnly ? `${q.first} ${q.last}` : q.label, url };
}

function brokerView() {
  const qs = lookups(state.profile);
  const builtIn = BROKERS.map((b) => ({
    id: b.id,
    name: b.name,
    url: b.url,
    optOut: b.optOut,
    method: b.method,
    email: b.email || '',
    priority: b.priority,
    covers: b.covers || [],
    steps: b.steps,
    searchLinks: b.search ? uniqueBy(qs.map((q) => searchLink(b, q)), (l) => l.url) : [],
    custom: false,
  }));
  const custom = state.custom.map((c) => ({
    ...c, method: c.email ? 'email' : 'form', priority: 2, covers: [], steps: 'A site you added yourself.', searchLinks: [], custom: true,
  }));
  return [...builtIn, ...custom];
}

const view = () => ({ profile: state.profile, settings: state.settings, records: state.records, lookups: lookups(state.profile), brokers: brokerView() });

// --- Validation of what the page sends -------------------------------------

function cleanProfile(p = {}) {
  const addresses = Array.isArray(p.addresses) ? p.addresses.slice(0, 20).map((a) => ({
    street: str(a?.street), city: str(a?.city, 100), state: str(a?.state, 2).toUpperCase(), zip: str(a?.zip, 10),
  })).filter((a) => a.street || a.city || a.state || a.zip) : [];
  return {
    first: str(p.first, 100), middle: str(p.middle, 100), last: str(p.last, 100),
    aliases: strList(p.aliases), birthYear: str(p.birthYear, 4),
    emails: strList(p.emails), phones: strList(p.phones), addresses,
  };
}

const knownBroker = (id) => BROKERS.some((b) => b.id === id) || state.custom.some((c) => c.id === id);

function updateRecord(id, body) {
  const rec = state.records[id] || { status: 'unchecked', notes: '', listingUrls: [], history: [] };
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw httpError(400, 'Unknown status');
    rec.history.push({ at: new Date().toISOString(), status: body.status, note: str(body.note) });
    rec.status = body.status;
  }
  if (body.notes !== undefined) rec.notes = str(body.notes, 5000);
  if (body.listingUrls !== undefined) rec.listingUrls = strList(body.listingUrls);
  state.records[id] = rec;
}

function addCustom(body) {
  const name = str(body.name, 100);
  if (!name) throw httpError(400, 'Name is required');
  const site = { id: `custom-${crypto.randomUUID().slice(0, 8)}`, name, url: str(body.url), optOut: str(body.optOut), email: str(body.email, 200) };
  state.custom.push(site);
  return site;
}

function applySettings(body) {
  const days = (v, d) => (Number.isInteger(v) && v > 0 && v <= 3650 ? v : d);
  state.settings = { recheckDays: days(body.recheckDays, 90), followUpDays: days(body.followUpDays, 30) };
}

// --- HTTP ------------------------------------------------------------------

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string';
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) reject(httpError(413, 'Request too large'));
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(httpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function authorized(req) {
  if (!PASSWORD) return true;
  const [scheme, value] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !value) return false;
  const given = Buffer.from(Buffer.from(value, 'base64').toString('utf8').split(':').slice(1).join(':'));
  const want = Buffer.from(PASSWORD);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

// Without a password the app only answers to localhost, so another website you
// visit can't reach it through your browser (DNS rebinding).
function hostAllowed(req) {
  if (PASSWORD) return true;
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  return ['localhost', '127.0.0.1', '[::1]'].includes(host);
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method;

  if (method === 'GET' && url.pathname === '/') return send(res, 200, fs.readFileSync(PAGE, 'utf8'));
  if (parts[0] !== 'api') throw httpError(404, 'Not found');

  // Writes must come from our own page: a custom header forces a CORS preflight,
  // which other origins fail.
  if (method !== 'GET' && req.headers['x-requested-with'] !== 'data-removal') throw httpError(403, 'Forbidden');

  if (method === 'GET' && parts[1] === 'state') {
    return send(res, 200, view());
  }
  if (method === 'GET' && parts[1] === 'export') {
    return send(res, 200, state, { 'Content-Disposition': 'attachment; filename="data-removal-backup.json"' });
  }

  const body = await readJson(req);
  if (method === 'PUT' && parts[1] === 'profile') {
    state.profile = cleanProfile(body);
  } else if (method === 'PUT' && parts[1] === 'settings') {
    applySettings(body);
  } else if (method === 'POST' && parts[1] === 'brokers' && parts[2]) {
    if (!knownBroker(parts[2])) throw httpError(404, 'Unknown site');
    updateRecord(parts[2], body);
  } else if (method === 'POST' && parts[1] === 'custom') {
    addCustom(body);
  } else if (method === 'DELETE' && parts[1] === 'custom' && parts[2]) {
    state.custom = state.custom.filter((c) => c.id !== parts[2]);
    delete state.records[parts[2]];
  } else if (method === 'POST' && parts[1] === 'import') {
    const base = emptyState();
    const custom = (Array.isArray(body.custom) ? body.custom : [])
      .filter((c) => /^custom-[a-z0-9]{1,16}$/.test(c?.id) && str(c.name))
      .map((c) => ({ id: c.id, name: str(c.name, 100), url: str(c.url), optOut: str(c.optOut), email: str(c.email, 200) }));
    state = { ...base, profile: cleanProfile(body.profile), custom };
    for (const [id, rec] of Object.entries(body.records || {})) {
      if (!knownBroker(id) || !STATUSES.includes(rec?.status)) continue;
      state.records[id] = {
        status: rec.status,
        notes: str(rec.notes, 5000),
        listingUrls: strList(rec.listingUrls),
        history: (Array.isArray(rec.history) ? rec.history : [])
          .filter((h) => STATUSES.includes(h?.status) && !Number.isNaN(Date.parse(h.at)))
          .map((h) => ({ at: new Date(h.at).toISOString(), status: h.status, note: str(h.note) })),
      };
    }
    applySettings(body.settings || {});
  } else {
    throw httpError(404, 'Not found');
  }
  save();
  return send(res, 200, view());
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hostAllowed(req)) throw httpError(403, 'Forbidden host');
    if (!authorized(req)) return send(res, 401, { error: 'Password required' }, { 'WWW-Authenticate': 'Basic realm="Data Removal"' });
    await route(req, res);
  } catch (err) {
    if (!err.status) console.error(err);
    send(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
  }
});

if (require.main === module) {
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !PASSWORD) {
    console.error('Refusing to listen beyond this computer without a PASSWORD. Set PASSWORD or leave HOST unset.');
    process.exit(1);
  }
  server.listen(PORT, HOST, () => console.log(`Data Removal running at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`));
}

module.exports = { server, lookups, BROKERS };
