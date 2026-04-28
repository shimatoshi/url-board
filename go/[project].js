// GET /go/dmonline2 → 302 redirect to current tunnel URL
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
  const { project } = req.query;
  if (!project) return res.status(400).send('Missing project');

  try {
    const urls = await getUrls();
    const p = urls.projects?.[project];
    if (!p?.url) return res.status(404).send(`Project "${project}" not found`);
    res.writeHead(302, { Location: p.url });
    res.end();
  } catch (e) {
    res.status(502).send(e.message);
  }
};
