// Vercel Serverless Function: reverse proxy for root path
// Route: /api/proxy/:project

const URLS_JSON = 'https://raw.githubusercontent.com/shimatoshi/project-urls/main/urls.json';
const CACHE_TTL = 30_000;

let cachedData = null;
let cacheTime = 0;

async function getUrls() {
  const now = Date.now();
  if (cachedData && now - cacheTime < CACHE_TTL) return cachedData;
  const r = await fetch(URLS_JSON, { headers: { 'User-Agent': 'url-board-proxy' } });
  if (!r.ok) throw new Error(`Failed to fetch urls.json: ${r.status}`);
  cachedData = await r.json();
  cacheTime = now;
  return cachedData;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { project } = req.query;
  if (!project) return res.status(400).json({ error: 'Missing project' });

  let urls;
  try { urls = await getUrls(); } catch (e) {
    return res.status(502).json({ error: 'Failed to fetch urls.json', detail: e.message });
  }

  const p = urls.projects?.[project];
  if (!p?.url) return res.status(404).json({ error: `Project "${project}" not found` });

  const targetUrl = new URL('/', p.url);
  const orig = new URL(req.url, `http://${req.headers.host}`);
  targetUrl.search = orig.search;

  try {
    const opts = { method: req.method, headers: { 'User-Agent': 'url-board-proxy', 'Accept': '*/*' }, redirect: 'follow' };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      opts.body = typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? JSON.stringify(req.body) : req.body;
      opts.headers['Content-Type'] = req.headers['content-type'] || 'application/json';
    }

    const upstream = await fetch(targetUrl.toString(), opts);
    const body = Buffer.from(await upstream.arrayBuffer());

    const skip = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'content-encoding', 'access-control-allow-origin']);
    for (const [k, v] of upstream.headers.entries()) {
      if (!skip.has(k.toLowerCase())) res.setHeader(k, v);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(upstream.status).send(body);
  } catch (e) {
    return res.status(502).json({ error: 'Proxy failed', detail: e.message });
  }
};
