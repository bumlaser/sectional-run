// CORS relay for live traffic: a Cloudflare Worker that forwards adsb.lol position queries and adds the
// Access-Control-Allow-Origin header browsers need. adsb.lol itself doesn't send one.
//
// Deploy: dash.cloudflare.com → Workers & Pages → Create → "Hello World" worker → paste this file → Deploy.
// The free plan (100,000 requests a day, no payment card) is plenty. Then open the game once with
//   https://bumlaser.github.io/sectional-run/3d/?tfc=https://<your-worker>.workers.dev
// and it remembers the relay. Only the position query path is forwarded, and identical requests within
// 4 seconds are answered from Cloudflare's cache, so several viewers in one area cost adsb.lol one call.
const ALLOW = ['https://bumlaser.github.io', 'http://localhost:8765'];

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '', cors = { 'Access-Control-Allow-Origin': ALLOW.includes(origin) ? origin : ALLOW[0], Vary: 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    const u = new URL(req.url), m = u.pathname.match(/^\/v2\/lat\/(-?\d+(?:\.\d+)?)\/lon\/(-?\d+(?:\.\d+)?)\/dist\/(\d{1,3})$/);
    if (req.method !== 'GET' || !m || +m[3] > 100) return new Response('not found', { status: 404, headers: cors });
    const key = new Request(`https://api.adsb.lol${u.pathname}`), cache = caches.default;
    let res = await cache.match(key);
    if (!res) {
      const up = await fetch(key, { headers: { 'User-Agent': 'sectional-run traffic relay (github.com/bumlaser/sectional-run)' } });
      res = new Response(up.body, { status: up.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=4' } });
      if (up.ok) ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res); for (const [k, v] of Object.entries(cors)) out.headers.set(k, v); return out;
  },
};
