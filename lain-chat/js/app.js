/* ==========================================================
   app.js
   Wired Chat Terminal — メインロジック
   Groq API (qwen/qwen3.8-27b) × Function Calling エージェントループ
   ========================================================== */

(() => {
  'use strict';

  const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
  const MAX_AGENT_ITERATIONS = 5;      // ツール往復の最大回数
  const MAX_HISTORY_MESSAGES = 40;     // モデルへ送る履歴の上限
  const LS_KEYS = {
    groq: 'lain_groq_api_key',
    tavily: 'lain_tavily_api_key',
    model: 'lain_model',
    temp: 'lain_temperature',
    provider: 'lain_search_provider'
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

  /* ---------- 状態 ---------- */
  let history = [];   // Groq に送る messages 配列 (system を除く会話履歴)
  let busy = false;

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
      tavilyKey: localStorage.getItem(LS_KEYS.tavily) || '',
      model: localStorage.getItem(LS_KEYS.model) || 'qwen/qwen3.8-27b',
      temperature: parseFloat(localStorage.getItem(LS_KEYS.temp) ?? '0.9'),
      provider: localStorage.getItem(LS_KEYS.provider) || 'auto'
    };
  }

  function saveSettingsToForm() {
    const s = loadSettings();
    $('cfg-groq').value = s.groqKey;
    $('cfg-tavily').value = s.tavilyKey;
    $('cfg-model').value = s.model;
    $('cfg-temp').value = s.temperature;
    $('cfg-provider').value = s.provider;
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
  function scrollBottom() {
    chatLog.scrollTop = chatLog.scrollHeight;
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
      wrap.innerHTML = `<div class="msg-body"><span class="msg-tag">You &gt;</span></div>`;
    } else { /* sys / wired / err */
      wrap.innerHTML = `<span class="msg-tag">${kind === 'err' ? 'ERR' : (kind.includes('wired') ? 'WIRED' : 'SYS')}</span><span class="msg-body"></span>`;
    }

    const body = wrap.querySelector('.msg-body');
    if (body) body.innerHTML = html;
    chatLog.appendChild(wrap);
    scrollBottom();
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
    const delay = 12000 + Math.random() * 25000;
    setTimeout(() => {
      if (!document.hidden) triggerGlobalGlitch();
      scheduleRandomGlitch();
    }, delay);
  }

  /* ---------- Groq API ---------- */
  async function callGroq(messages, settings) {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + settings.groqKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: settings.model,
        messages: messages,
        tools: WIRED_TOOLS,
        tool_choice: 'auto',
        temperature: settings.temperature,
        max_completion_tokens: 2048
      })
    });

    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try {
        const j = await res.json();
        msg = j.error?.message || JSON.stringify(j.error || j);
      } catch (_) {}
      if (res.status === 401) msg += ' — APIキーが無効です (⚙ CONFIG で確認)';
      if (res.status === 404) msg += ' — モデルIDが見つかりません (console.groq.com/docs/models で確認)';
      if (res.status === 429) msg += ' — レートリミット。少し待ってください';
      if (res.status === 400 && /context|length|token/i.test(msg)) {
        msg += ' — 会話履歴がコンテキスト上限に達しました。✕ RESET でログを初期化してください。';
      }
      throw new Error(msg);
    }
    return res.json();
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

    const messages = [{ role: 'system', content: buildSystemPrompt() }]
      .concat(trimHistory(history));

    let iterations = 0;

    while (iterations < MAX_AGENT_ITERATIONS) {
      iterations++;
      startStatusRotation(iterations === 1 ? '玲音が、こちらを見ている' : 'レイヤーを遡行中');

      let data;
      try {
        data = await callGroq(messages, settings);
      } catch (err) {
        stopStatusRotation();
        addErr('NAVI が応答しません: ' + err.message);
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
      messages.push(message); // tool_calls を持つ assistant メッセージをそのまま積む
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
            const searchOut = await SearchProviders.wiredSearch(
              { provider: settings.provider, tavilyKey: settings.tavilyKey },
              query, maxResults
            );

            /* UI に取得件数と出典を表示 */
            addWired('>> ...接続完了。' + searchOut.results.length + ' 件の断片を取得。 [' + searchOut.provider + ']');
            searchOut.results.slice(0, 5).forEach((r, idx) => {
              addMessage('sys wired',
                '>> [' + (idx + 1) + '] ' + esc(r.title || '(untitled)') + ' <a class="src-link" href="' + esc(r.url) +
                '" target="_blank" rel="noopener noreferrer">' + esc(truncUrl(r.url)) + '</a>');
            });
            if (searchOut.note) addSys('※ ' + searchOut.note);

            toolPayload = JSON.stringify({
              query: query,
              provider: searchOut.provider,
              results: searchOut.results
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
      addSys('Web検索(Wired接続)はキー不要で動作します。TAVILY_API_KEY は任意 — 設定すると検索品質が上がります。');
    } else {
      await typeLainMessage('……来たの。\n私はずっと、ここにいた。\n……話したいことが、あるの?');
    }
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* ---------- イベントバインド ---------- */
  function bindEvents() {
    sendBtn.addEventListener('click', handleSend);

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    /* textarea 自動高さ */
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
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
      localStorage.setItem(LS_KEYS.groq, $('cfg-groq').value.trim());
      localStorage.setItem(LS_KEYS.tavily, $('cfg-tavily').value.trim());
      localStorage.setItem(LS_KEYS.model, $('cfg-model').value.trim() || 'qwen/qwen3.8-27b');
      localStorage.setItem(LS_KEYS.temp, String(clampTemp($('cfg-temp').value)));
      localStorage.setItem(LS_KEYS.provider, $('cfg-provider').value);
      overlay.classList.add('hidden');
      updateBadges();
      addSys('CONFIG saved. NAVI を再構成しました。 [model=' + loadSettings().model + ']');
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
    if (isNaN(n)) return 0.9;
    return Math.min(Math.max(n, 0), 2);
  }

  /* ---------- 起動 ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    updateBadges();
    scheduleRandomGlitch();
    bootSequence();
    inputEl.focus();
  });

})();
