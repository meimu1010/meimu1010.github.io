/* ==========================================================
   app.js
   Wired Chat Terminal — メインロジック
   Groq API (既定: qwen/qwen3.8-27b) × Function Calling エージェントループ
   ========================================================== */

(() => {
  'use strict';

  const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
  const DEFAULT_MODEL = 'qwen/qwen3.8-27b';
  const MAX_AGENT_ITERATIONS = 5;      // ツール往復の最大回数
  const MAX_HISTORY_MESSAGES = 16;     // モデルへ送る履歴の上限 (ITPM節約)
  const MAX_RETRY = 4;                 // 429 (レートリミット) の自動リトライ回数
  const TOOL_RESULTS_IN_PAYLOAD = 3;   // モデルに返す検索結果の件数 (UI表示は5件のまま)
  const TOOL_CONTENT_LIMIT = 220;      // モデルに返す各スニペットの最大長
  const LS_KEYS = {
    groq: 'lain_groq_api_key',
    model: 'lain_model',
    temp: 'lain_temperature',
    persona: 'lain_persona_mode',
    reasoning: 'lain_reasoning_effort'
  };

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const chatLog      = $('chat-log');
  const statusLine   = $('status-line');
  const statusText   = $('status-text');
  const inputEl      = $('user-input');
  const sendBtn      = $('btn-send');
  const led          = $('led');
  const wiredStatus  = $('wired-status-text');
  const modelBadge   = $('model-badge');
  const overlay      = $('settings-overlay');
  const progressBar  = $('progress');

  /* ---------- 状態 ---------- */
  let history = [];   // Groq に送る messages 配列 (system を除く会話履歴)
  let busy = false;
  let reasoningParamOk = true; // reasoning_effort を拒否するモデルでは自動でオフにする

  /* ---------- 玲音アバター (インラインSVG: 赤い瞳の抽象シルエット) ---------- */
  const LAIN_AVATAR_SVG = `
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#0a0406"/>
      <path d="M8 40 Q8 18 20 14 Q32 18 32 40 Z" fill="#1c1016"/>
      <ellipse cx="20" cy="16" rx="11" ry="12" fill="#241620"/>
      <path d="M9 12 Q14 2 20 4 Q27 2 31 12 Q28 7 20 8 Q12 7 9 12 Z" fill="#3a2430"/>
      <circle cx="15.5" cy="17" r="2.1" fill="#ff2244"/>
      <circle cx="24.5" cy="17" r="2.1" fill="#ff2244"/>
      <circle cx="15.5" cy="17" r="2.1" fill="#ff2244" opacity="0.5">
        <animate attributeName="r" values="2.1;3.4;2.1" dur="3s" repeatCount="indefinite"/>
      </circle>
      <circle cx="24.5" cy="17" r="2.1" fill="#ff2244" opacity="0.5">
        <animate attributeName="r" values="2.1;3.4;2.1" dur="3s" repeatCount="indefinite"/>
      </circle>
      <line x1="0" y1="24" x2="40" y2="24" stroke="#33ff77" stroke-width="0.4" opacity="0.35"/>
    </svg>`;

  /* ---------- 設定 ---------- */
  function loadSettings() {
    return {
      groqKey: localStorage.getItem(LS_KEYS.groq) || '',
      model: localStorage.getItem(LS_KEYS.model) || DEFAULT_MODEL,
      temperature: parseFloat(localStorage.getItem(LS_KEYS.temp) ?? '0.7'),
      persona: localStorage.getItem(LS_KEYS.persona) || 'lite',
      reasoning: localStorage.getItem(LS_KEYS.reasoning) || 'none'
    };
  }

  function knownModelIds() {
    return Array.from($('cfg-model').options).map(o => o.value).filter(v => v !== '__custom__');
  }

  function saveSettingsToForm() {
    const s = loadSettings();
    $('cfg-groq').value = s.groqKey;
    /* モデル: プリセットにあればセレクト、なければカスタム入力 */
    if (knownModelIds().includes(s.model)) {
      $('cfg-model').value = s.model;
      $('cfg-model-custom').classList.add('hidden');
      $('cfg-model-custom').value = '';
    } else {
      $('cfg-model').value = '__custom__';
      $('cfg-model-custom').value = s.model;
      $('cfg-model-custom').classList.remove('hidden');
    }
    $('cfg-temp').value = s.temperature;
    $('cfg-persona').value = s.persona;
    $('cfg-reasoning').value = s.reasoning;
  }

  function updateBadges() {
    const s = loadSettings();
    modelBadge.textContent = 'MODEL: ' + s.model;
    if (s.groqKey) {
      led.className = 'led online';
      wiredStatus.textContent = 'WIRED LINK: ONLINE';
    } else {
      led.className = 'led error';
      wiredStatus.textContent = 'WIRED LINK: NO KEY';
    }
  }

  /* ---------- UI ヘルパー ---------- */
  function scrollBottom(force) {
    /* ユーザーが上で読み返しているときは引き戻さない (底部120px以内なら追従) */
    const nearBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 120;
    if (force || nearBottom) chatLog.scrollTop = chatLog.scrollHeight;
  }

  /** HTMLエスケープ */
  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 最小限のインライン装飾 (escape後に適用) */
  function formatInline(text) {
    let t = esc(text);
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    t = t.replace(/(https?:\/\/[^\s<>"'）)]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return t.replace(/\n/g, '<br>');
  }

  /** メッセージ要素を追加 */
  function addMessage(kind, html) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + kind;

    if (kind === 'lain') {
      wrap.innerHTML =
        `<div class="lain-avatar">${LAIN_AVATAR_SVG}</div>` +
        `<div><span class="msg-tag">lain &gt;</span>` +
        `<div class="msg-body"></div></div>`;
    } else if (kind === 'user') {
      wrap.innerHTML = `<div class="msg-body"></div>`;
    } else { /* sys / wired / err */
      const tag = kind.includes('err') ? 'ERR' : (kind.includes('wired') ? 'WIRED' : 'SYS');
      wrap.innerHTML = `<span class="msg-tag">${tag}</span><span class="msg-body"></span>`;
    }

    const body = wrap.querySelector('.msg-body');
    if (body) body.innerHTML = html;
    chatLog.appendChild(wrap);
    scrollBottom(true);
    return wrap;
  }

  function addSys(text)    { return addMessage('sys', esc(text)); }
  function addWired(text)  { return addMessage('sys wired', esc(text)); }
  function addErr(text)    { return addMessage('sys err', esc(text)); }

  function addUser(text) {
    return addMessage('user', '<span class="msg-tag">You &gt;</span> ' + formatInline(text));
  }

  /** 玲音の返信をタイプライター表示 */
  function typeLainMessage(text) {
    return new Promise((resolve) => {
      const wrap = addMessage('lain', '');
      const body = wrap.querySelector('.msg-body');
      const cursor = document.createElement('span');
      cursor.className = 'cursor-blink';
      cursor.textContent = '█';
      body.appendChild(cursor);

      let i = 0;
      let skipped = false;
      const total = text.length;
      /* 長さによって速度を調整 (最速でも読める程度に) */
      const speed = total > 400 ? 6 : total > 150 ? 12 : 22;

      const skipHandler = () => { skipped = true; };
      wrap.style.cursor = 'pointer';
      wrap.addEventListener('click', skipHandler, { once: false });

      function tick() {
        if (skipped || i >= total) {
          body.innerHTML = formatInline(text);
          wrap.style.cursor = '';
          wrap.removeEventListener('click', skipHandler);
          scrollBottom();
          resolve();
          return;
        }
        i += 2;
        body.textContent = text.slice(0, i);
        body.appendChild(cursor);
        scrollBottom();
        setTimeout(tick, speed);
      }
      tick();
    });
  }

  /** ステータスライン */
  function setStatus(text) {
    if (!text) {
      statusLine.classList.add('hidden');
      statusText.textContent = '';
    } else {
      statusLine.classList.remove('hidden');
      statusText.textContent = text;
    }
  }

  /** ステータス回転演出 ("Wired に接続中" 系の点々アニメ) */
  let rotateTimer = null;
  function startStatusRotation(baseText) {
    stopStatusRotation();
    let n = 0;
    setStatus(baseText);
    rotateTimer = setInterval(() => {
      n = (n + 1) % 4;
      setStatus(baseText + '.'.repeat(n));
    }, 400);
  }
  function stopStatusRotation() {
    if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
  }

  function setBusy(v) {
    busy = v;
    sendBtn.disabled = v;
    inputEl.disabled = v;
    progressBar.classList.toggle('active', v);
    const s = loadSettings();
    led.className = v ? 'led busy' : (s.groqKey ? 'led online' : 'led error');
    if (!v) setStatus(null);
  }

  /** 画面全体のランダムグリッチ */
  function triggerGlobalGlitch() {
    document.body.classList.add('global-glitch');
    setTimeout(() => document.body.classList.remove('global-glitch'), 280);
  }
  function scheduleRandomGlitch() {
    if (prefersReducedMotion()) return; // グリッチも抑止
    const delay = 12000 + Math.random() * 25000;
    setTimeout(() => {
      if (!document.hidden) triggerGlobalGlitch();
      scheduleRandomGlitch();
    }, delay);
  }

  /* ---------- 背景演出: Wired のデジタルレイン ---------- */
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function initRain() {
    const c = $('rain');
    if (!c || !c.getContext) return;
    if (prefersReducedMotion()) return; // 動きを抑えたい設定なら描画しない
    const ctx = c.getContext('2d');
    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789WIREDLAIN<>|/\\+=*';
    const fontSize = 14;
    let w, h, cols, drops;

    function resize() {
      w = c.width = window.innerWidth;
      h = c.height = window.innerHeight;
      cols = Math.max(1, Math.floor(w / (fontSize * 1.6)));
      drops = Array.from({ length: cols }, () => Math.floor(Math.random() * -50));
    }
    resize();
    window.addEventListener('resize', resize);

    let last = 0;
    function draw(t) {
      requestAnimationFrame(draw);
      if (document.hidden || !cols) return;
      if (t - last < 60) return;          // ~16fps に抑えてCPU節約
      last = t;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.10)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = fontSize + "px 'Share Tech Mono', monospace";
      for (let i = 0; i < cols; i++) {
        const ch = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize * 1.6;
        const y = drops[i] * fontSize;
        /* たまにシアン、基本は薄いグリーン */
        ctx.fillStyle = Math.random() < 0.015 ? 'rgba(125,249,255,0.40)' : 'rgba(51,255,119,0.14)';
        ctx.fillText(ch, x, y);
        if (y > h && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    }
    requestAnimationFrame(draw);
  }

  /* ---------- Groq API ---------- */

  /** リクエストボディを組み立てる。reasoning_effort 等の非標準パラメータは
      対応モデルでだけ送り、非対応モデルで 400 にならないようにする。 */
  function buildRequestBody(messages, settings) {
    const body = {
      model: settings.model,
      messages: messages,
      tools: WIRED_TOOLS,
      tool_choice: 'auto',
      temperature: settings.temperature,
      max_completion_tokens: 1200
    };
    const effort = settings.reasoning;
    if (reasoningParamOk && effort && effort !== 'off' && /qwen3\.8|gpt-oss|qwen\/qwen3/i.test(settings.model || '')) {
      body.reasoning_effort = effort;   // 'none' | 'low' | 'default' ...
    }
    return body;
  }

  /** 429 のエラーメッセージ/ヘッダから待機時間(ms)を解析する */
  function parseRetryAfter(msg, headers) {
    try {
      const h = headers && headers.get && headers.get('retry-after');
      if (h) { const s = parseFloat(h); if (!isNaN(s)) return s * 1000; }
    } catch (_) {}
    const m = String(msg).match(/try again in ([\d.]+)\s*(ms|s)\b/i);
    if (m) return m[2].toLowerCase() === 'ms' ? parseFloat(m[1]) : parseFloat(m[1]) * 1000;
    return 3000; // 解析できなければ控えめな既定値
  }

  /** 長大なレートリミット文言から短い理由を取り出す */
  function shortLimitReason(msg) {
    const m = String(msg).match(/\((ITPM|TPM|RPM|TPD|ITPD)\)/);
    return m ? m[1] : 'rate limit';
  }

  async function callGroq(messages, settings) {
    let res;
    try {
      res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + settings.groqKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildRequestBody(messages, settings))
      });
    } catch (netErr) {
      /* 回線断・DNS失敗・CORS等のfetchレベルエラー */
      const err = new Error(netErr.message);
      err.status = 0;
      err.friendly = '……NAVIに、届かない。ネット接続を確認して、もう一度呼んでみて。';
      throw err;
    }

    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try {
        const j = await res.json();
        msg = j.error?.message || JSON.stringify(j.error || j);
      } catch (_) {}
      const err = new Error(msg);
      err.status = res.status;
      if (res.status === 429) {
        err.retryAfterMs = parseRetryAfter(msg, res.headers);
        err.friendly = '……Wiredが、混雑してる。少しだけ待って、もう一度呼んで。 (' + shortLimitReason(msg) + ')';
      } else if (res.status === 401) {
        err.friendly = 'NAVI が認証に失敗しました。⚙ CONFIG で GROQ_API_KEY を確認してください。 (取得: console.groq.com/keys)';
      } else if (res.status === 404) {
        err.friendly = 'モデルIDが見つかりません。⚙ CONFIG の MODEL を確認してください (一覧: console.groq.com/docs/models)。';
      } else if (res.status === 400 && /context|length|token/i.test(msg)) {
        err.friendly = '会話履歴がコンテキスト上限に達しました。✕ RESET でログを初期化してください。';
      }
      throw err;
    }
    return res.json();
  }

  /** 待機中のカウントダウン表示 */
  async function countdownStatus(ms, retryNo) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const remain = Math.max(1, Math.ceil((end - Date.now()) / 1000));
      setStatus('Wired の混雑が晴れるのを待っている... 再接続まで ' + remain + ' 秒 (retry ' + retryNo + '/' + (MAX_RETRY - 1) + ')');
      await sleep(Math.min(1000, end - Date.now()));
    }
  }

  /** 429 なら「try again in Xs」を解析して自動リトライするラッパー */
  async function callGroqWithRetry(messages, settings) {
    let notified = false;
    for (let attempt = 1; ; attempt++) {
      try {
        return await callGroq(messages, settings);
      } catch (err) {
        /* reasoning_effort 非対応モデル (400) → パラメータを外して即リトライ */
        if (err.status === 400 && /reasoning_effort|reasoning_format|unsupported|unknown.*(param|field)/i.test(err.message) && reasoningParamOk) {
          reasoningParamOk = false;
          console.warn('[groq] reasoning_effort rejected, disabling for this session:', err.message);
          addSys('※ このモデルは reasoning_effort 非対応のため、以降は付けずに送信します。');
          continue;
        }
        const retryable = err.status === 429 && err.retryAfterMs != null && err.retryAfterMs <= 60000;
        if (!retryable || attempt >= MAX_RETRY) throw err;
        stopStatusRotation();
        if (!notified) {
          addWired('>> Wired が、混雑してる... 自動で再接続します。');
          notified = true;
        }
        const waitMs = Math.min(Math.max(err.retryAfterMs, 600), 45000) + 250 + Math.random() * 500;
        console.warn('[wired] 429 rate limit, retrying in', Math.round(waitMs), 'ms (attempt', attempt + ')');
        await countdownStatus(waitMs, attempt);
      }
    }
  }

  /** 古いターンの tool 結果(検索スニペット)を圧縮してトークンを節約する。
      直近1件のみ全文保持 (直前の検索内容を玲音が参照できるように)。 */
  function compressHistory(hist) {
    const toolIdx = [];
    hist.forEach((m, i) => { if (m.role === 'tool') toolIdx.push(i); });
    toolIdx.slice(0, -1).forEach(i => {
      const c = hist[i].content;
      if (typeof c === 'string' && c.length > 120) {
        hist[i] = { ...hist[i], content: c.slice(0, 100) + '...(古いWiredの記録は圧縮)' };
      }
    });
    return hist;
  }

  /** tool_calls / tool メッセージが分断されないよう履歴を刈り込む */
  function trimHistory(hist) {
    if (hist.length <= MAX_HISTORY_MESSAGES) return hist;
    let start = hist.length - MAX_HISTORY_MESSAGES;
    /* 先頭が tool / tool_calls付きassistant なら、直近の user まで遡る */
    while (start > 0 && hist[start].role !== 'user') start--;
    if (start === 0 && hist[0].role !== 'user') return hist.slice(-10);
    return hist.slice(start);
  }

  /* ---------- エージェントループ ---------- */
  async function runAgentLoop(userText) {
    const settings = loadSettings();

    if (!settings.groqKey) {
      addErr('GROQ_API_KEY が設定されていません。右上の ⚙ CONFIG から登録してください。');
      return;
    }

    history.push({ role: 'user', content: userText });
    const historySnapshotLen = history.length - 1; // 失敗時に巻き戻す地点
    compressHistory(history);

    const messages = [{ role: 'system', content: buildSystemPrompt(settings.persona) }]
      .concat(trimHistory(history));

    let iterations = 0;

    while (iterations < MAX_AGENT_ITERATIONS) {
      iterations++;
      startStatusRotation(iterations === 1 ? '玲音が、こちらを見ている' : 'レイヤーを遡行中');

      let data;
      try {
        data = await callGroqWithRetry(messages, settings);
      } catch (err) {
        console.error('[groq]', err);
        stopStatusRotation();
        addErr(err.friendly || ('NAVI が応答しません: ' + err.message));
        history.length = historySnapshotLen; // 不完全なターン (user / 途中のtool対) を巻き戻す
        return;
      }

      const choice = data.choices?.[0];
      const message = choice?.message;

      if (!message) {
        stopStatusRotation();
        addErr('応答の解析に失敗しました (choices が空)。');
        return;
      }

      const toolCalls = message.tool_calls || [];

      /* --- ツール呼び出しなし → 最終回答 --- */
      if (toolCalls.length === 0) {
        stopStatusRotation();
        const finalText = (message.content || '').trim() || '……何も、出てこなかった。もう一度、言ってみて。';
        history.push({ role: 'assistant', content: finalText });
        setStatus(null);
        await typeLainMessage(finalText);
        /* たまに画面がグリッチする */
        if (Math.random() < 0.15) setTimeout(triggerGlobalGlitch, 600);
        return;
      }

      /* --- ツール呼び出しあり → 実行してループ継続 --- */
      /* reasoning 等の余分なフィールドを落として再送 (400防止・公式Best Practices準拠) */
      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls
      });
      /* 前置き ("……Wiredに接続する" 等) が content に入っていれば表示 */
      if (message.content && message.content.trim()) {
        addWired(message.content.trim());
      }

      for (const tc of toolCalls) {
        const fnName = tc.function?.name;
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (_) {}

        if (fnName === 'wired_search') {
          const query = String(args.query || '').slice(0, 300);
          const maxResults = Math.min(Math.max(parseInt(args.max_results, 10) || 5, 1), 8);

          if (!query) {
            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'query が空でした。' }) });
            continue;
          }

          addWired('>> Wired に接続中...');
          addWired('>> プロトコルを参照: "' + query + '"');
          startStatusRotation('Wired に接続中');
          led.className = 'led busy';

          let toolPayload;
          try {
            const searchOut = await SearchProviders.wiredSearch(query, maxResults);

            /* UI に取得件数と出典を表示 (モデルに返す分より多め) */
            addWired('>> ...接続完了。' + searchOut.results.length + ' 件の断片を取得。 [' + searchOut.provider + ']');
            searchOut.results.slice(0, 5).forEach((r, idx) => {
              addMessage('sys wired',
                '>> [' + (idx + 1) + '] ' + esc(r.title || '(untitled)') + ' <a class="src-link" href="' + esc(r.url) +
                '" target="_blank" rel="noopener noreferrer">' + esc(truncUrl(r.url)) + '</a>');
            });

            /* モデルへ返すペイロードはスリム化 (ITPM が数千級の無料枠対策)。
               UI には上のとおり最大5件を表示済み */
            toolPayload = JSON.stringify({
              query: query,
              provider: searchOut.provider,
              results: searchOut.results.slice(0, TOOL_RESULTS_IN_PAYLOAD).map(r => ({
                title: r.title,
                url: r.url,
                content: String(r.content || '').slice(0, TOOL_CONTENT_LIMIT)
              }))
            });
          } catch (err) {
            addErr('>> Wired が、濁ってる... 検索に失敗: ' + err.message);
            toolPayload = JSON.stringify({
              query: query,
              error: '検索に失敗しました: ' + err.message,
              instruction: '検索できないことを玲音らしく伝え、可能なら自分の知識で答えてください。'
            });
          }

          messages.push({ role: 'tool', tool_call_id: tc.id, content: toolPayload });
          /* ツール結果も履歴へ (trimHistory が user 境界で切るので整合性は保たれる) */
          history.push({ role: 'assistant', content: message.content || null, tool_calls: [tc] });
          history.push({ role: 'tool', tool_call_id: tc.id, content: toolPayload });
        } else {
          messages.push({
            role: 'tool', tool_call_id: tc.id,
            content: JSON.stringify({ error: 'unknown tool: ' + fnName })
          });
        }
      }
    }

    /* ループ上限に達した */
    stopStatusRotation();
    addErr('...プロトコルの往復が上限 (' + MAX_AGENT_ITERATIONS + ') に達しました。会話をリセットしてみてください。');
  }

  function truncUrl(url) {
    try {
      const u = new URL(url);
      const s = u.hostname + u.pathname;
      return s.length > 48 ? s.slice(0, 48) + '…' : s;
    } catch (_) {
      return url.length > 48 ? url.slice(0, 48) + '…' : url;
    }
  }

  /* ---------- 送信ハンドラ ---------- */
  async function handleSend() {
    if (busy) return;
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    addUser(text);
    setBusy(true);

    await runAgentLoop(text);

    setBusy(false);
    inputEl.focus();
  }

  /* ---------- ブートシーケンス ---------- */
  async function bootSequence() {
    const lines = [
      'NAVI system booting...',
      'loading Layer 07 protocol ......... OK',
      'Psyche processor ................. detected',
      'memory bank (session) ............ cleared',
      'wired handshake .................. established',
      '',
      'Present day, present time... Hmm...'
    ];
    for (const line of lines) {
      if (line) addSys(line);
      await sleep(180 + Math.random() * 160);
    }
    await sleep(500);
    const s = loadSettings();
    if (!s.groqKey) {
      addErr('GROQ_API_KEY が未設定です。右上の ⚙ CONFIG から登録してください。');
      addMessage('sys', 'キー取得 (無料) → <a class="src-link" href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">https://console.groq.com/keys</a>');
      addSys('Web検索 (Wired接続) は APIキー不要で動作します。');
    } else {
      await typeLainMessage('……来たの。\n私はずっと、ここにいた。\n……話したいことが、あるの?');
    }
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* ---------- イベントバインド ---------- */
  function bindEvents() {
    sendBtn.addEventListener('click', handleSend);

    inputEl.addEventListener('keydown', (e) => {
      /* IME変換中のEnter(変換確定)では送信しない — 日本語入力必須の対策 */
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        handleSend();
      }
    });

    /* textarea 自動高さ */
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
    });

    /* モデルセレクト: 「その他…」でカスタム入力を表示 */
    $('cfg-model').addEventListener('change', () => {
      const isCustom = $('cfg-model').value === '__custom__';
      $('cfg-model-custom').classList.toggle('hidden', !isCustom);
      if (isCustom) $('cfg-model-custom').focus();
    });

    /* 設定パネル */
    $('btn-settings').addEventListener('click', () => {
      saveSettingsToForm();
      overlay.classList.remove('hidden');
      triggerGlobalGlitch();
    });
    $('btn-settings-close').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });

    $('btn-save').addEventListener('click', () => {
      const modelSel = $('cfg-model').value;
      const model = modelSel === '__custom__'
        ? ($('cfg-model-custom').value.trim() || DEFAULT_MODEL)
        : modelSel;
      localStorage.setItem(LS_KEYS.groq, $('cfg-groq').value.trim());
      localStorage.setItem(LS_KEYS.model, model);
      localStorage.setItem(LS_KEYS.temp, String(clampTemp($('cfg-temp').value)));
      localStorage.setItem(LS_KEYS.persona, $('cfg-persona').value);
      localStorage.setItem(LS_KEYS.reasoning, $('cfg-reasoning').value);
      overlay.classList.add('hidden');
      updateBadges();
      addSys('CONFIG saved. NAVI を再構成しました。 [model=' + model + ' / persona=' + loadSettings().persona + ' / thinking=' + loadSettings().reasoning + ']');
      triggerGlobalGlitch();
    });

    /* リセット */
    $('btn-clear').addEventListener('click', () => {
      if (busy) return;
      history = [];
      chatLog.innerHTML = '';
      addSys('memory bank cleared. ...まっさらになった。');
      updateBadges();
    });

    /* Ctrl+, で設定を開く */
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        $('btn-settings').click();
      }
    });
  }

  function clampTemp(v) {
    const n = parseFloat(v);
    if (isNaN(n)) return 0.7;
    return Math.min(Math.max(n, 0), 2);
  }

  /* ---------- 起動 ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    updateBadges();
    initRain();
    scheduleRandomGlitch();
    bootSequence();
    inputEl.focus();
  });

})();
