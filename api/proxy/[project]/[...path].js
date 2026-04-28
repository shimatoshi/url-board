// Vercel Serverless Function: reverse proxy via project URL lookup
// Route: /api/proxy/:project/:path*

const URLS_JSON = 'https://raw.githubusercontent.com/shimatoshi/project-urls/main/urls.json';
const CACHE_TTL = 30 * 1000; // 30 seconds

let cachedData = null;
let cacheTime = 0;

async function getUrls() {
  const now = Date.now();
  if (cachedData && now - cacheTime < CACHE_TTL) {
    return cachedData;
  }
  const res = await fetch(URLS_JSON);
  if (!res.ok) throw new Error(`Failed to fetch urls.json: ${res.status}`);
  cachedData = await res.json();
  cacheTime = now;
  return cachedData;
}

module.exports = async (req, res) => {
  // Handle CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { project, path: pathSegments } = req.query;
  if (!project) {
    return res.status(400).json({ error: 'Missing project parameter' });
  }

  let urls;
  try {
    urls = await getUrls();
  } catch (e) {
    return res.status(502).json({ error: 'Failed to fetch project URLs', detail: e.message });
  }

  const projectData = urls.projects?.[project];
  if (!projectData || !projectData.url) {
    return res.status(404).json({ error: `Project "${project}" not found or has no URL` });
  }

  // Build target URL
  const subPath = Array.isArray(pathSegments) ? pathSegments.join('/') : (pathSegments || '');
  const targetUrl = new URL(subPath, projectData.url.replace(/\/?$/, '/'));

  // Preserve query string (exclude Vercel's routing params)
  const originalUrl = new URL(req.url, `http://${req.headers.host}`);
  targetUrl.search = originalUrl.search;

  // Build headers to forward (skip hop-by-hop and Vercel internals)
  const skipHeaders = new Set([
    'host', 'connection', 'keep-alive', 'transfer-encoding',
    'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate',
    'x-vercel-id', 'x-vercel-deployment-url', 'x-vercel-forwarded-for',
    'x-real-ip', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host',
  ]);
  const forwardHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!skipHeaders.has(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  }
  forwardHeaders['host'] = targetUrl.host;

  // Forward the request
  try {
    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
      redirect: 'follow',
    };

    // Forward body for non-GET/HEAD requests
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
        fetchOptions.body = req.body;
      } else {
        fetchOptions.body = JSON.stringify(req.body);
      }
    }

    const upstream = await fetch(targetUrl.toString(), fetchOptions);

    // Forward response headers (skip hop-by-hop)
    const responseSkip = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade']);
    for (const [key, value] of upstream.headers.entries()) {
      if (!responseSkip.has(key.toLowerCase()) && key.toLowerCase() !== 'access-control-allow-origin') {
        res.setHeader(key, value);
      }
    }

    // Ensure CORS header is set (overwrite upstream if any)
    res.setHeader('Access-Control-Allow-Origin', '*');

    res.status(upstream.status);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.send(buffer);
  } catch (e) {
    return res.status(502).json({ error: 'Proxy request failed', detail: e.message });
  }
};
