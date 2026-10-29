// Automatic scanning: visits each site's search page for you, reads it, and decides
// whether you're listed. It drives a real browser (Edge or Chrome, through
// playwright-core) when one is available, because most people-search sites block
// plain downloads; otherwise it falls back to fetch().
const path = require('path');

const BLOCKED = /verify you are (a )?human|are you a robot|captcha|access denied|unusual traffic|just a moment|checking your browser|attention required|request blocked|enable javascript and cookies/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const RANK = { listed: 0, possible: 1, blocked: 2, error: 3, clear: 4 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- Getting pages ---------------------------------------------------------

function loadPlaywright() {
  for (const name of ['playwright-core', 'playwright']) {
    try { return require(name); } catch { /* not installed */ }
  }
  return null;
}

// Opens Edge or Chrome with its own profile in data/, so cookies from sites you've
// passed a "are you human" check on are remembered between scans.
async function openBrowser({ headless, profileDir }) {
  const pw = loadPlaywright();
  if (!pw) return null;
  const tries = process.env.BROWSER_PATH
    ? [{ executablePath: process.env.BROWSER_PATH }]
    : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  // If a visible window can't open, a hidden one is still better than none.
  for (const hidden of headless ? [true] : [false, true]) {
    for (const t of tries) {
      try {
        return await pw.chromium.launchPersistentContext(profileDir, { headless: hidden, viewport: { width: 1200, height: 900 }, ...t });
      } catch { /* try the next browser */ }
    }
  }
  return null;
}

async function browserGet(context, url, { headless, solveWaitMs }) {
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500); // results are often filled in by scripts
    const read = () => page.evaluate(() => ({
      text: document.body ? document.body.innerText : '',
      links: [...document.querySelectorAll('a[href]')].slice(0, 3000).map((a) => {
        // The text of the smallest block around the link, e.g. one person's result card.
        let box = a;
        while (box.parentElement && box.parentElement !== document.body && (box.parentElement.innerText || '').length < 800) box = box.parentElement;
        return { href: a.href, text: (a.innerText || '').trim().slice(0, 200), context: (box.innerText || '').slice(0, 800) };
      }),
      results: [...document.querySelectorAll('.result')].map((r) => ({
        href: r.querySelector('.result__a')?.href || '',
        title: r.querySelector('.result__a')?.innerText || '',
        snippet: r.querySelector('.result__snippet')?.innerText || '',
      })),
    }));
    let got = await read();
    let status = res ? res.status() : 0;
    // A visible browser gives you a chance to tick the "I'm human" box yourself.
    if (!headless && BLOCKED.test(got.text.slice(0, 3000))) {
      const until = Date.now() + solveWaitMs;
      while (Date.now() < until && BLOCKED.test(got.text.slice(0, 3000))) {
        await page.waitForTimeout(2000);
        got = await read().catch(() => got);
      }
      if (!BLOCKED.test(got.text.slice(0, 3000))) {
        await page.waitForTimeout(2000);
        got = await read();
        status = 200;
      }
    }
    return { status, ...got };
  } finally {
    await page.close().catch(() => {});
  }
}

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const toText = (html) => decode(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '));

async function plainGet(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(20000) });
  const html = await res.text();
  const abs = (h) => { try { return new URL(decode(h), res.url).href; } catch { return ''; } };
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].slice(0, 3000)
    .map((m) => ({ href: abs(m[1]), text: toText(m[2]).trim().slice(0, 200), context: toText(html.slice(m.index, m.index + 1500)) }));
  const results = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: abs(m[1]), title: toText(m[2]).trim(), snippet: toText(m[3]).trim() }));
  return { status: res.status, text: toText(html), links, results };
}

// --- Reading a page --------------------------------------------------------

function nameRegexes(lookups) {
  const seen = new Set();
  return lookups.filter((q) => {
    const key = `${q.first} ${q.last}`.toLowerCase();
    return !seen.has(key) && seen.add(key);
  }).map((q) => ({
    first: q.first.toLowerCase(),
    last: q.last.toLowerCase(),
    // First name, up to two middle names or initials, then last name.
    re: new RegExp(`\\b${escRe(q.first)}\\b(?:[\\s,]+[\\w.'-]+){0,2}?[\\s,]+${escRe(q.last)}\\b`, 'gi'),
  }));
}

// Details that tell your record apart from someone else with the same name.
function clues(profile) {
  const out = [];
  for (const p of profile.phones) {
    const d = p.replace(/\D/g, '').slice(-10);
    if (d.length === 10) out.push({ label: `phone ${p}`, re: new RegExp(`\\(?${d.slice(0, 3)}\\)?[\\s.-]*${d.slice(3, 6)}[\\s.-]*${d.slice(6)}`) });
  }
  for (const e of profile.emails) out.push({ label: `email ${e}`, re: new RegExp(escRe(e), 'i') });
  for (const a of profile.addresses) {
    const m = (a.street || '').match(/^(\d+)\s+(?:[NSEW]\.?\s+)?([A-Za-z]{3,})/);
    if (m) out.push({ label: `address ${a.street}`, re: new RegExp(`\\b${m[1]}\\s+(?:[NSEW]\\.?\\s+)?${escRe(m[2])}`, 'i') });
  }
  const year = Number(profile.birthYear);
  if (year > 1900) {
    const ages = [0, 1].map((k) => new Date().getFullYear() - year - k);
    out.push({ label: `age ${ages[0]}`, re: new RegExp(`\\b(?:age:?\\s*(?:${ages.join('|')})\\b|(?:${ages.join('|')})\\s*(?:years old|yrs)|born:?[^\\n]{0,12}${year})`, 'i') });
  }
  // A past city matters only when it isn't the one we searched in.
  const cities = [...new Set(profile.addresses.map((a) => a.city).filter(Boolean))];
  return { fixed: out, cities };
}

function analyze(page, { names, clues: c, searchedCity }) {
  if ([403, 429, 503].includes(page.status) || BLOCKED.test(page.text.slice(0, 3000))) return { result: 'blocked', detail: 'The site showed a "prove you are human" check or blocked the visit.' };
  if (page.status >= 400 || !page.status) return { result: 'error', detail: `The site answered with error ${page.status || 'no response'}.` };
  const text = page.text.replace(/[ \t]+/g, ' ');
  const hits = [];
  for (const n of names) for (const m of text.matchAll(n.re)) hits.push({ n, at: m.index });
  if (!hits.length) return { result: 'clear', detail: 'Your name did not appear in the search results.' };
  const otherCities = c.cities.filter((x) => x.toLowerCase() !== (searchedCity || '').toLowerCase())
    .map((x) => ({ label: `past city ${x}`, re: new RegExp(`\\b${escRe(x)}\\b`, 'i') }));
  const evidence = new Set();
  for (const h of hits.slice(0, 50)) {
    const near = text.slice(Math.max(0, h.at - 300), h.at + 1500);
    for (const k of [...c.fixed, ...otherCities]) if (k.re.test(near)) evidence.add(k.label);
  }
  const links = listingLinks(page, names);
  if (evidence.size) {
    // Keep only profile links that sit next to your details, not a namesake's.
    const clueRes = [...c.fixed, ...otherCities].map((k) => k.re);
    const mine = links.filter((l) => clueRes.some((re) => re.test(l.context || '')));
    return { result: 'listed', detail: `Found your name next to your ${[...evidence].join(', ')}.`, evidence: [...evidence], links: mine.map((l) => l.href) };
  }
  return { result: 'possible', detail: 'Your name appears, but nothing else matched, so it may be someone else with the same name.', links: links.map((l) => l.href) };
}

// Links on the results page that look like a profile page for you.
function listingLinks(page, names) {
  let host = '';
  try { host = new URL(page.url).hostname.split('.').slice(-2).join('.'); } catch { /* keep empty */ }
  const out = new Map();
  for (const l of page.links) {
    let href;
    try {
      if (!/^https?:/.test(l.href) || (host && !new URL(l.href).hostname.endsWith(host))) continue;
      href = decodeURIComponent(l.href).toLowerCase();
    } catch { continue; }
    const text = l.text.toLowerCase();
    const plain = (s) => s.replace(/[^a-z0-9]/g, '');
    if (names.some((n) => (text.includes(n.first) && text.includes(n.last))
      || [...'-_+/ '].some((sep) => href.includes(`${n.first}${sep}${n.last}`) || href.includes(`${plain(n.first)}${sep}${plain(n.last)}`)))) {
      const url = l.href.split('#')[0];
      // Stop at the next person with your name, so their details don't count as yours.
      let context = l.context || '';
      for (const n of names) {
        const second = [...context.matchAll(n.re)][1];
        if (second) context = context.slice(0, second.index);
      }
      if (!out.has(url)) out.set(url, { href: url, context });
    }
    if (out.size >= 10) break;
  }
  return [...out.values()];
}

// --- Running a scan --------------------------------------------------------

// targets: [{ id, name, urls: [{ url, city }] }]. Calls onResult(id, result) per site.
async function runScan({ targets, profile, lookups, webQueries, dataDir, headless, onProgress, onResult, onWeb, isCancelled }) {
  const total = targets.reduce((n, t) => n + t.urls.length, 0) + webQueries.length;
  let done = 0;
  const ctx = { names: nameRegexes(lookups), clues: clues(profile) };
  const browser = await openBrowser({ headless, profileDir: path.join(dataDir, 'browser-profile') });
  const get = browser
    ? (url) => browserGet(browser, url, { headless, solveWaitMs: 60000 })
    : plainGet;
  onProgress({ total, done, current: '', mode: browser ? 'browser' : 'basic' });
  try {
    for (const t of targets) {
      if (isCancelled()) break;
      const outcomes = [];
      for (const u of t.urls) {
        if (isCancelled()) break;
        onProgress({ total, done, current: t.name });
        try {
          const page = await get(u.url);
          outcomes.push({ ...analyze({ ...page, url: u.url }, { ...ctx, searchedCity: u.city }), url: u.url });
        } catch (err) {
          outcomes.push({ result: 'error', detail: `Could not load the page (${err.message.split('\n')[0]}).`, url: u.url });
        }
        done++;
        await sleep(1500 + Math.random() * 1500); // be gentle; fast scans get blocked
      }
      if (outcomes.length) {
        outcomes.sort((a, b) => RANK[a.result] - RANK[b.result]);
        const best = outcomes[0];
        onResult(t.id, { ...best, links: [...new Set(outcomes.flatMap((o) => o.links || []))].slice(0, 5), checked: outcomes.length });
      }
    }
    for (const q of webQueries) {
      if (isCancelled()) break;
      onProgress({ total, done, current: `Web search: ${q.text}` });
      try {
        const page = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q.text)}`);
        onWeb(webResults(page, ctx.names, q.text));
      } catch { /* a failed search just finds nothing */ }
      done++;
      await sleep(2000 + Math.random() * 2000);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  onProgress({ total, done, current: '' });
}

// Search results that mention your name. DuckDuckGo wraps links in a redirect.
function webResults(page, names, query) {
  return page.results.map((r) => {
    let url = r.href;
    try {
      const u = new URL(url);
      if (u.searchParams.get('uddg')) url = u.searchParams.get('uddg');
    } catch { return null; }
    if (!/^https?:/.test(url) || /duckduckgo\.com/.test(url)) return null;
    const blob = `${r.title} ${r.snippet}`;
    if (!names.some((n) => { n.re.lastIndex = 0; return n.re.test(blob); })) return null;
    return { url, title: r.title.slice(0, 200), snippet: r.snippet.slice(0, 400), domain: new URL(url).hostname.replace(/^www\./, ''), query };
  }).filter(Boolean);
}

module.exports = { runScan, analyze, nameRegexes, clues, webResults, loadPlaywright };
