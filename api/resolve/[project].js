// GET /api/resolve/dmonline2 → { "url": "https://xxx.trycloudflare.com" }
const URLS_JSON = 'https://raw.githubusercontent.com/shimatoshi/project-urls/main/urls.json';
const CACHE_TTL = 30_000;
let cachedData = null;
let cacheTime = 0;

async function getUrls() {
  const now = Date.now();
  if (cachedData && now - cacheTime < CACHE_TTL) return cachedData;
  const r = await fetch(URLS_JSON, { headers: { 'User-Agent': 'url-board' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  cachedData = await r.json();
  cacheTime = now;
  return cachedData;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { project } = req.query;
  if (!project) return res.status(400).json({ error: 'Missing project' });

  try {
    const urls = await getUrls();
    const p = urls.projects?.[project];
    if (!p?.url) return res.status(404).json({ error: `Project "${project}" not found` });
    return res.status(200).json({ url: p.url, updated: p.updated });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
};
