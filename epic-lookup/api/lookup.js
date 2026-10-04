// Vercel Serverless Function (Node.js, CommonJS)
// GET /api/lookup?q=<displayName(<=16) | accountId(32hex)>

const BASIC =
  process.env.EPIC_BASIC ||
  Buffer.from(
    'ec684b8c687f479fadea3cb2ad83f5c6:e1f31c211f28413186262d37a13fc84d' // 公開されているfortnitePCGameClient
  ).toString('base64');

const ACCOUNT = 'https://account-public-service-prod.ol.epicgames.com/account/api';
const STATS = 'https://statsproxy-public-service-live.ol.epicgames.com/statsproxy/api/statsv2/account';

let cache = { token: null, exp: 0 };

async function getToken() {
  if (cache.token && Date.now() < cache.exp - 30000) return cache.token;
  const r = await fetch(`${ACCOUNT}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `basic ${BASIC}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(`token取得失敗 (${r.status}): ${j.errorMessage || j.errorCode || 'unknown'}`);
  }
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cache.token;
}

async function call(url, headers = {}) {
  try {
    const r = await fetch(url, { headers });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, body };
  } catch (e) {
    return { status: 0, body: String(e) };
  }
}

function summarize(raw) {
  const totals = {};
  const byMode = {};
  const byInput = {};
  let maxBpLevel = null;
  for (const [key, val] of Object.entries(raw || {})) {
    const lv = key.match(/^s(\d+)_social_bp_level$/);
    if (lv) {
      const s = Number(lv[1]);
      if (!maxBpLevel || s > maxBpLevel.season) maxBpLevel = { season: s, level: val };
      continue;
    }
    const p = key.split('_'); // br_kills_keyboardmouse_m0_playlist_defaultsolo
    if (p.length < 6 || p[4] !== 'playlist') continue;
    const metric = p[1], input = p[2], mode = p.slice(5).join('_');
    totals[metric] = (totals[metric] || 0) + val;
    (byInput[input] ||= {})[metric] = ((byInput[input] || {})[metric] || 0) + val;
    (byMode[mode] ||= {})[metric] = ((byMode[mode] || {})[metric] || 0) + val;
  }
  const kd = (o) => {
    const deaths = (o.matchesplayed || 0) - (o.placetop1 || 0);
    return deaths > 0 ? +((o.kills || 0) / deaths).toFixed(2) : null;
  };
  totals.kd = kd(totals);
  for (const o of Object.values(byMode)) o.kd = kd(o);
  for (const o of Object.values(byInput)) o.kd = kd(o);
  return { totals, byMode, byInput, latestSeasonLevel: maxBpLevel };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  const q = String(req.query.q || '').trim();
  const isId = /^[0-9a-f]{32}$/i.test(q);
  if (!q || (!isId && q.length > 16)) {
    return res.status(400).json({ error: '名前は16文字以内、IDは32桁(16進数)で入力してください' });
  }

  try {
    const token = await getToken();
    const auth = { Authorization: `bearer ${token}` };
    const errors = [];

    const acc = await call(
      isId
        ? `${ACCOUNT}/public/account/${q.toLowerCase()}`
        : `${ACCOUNT}/public/account/displayName/${encodeURIComponent(q)}`,
      auth
    );
    if (acc.status !== 200) {
      return res.status(acc.status === 404 ? 404 : 502).json({
        error: acc.status === 404 ? 'アカウントが見つかりません' : `Epic APIエラー (${acc.status})`,
        detail: acc.body,
      });
    }
    const id = acc.body.id;

    const [stats, fnapi] = await Promise.all([
      call(`${STATS}/${id}`, auth),
      call(`https://fortnite-api.com/v2/stats/br/v2?accountId=${id}&image=none`),
    ]);

    if (stats.status !== 200) errors.push(`statsproxy: ${stats.status} (非公開または取得不可の可能性)`);
    if (fnapi.status !== 200) errors.push(`fortnite-api.com: ${fnapi.status}`);

    res.status(200).json({
      input: { q, type: isId ? 'accountId' : 'displayName' },
      account: acc.body,
      stats: stats.status === 200 ? { summary: summarize(stats.body), rawKeyCount: Object.keys(stats.body || {}).length, raw: stats.body } : null,
      fortniteApi: fnapi.status === 200 ? fnapi.body.data : null,
      errors,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
