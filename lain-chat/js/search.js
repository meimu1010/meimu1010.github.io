/* ==========================================================
   search.js
   Wired 検索実装 (多段フォールバック)
   [1] Tavily API        … キーがあれば最優先
   [2] Jina Reader→DDG   … キー不要・CORS対応 (無印20req/分)
   [3] DDG HTML + プロキシ… キー不要 (プロキシの可用性に依存)
   [4] Wikipedia API     … キー不要・公式CORS (origin=*)
   [5] DDG Instant Answer… キー不要・CORS常時開放 (最終手段)
   ========================================================== */

const SearchProviders = (() => {

  const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
  const DDG_PROXIES = [
    (url) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
    (url) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url),
    /* 注: corsproxy.io は APIキー必須になったため除外 */
  ];
  const clampMax = (n) => Math.min(Math.max(parseInt(n, 10) || 5, 1), 8);

  /** タイムアウト付き fetch (チェーンが1段で固まらないように) */
  async function fetchWithTimeout(url, opts = {}, ms = 20000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- [1] Tavily ---------- */
  async function tavilySearch(apiKey, query, maxResults) {
    const res = await fetchWithTimeout(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: query,
        search_depth: 'basic',
        topic: 'general',
        max_results: clampMax(maxResults),
        include_answer: false,
        include_raw_content: false
      })
    }, 25000);

    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.detail?.error || JSON.stringify(j); } catch (_) {}
      throw new Error('Tavily API error ' + res.status + ': ' + detail);
    }
    const data = await res.json();
    return {
      provider: 'tavily',
      results: (data.results || []).map(r => ({
        title: r.title || '',
        url: r.url || '',
        content: (r.content || '').slice(0, 600)
      }))
    };
  }

  /* ---------- [2] Jina Reader 経由の DuckDuckGo ---------- */

  /** Jina が返す markdown から検索結果を抽出 */
  function parseJinaMarkdown(md, max) {
    const results = [];
    let cur = null;
    const push = () => { if (cur) { results.push(cur); cur = null; } };

    for (const line of md.split('\n')) {
      /* 見出し行 = 検索結果: "# [Title](https://...)" */
      const h = line.match(/^#{1,4}\s+\[([^\]]+)\]\((https?:[^)\s]+)\)/);
      if (h) {
        push();
        /* DDG リダイレクト (duckduckgo.com/l/?uddg=<encoded>) を実URLに展開 */
        let url = h[2];
        const uddg = url.match(/[?&]uddg=([^&]+)/);
        if (uddg) url = decodeURIComponent(uddg[1]);
        /* 広告・内部リンク (展開後も duckduckgo.com のもの) は捨てる */
        if (!/^https?:\/\//.test(url) || url.includes('duckduckgo.com')) continue;
        cur = { title: h[1].trim(), url: url, content: '' };
        continue;
      }
      if (cur) {
        /* 画像・リンク記法を剥がして本文を蓄積 */
        const txt = line
          .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .trim();
        if (txt && cur.content.length < 700) {
          cur.content += (cur.content ? ' ' : '') + txt;
        }
      }
    }
    push();

    return results.slice(0, clampMax(max));
  }

  async function jinaDdgSearch(query, maxResults) {
    const target = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const res = await fetchWithTimeout('https://r.jina.ai/' + target, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, 30000);
    if (!res.ok) throw new Error('Jina Reader HTTP ' + res.status);
    const md = await res.text();
    const results = parseJinaMarkdown(md, maxResults);
    if (results.length === 0) throw new Error('Jina: no results parsed');
    return { provider: 'jina+ddg', results };
  }

  /* ---------- [3] DuckDuckGo HTML + 公開CORSプロキシ ---------- */
  async function ddgProxySearch(query, maxResults) {
    const target = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    let lastErr = null;

    for (const proxyFn of DDG_PROXIES) {
      try {
        const res = await fetchWithTimeout(proxyFn(target), { method: 'GET' }, 15000);
        if (!res.ok) throw new Error('proxy HTTP ' + res.status);
        const html = await res.text();

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const anchors = doc.querySelectorAll('a.result__a');
        const results = [];

        anchors.forEach((a) => {
          if (results.length >= clampMax(maxResults)) return;
          let href = a.getAttribute('href') || '';
          const m = href.match(/uddg=([^&]+)/); // DDG リダイレクトの展開
          if (m) href = decodeURIComponent(m[1]);
          if (!/^https?:\/\//.test(href) || href.includes('duckduckgo.com')) return;

          const snippetEl = a.closest('.result')?.querySelector('.result__snippet');
          results.push({
            title: (a.textContent || '').trim(),
            url: href,
            content: (snippetEl?.textContent || '').trim().slice(0, 500)
          });
        });

        if (results.length > 0) return { provider: 'ddg-proxy', results };
        throw new Error('no results parsed');
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error('DDG proxy failed: ' + (lastErr ? lastErr.message : 'unknown'));
  }

  /* ---------- [4] Wikipedia API (公式CORS: origin=*) ---------- */
  async function wikipediaSearch(query, maxResults, lang = 'ja') {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
      `&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${clampMax(maxResults)}` +
      `&prop=extracts%7Cinfo&inprop=url&exintro=1&explaintext=1&exsentences=3`;

    const res = await fetchWithTimeout(url, {
      headers: { 'Accept': 'application/json' }
    }, 15000);
    if (!res.ok) throw new Error('Wikipedia HTTP ' + res.status);
    const data = await res.json();

    const pages = data.query?.pages || {};
    let results = Object.values(pages)
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map(p => ({
        title: p.title || '',
        url: p.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title || '')}`,
        content: (p.extract || '').replace(/\n+/g, ' ').slice(0, 600)
      }))
      .filter(r => r.content.length > 0);

    /* 日本語版で空振りしたら英語版も試す */
    if (results.length === 0 && lang === 'ja') {
      return wikipediaSearch(query, maxResults, 'en');
    }
    if (results.length === 0) throw new Error('Wikipedia: no results');
    return { provider: 'wikipedia(' + lang + ')', results };
  }

  /* ---------- [5] DuckDuckGo Instant Answer API ---------- */
  async function ddgInstantSearch(query, maxResults) {
    const url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) +
      '&format=json&no_html=1&skip_disambig=1';
    const res = await fetchWithTimeout(url, {}, 15000);
    if (!res.ok) throw new Error('DDG instant HTTP ' + res.status);
    const j = await res.json();

    const results = [];
    if (j.AbstractText) {
      results.push({
        title: j.Heading || query,
        url: j.AbstractURL || '',
        content: j.AbstractText.slice(0, 600)
      });
    }
    const walk = (topics) => {
      for (const t of (topics || [])) {
        if (results.length >= clampMax(maxResults)) return;
        if (t.FirstURL && t.Text) {
          results.push({
            title: String(t.Text).split(' - ')[0].slice(0, 120),
            url: t.FirstURL,
            content: String(t.Text).slice(0, 400)
          });
        } else if (t.Topics) {
          walk(t.Topics);
        }
      }
    };
    walk(j.RelatedTopics);

    if (results.length === 0) throw new Error('DDG instant: empty answer');
    return { provider: 'ddg-instant', results };
  }

  /* ---------- キー不要チェーン ---------- */
  async function freeChainSearch(query, maxResults) {
    const attempts = [
      () => jinaDdgSearch(query, maxResults),
      () => ddgProxySearch(query, maxResults),
      () => wikipediaSearch(query, maxResults),
      () => ddgInstantSearch(query, maxResults),
    ];
    const errors = [];
    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (err) {
        errors.push(err.message);
        console.warn('[wired] search attempt failed:', err.message);
      }
    }
    throw new Error('すべてのキーフリー検索経路が失敗しました (' + errors.join(' / ') + ')');
  }

  /* ---------- 統一エントリポイント ---------- */
  /**
   * @param {{provider: string, tavilyKey: string}} cfg
   * @param {string} query
   * @param {number} maxResults
   */
  async function wiredSearch(cfg, query, maxResults) {
    const provider = cfg.provider || 'auto';
    const hasTavily = !!(cfg.tavilyKey && cfg.tavilyKey.trim());

    if (provider === 'tavily') {
      if (!hasTavily) throw new Error('Tavily API キーが設定されていません (⚙ CONFIG から登録してください)');
      return tavilySearch(cfg.tavilyKey.trim(), query, maxResults);
    }

    if (provider === 'free' || provider === 'ddg') { // 'ddg' は旧設定値の互換
      return freeChainSearch(query, maxResults);
    }

    /* auto: Tavily キーがあれば優先 → 失敗/未設定ならキーフリーチェーン */
    if (hasTavily) {
      try {
        return await tavilySearch(cfg.tavilyKey.trim(), query, maxResults);
      } catch (err) {
        console.warn('[wired] Tavily failed, falling back to free chain:', err);
        const out = await freeChainSearch(query, maxResults);
        out.note = 'Tavily に接続できなかったため、キーフリー経路で参照しました';
        return out;
      }
    }
    return freeChainSearch(query, maxResults);
  }

  return { wiredSearch, tavilySearch, jinaDdgSearch, ddgProxySearch, wikipediaSearch, ddgInstantSearch, freeChainSearch };
})();
