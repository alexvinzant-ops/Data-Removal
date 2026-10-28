// My Teams — a Stremio addon that lists your teams, their games and live scores
// (from ESPN's public site API), with buttons that search your other addons.
const http = require('http');
const TEAMS = require('./teams');

const PORT = process.env.PORT || 7000;
const TIMEZONE = process.env.TIMEZONE || 'America/Chicago';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const PREFIX = 'sportsteam:';
const TYPE = 'channel';
const PAST_GAMES = 5;
const NEXT_GAMES = 5;

const manifest = {
  id: 'community.myteams.scores',
  version: '1.0.0',
  name: 'My Teams',
  description: 'Follow your teams: schedules, live scores, where to watch, and one-click search across your addons.',
  logo: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-scores.png',
  resources: ['catalog', 'meta', 'stream'],
  types: [TYPE],
  idPrefixes: [PREFIX],
  catalogs: [{ type: TYPE, id: 'myteams', name: 'My Teams' }],
};

// --- ESPN data -------------------------------------------------------------

const cache = new Map();

async function getJson(url, ttlMs) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN returned ${res.status} for ${url}`);
    const data = await res.json();
    cache.set(url, { at: Date.now(), data });
    return data;
  } catch (err) {
    if (hit) return hit.data; // serve stale data rather than nothing
    throw err;
  }
}

const scoreOf = (s) => (s && typeof s === 'object' ? s.displayValue : s) ?? null;

function toGame(team, event) {
  const comp = event.competitions[0];
  const sides = comp.competitors.map((c) => ({
    id: c.team.id,
    abbr: c.team.abbreviation,
    name: c.team.shortDisplayName,
    logo: c.team.logo || c.team.logos?.[0]?.href,
    home: c.homeAway === 'home',
    score: scoreOf(c.score),
  }));
  const gamePath = team.sport === 'soccer' ? 'soccer/match' : `${team.league}/game`;
  return {
    id: event.id,
    date: new Date(event.date),
    state: comp.status.type.state, // pre | in | post
    detail: comp.status.type.shortDetail,
    us: sides.find((s) => s.id === team.id),
    them: sides.find((s) => s.id !== team.id),
    venue: comp.venue?.fullName,
    // Schedules use { media: { shortName } }, scoreboards use { names: [...] }.
    broadcasts: [...new Set((comp.broadcasts || []).flatMap((b) => b.names || [b.media?.shortName]).filter(Boolean))],
    link: `https://www.espn.com/${gamePath}/_/gameId/${event.id}`,
  };
}

// The team schedule has no live scores, so in-progress games are overlaid
// with the league's scoreboard, which is refreshed every 30 seconds.
async function getTeam(team) {
  const base = `${ESPN}/${team.sport}/${team.league}`;
  const scheduleUrl = `${base}/teams/${team.id}/schedule`;
  // Soccer schedules only return results; upcoming fixtures need ?fixture=true.
  const urls = team.sport === 'soccer' ? [scheduleUrl, `${scheduleUrl}?fixture=true`] : [scheduleUrl];
  const [scoreboard, ...schedules] = await Promise.all([
    getJson(`${base}/scoreboard`, 30e3).catch(() => ({ events: [] })),
    ...urls.map((u) => getJson(u, 10 * 60e3)),
  ]);
  const live = new Map((scoreboard.events || []).map((e) => [e.id, e]));
  const events = new Map();
  for (const s of schedules) for (const e of s.events || []) events.set(e.id, live.get(e.id) || e);
  const games = [...events.values()].map((e) => toGame(team, e)).sort((a, b) => a.date - b.date);
  return { info: schedules[0].team, games };
}

// --- Formatting --------------------------------------------------------------

const when = (date) =>
  date.toLocaleString('en-US', {
    timeZone: TIMEZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

const opponent = (g) => `${g.us.home ? 'vs' : '@'} ${g.them.name}`;

function gameTitle(g) {
  if (g.state === 'in') return `🔴 LIVE ${g.detail} · ${g.us.name} ${g.us.score}–${g.them.score} ${g.them.name}`;
  if (g.state === 'post') {
    const [a, b] = [Number(g.us.score), Number(g.them.score)];
    const result = a > b ? 'W' : a < b ? 'L' : 'D';
    return `${result} ${g.us.score}–${g.them.score} ${opponent(g)} (${g.detail})`;
  }
  return `🗓 ${opponent(g)} · ${when(g.date)}`;
}

function gameOverview(g) {
  return [
    g.state === 'pre' ? `Starts ${when(g.date)}` : g.detail,
    g.venue && `Venue: ${g.venue}`,
    g.broadcasts.length && `Watch on: ${g.broadcasts.join(', ')}`,
  ].filter(Boolean).join('\n');
}

// Live games, plus the last few results and next few fixtures.
function visibleGames(games) {
  const past = games.filter((g) => g.state === 'post').slice(-PAST_GAMES);
  const live = games.filter((g) => g.state === 'in');
  const next = games.filter((g) => g.state === 'pre').slice(0, NEXT_GAMES);
  return [...past, ...live, ...next];
}

function headline(games) {
  const live = games.find((g) => g.state === 'in');
  if (live) return gameTitle(live);
  const next = games.find((g) => g.state === 'pre');
  return next ? `Next: ${opponent(next)} · ${when(next.date)}` : 'No upcoming games';
}

function teamMeta(team, { info, games }, withVideos) {
  const meta = {
    id: PREFIX + team.slug,
    type: TYPE,
    name: info.displayName,
    poster: info.logo,
    posterShape: 'square',
    logo: info.logo,
    description: [headline(games), [info.recordSummary, info.standingSummary].filter(Boolean).join(' · ')]
      .filter(Boolean).join('\n'),
  };
  if (withVideos) {
    meta.videos = visibleGames(games).map((g) => ({
      id: `${PREFIX}${team.slug}:${g.id}`,
      title: gameTitle(g),
      released: g.date.toISOString(),
      thumbnail: g.them.logo,
      overview: gameOverview(g),
    }));
  }
  return meta;
}

function gameStreams(team, g) {
  const search = (text) => ({
    name: 'Search',
    title: `🔍 Search Stremio for "${text}"`,
    externalUrl: `stremio:///search?search=${encodeURIComponent(text)}`,
  });
  return [
    search(team.search),
    search(`${g.us.name} ${g.them.name}`),
    {
      name: 'ESPN',
      title: [
        g.state === 'in' ? '📊 Live score & stats on ESPN' : '📊 Game page on ESPN',
        g.broadcasts.length && `📺 Official broadcast: ${g.broadcasts.join(', ')}`,
      ].filter(Boolean).join('\n'),
      externalUrl: g.link,
    },
  ];
}

// --- Stremio routes ------------------------------------------------------------

const findTeam = (slug) => TEAMS.find((t) => t.slug === slug);
const isLive = (games) => games.some((g) => g.state === 'in');

async function route(resource, type, id) {
  if (type !== TYPE) return null;
  if (resource === 'catalog' && id === 'myteams') {
    const data = await Promise.all(TEAMS.map(getTeam));
    return {
      metas: TEAMS.map((t, i) => teamMeta(t, data[i], false)),
      cacheMaxAge: data.some((d) => isLive(d.games)) ? 30 : 300,
    };
  }
  if (!id.startsWith(PREFIX)) return null;
  const [slug, gameId] = id.slice(PREFIX.length).split(':');
  const team = findTeam(slug);
  if (!team) return null;
  const data = await getTeam(team);
  const maxAge = isLive(data.games) ? 30 : 300;
  if (resource === 'meta') return { meta: teamMeta(team, data, true), cacheMaxAge: maxAge };
  if (resource === 'stream') {
    const game = data.games.find((g) => g.id === gameId);
    return { streams: game ? gameStreams(team, game) : [], cacheMaxAge: maxAge };
  }
  return null;
}

function landingPage(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const url = `${proto}://${host}/manifest.json`;
  const install = `stremio://${host}/manifest.json`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>My Teams addon</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;background:#14141f;color:#eee}
a.btn{display:inline-block;background:#7b5bf5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600}
code{background:#26263a;padding:4px 6px;border-radius:4px;word-break:break-all}</style></head><body>
<h1>My Teams</h1><p>${TEAMS.length} teams: ${TEAMS.map((t) => t.search).join(', ')}</p>
<p><a class="btn" href="${install}">Install in Stremio</a></p>
<p>Or paste this into Stremio's addon search box:<br><code>${url}</code></p></body></html>`;
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const send = (status, body, type = 'application/json', maxAge = 0) => {
    res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': `max-age=${maxAge}` });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  try {
    if (path === '/' || path === '/configure') return send(200, landingPage(req), 'text/html');
    if (path === '/manifest.json') return send(200, manifest, 'application/json', 3600);
    // Stremio paths look like /meta/channel/sportsteam:pelicans.json (extra args after the id are ignored).
    const m = path.match(/^\/(catalog|meta|stream)\/([^/]+)\/([^/]+?)(?:\/.*)?\.json$/);
    const result = m && (await route(m[1], m[2], m[3]));
    if (!result) return send(404, { error: 'not found' });
    send(200, result, 'application/json', result.cacheMaxAge);
  } catch (err) {
    console.error(err);
    send(500, { error: 'failed to load data from ESPN' });
  }
}).listen(PORT, () => console.log(`My Teams addon: http://127.0.0.1:${PORT}/manifest.json`));
