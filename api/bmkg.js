'use strict';

// Proxy server-side untuk data terbuka BMKG.
// Kenapa proxy: api.bmkg.go.id tidak mengirim header CORS, jadi tidak bisa
// dipanggil langsung dari browser. Fungsi ini menarik data di server lalu
// meneruskannya ke dashboard dengan header CORS yang benar.
// Endpoint: /api/bmkg?kind=forecast  -> prakiraan 3 harian per desa (adm4)
//           /api/bmkg?kind=nowcast   -> peringatan dini cuaca (check + Jatim)

const SOURCES = {
  forecast: 'https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=35.15.06.2008',
  nowcastCheck: 'https://bmkg-api.dhanypedia.com/v1/nowcast/check?location=Tanggulangin&lang=id',
  nowcastJatim: 'https://bmkg-api.dhanypedia.com/v1/nowcast'
};

const TTL_MS = {
  forecast: 3 * 60 * 60 * 1000,   // BMKG memperbarui prakiraan tiap 3 jam
  nowcast: 2 * 60 * 60 * 1000     // nowcast ~2 jam
};

// Cache dalam memori proses (serverless hangat + dev-server).
const cache = new Map();

function send(res, status, payload, ttlSec = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', `public, max-age=${ttlSec}`);
  res.end(JSON.stringify(payload));
}

async function getJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'RencangFarm-Dashboard/1.0 (+data terbuka BMKG)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} dari ${new URL(url).hostname}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Gunakan GET' });

  const url = new URL(req.url || '/api/bmkg', 'https://local.invalid');
  const kind = url.searchParams.get('kind') === 'nowcast' ? 'nowcast' : 'forecast';
  const key = kind;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS[kind]) {
    return send(res, 200, hit.data, Math.floor((TTL_MS[kind] - (Date.now() - hit.at)) / 1000));
  }

  try {
    let data;
    if (kind === 'forecast') {
      const raw = await getJson(SOURCES.forecast);
      data = { ok: true, kind, data: raw, fetchedAt: new Date().toISOString() };
    } else {
      const [checkRaw, jatimRaw] = await Promise.allSettled([
        getJson(SOURCES.nowcastCheck),
        getJson(SOURCES.nowcastJatim)
      ]);
      data = {
        ok: true,
        kind,
        check: checkRaw.status === 'fulfilled' ? checkRaw.value : null,
        jatim: jatimRaw.status === 'fulfilled' ? jatimRaw.value : null,
        fetchedAt: new Date().toISOString()
      };
    }
    cache.set(key, { at: Date.now(), data });
    return send(res, 200, data, Math.floor(TTL_MS[kind] / 1000));
  } catch (err) {
    return send(res, 502, { ok: false, error: String(err.message || err) });
  }
};
