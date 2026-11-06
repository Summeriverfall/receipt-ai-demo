/* 小票 Demo：默认免 Key 本地演示；可选 Gemini；二维码 jsQR 本地解 */
(() => {
  const $ = (id) => document.getElementById(id);
  const MODEL = 'gemini-2.5-flash';
  const PRICE = { inputPerM: 0.3, outputPerM: 2.5 };
  const KEY_STORAGE = 'receipt_demo_gemini_key';
  const HIST_STORAGE = 'receipt_demo_history_v1';

  const RECEIPT_PROMPT = `你是一个日本小票识别专家。请识别这张小票图片，提取以下信息并以 JSON 格式返回：

shop_name: 店铺名
date: 消费日期（格式 YYYY-MM-DD）
time: 消费时间（格式 HH:MM）
items: 商品列表，每项包含 name（商品名）、quantity（数量）、unit_price（单价）、total_price（该行总价）
subtotal: 小计金额
tax: 税额（区分 8% 和 10% 如果有）
total: 总金额
currency: 货币（JPY/CNY）
confidence: 对每个字段的置信度评估（0-1 之间），至少包含 total、date、items
raw_text: AI 识别的原始全文

注意：
- 日文商品名保留原文，不要翻译
- 金额只输出数字，不要带货币符号
- 如果某个字段无法识别，输出 null
- 只输出 JSON，不要输出其他文字`;

  const SAMPLES = [
    {
      title: 'セブン‐イレブン',
      sub: '東京駅前店',
      dateLabel: '2026年11月5日(水) 18:42',
      lines: [
        ['ホットコーヒー', '¥130'],
        ['おにぎり鮭', '¥146'],
        ['お茶 500ml', '¥108'],
      ],
      tax8: 28,
      tax10: 13,
      total: 384,
      note: '税込',
      result: {
        shop_name: 'セブン‐イレブン 東京駅前店',
        date: '2026-11-05',
        time: '18:42',
        items: [
          { name: 'ホットコーヒー', quantity: 1, unit_price: 130, total_price: 130 },
          { name: 'おにぎり鮭', quantity: 1, unit_price: 146, total_price: 146 },
          { name: 'お茶 500ml', quantity: 1, unit_price: 108, total_price: 108 },
        ],
        subtotal: 343,
        tax: 41,
        total: 384,
        currency: 'JPY',
        confidence: { total: 0.98, date: 0.99, items: 0.96 },
        raw_text:
          'セブン‐イレブン 東京駅前店\n2026年11月5日(水) 18:42\nホットコーヒー ¥130\nおにぎり鮭 ¥146\nお茶 500ml ¥108\n小計 ¥343\n消費税 ¥41\n合計 ¥384',
      },
    },
    {
      title: 'ライフ 浅草店',
      sub: 'スーパーマーケット',
      dateLabel: '2026年11月4日(火) 12:15',
      lines: [
        ['牛乳 1L', '¥218'],
        ['卵 10個', '¥298'],
        ['食パン', '¥168'],
        ['バナナ', '¥128'],
      ],
      tax8: 58,
      tax10: 0,
      total: 812,
      note: '軽減税率対象あり',
      result: {
        shop_name: 'ライフ 浅草店',
        date: '2026-11-04',
        time: '12:15',
        items: [
          { name: '牛乳 1L', quantity: 1, unit_price: 218, total_price: 218 },
          { name: '卵 10個', quantity: 1, unit_price: 298, total_price: 298 },
          { name: '食パン', quantity: 1, unit_price: 168, total_price: 168 },
          { name: 'バナナ', quantity: 1, unit_price: 128, total_price: 128 },
        ],
        subtotal: 754,
        tax: 58,
        total: 812,
        currency: 'JPY',
        confidence: { total: 0.97, date: 0.98, items: 0.94 },
        raw_text:
          'ライフ 浅草店\n2026年11月4日(火) 12:15\n牛乳 1L ¥218\n卵 10個 ¥298\n食パン ¥168\nバナナ ¥128\n小計 ¥754\n消費税(8%) ¥58\n合計 ¥812',
      },
    },
    {
      title: '居酒屋 まつや',
      sub: '手書き伝票風',
      dateLabel: '2026/11/03 19:50',
      lines: [
        ['生ビール ×2', '¥980'],
        ['唐揚げ', '¥580'],
        ['枝豆', '¥380'],
      ],
      tax8: 0,
      tax10: 194,
      total: 2134,
      note: '※手書き風サンプル',
      result: {
        shop_name: '居酒屋 まつや',
        date: '2026-11-03',
        time: '19:50',
        items: [
          { name: '生ビール', quantity: 2, unit_price: 490, total_price: 980 },
          { name: '唐揚げ', quantity: 1, unit_price: 580, total_price: 580 },
          { name: '枝豆', quantity: 1, unit_price: 380, total_price: 380 },
        ],
        subtotal: 1940,
        tax: 194,
        total: 2134,
        currency: 'JPY',
        confidence: { total: 0.9, date: 0.92, items: 0.85 },
        raw_text:
          '居酒屋 まつや\n2026/11/03 19:50\n生ビール ×2 ¥980\n唐揚げ ¥580\n枝豆 ¥380\n小計 ¥1940\n消費税(10%) ¥194\n合計 ¥2134',
      },
    },
  ];

  const CFG = window.RECEIPT_DEMO_CONFIG || {};
  const PROXY_URL = (CFG.recognizeUrl || '').trim();

  const state = {
    imageDataUrl: null,
    mimeType: 'image/jpeg',
    current: null,
    editing: false,
    stream: null,
    useBackend: false,
    sampleIndex: null,
  };

  const els = {
    healthBadge: $('healthBadge'),
    btnKey: $('btnKey'),
    keyPanel: $('keyPanel'),
    keyInput: $('keyInput'),
    btnSaveKey: $('btnSaveKey'),
    btnClearKey: $('btnClearKey'),
    btnQuickDemo: $('btnQuickDemo'),
    video: $('videoPreview'),
    canvas: $('captureCanvas'),
    imagePreview: $('imagePreview'),
    previewPlaceholder: $('previewPlaceholder'),
    fileInput: $('fileInput'),
    btnCamera: $('btnCamera'),
    btnSnap: $('btnSnap'),
    btnRecognize: $('btnRecognize'),
    btnReset: $('btnReset'),
    btnSamples: $('btnSamples'),
    sampleMenu: $('sampleMenu'),
    loading: $('loadingOverlay'),
    metaLine: $('metaLine'),
    resultImage: $('resultImage'),
    resultImageEmpty: $('resultImageEmpty'),
    rawText: $('rawText'),
    jsonView: $('jsonView'),
    jsonViewWrap: $('jsonViewWrap'),
    jsonEdit: $('jsonEdit'),
    btnEdit: $('btnEdit'),
    btnSave: $('btnSave'),
    btnCancelEdit: $('btnCancelEdit'),
    flagNeedsReview: $('flagNeedsReview'),
    flagVertical: $('flagVertical'),
    historyList: $('historyList'),
    btnRefreshHistory: $('btnRefreshHistory'),
  };

  function toast(msg, isError) {
    const n = document.createElement('div');
    n.className = `fixed bottom-4 right-4 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg text-sm text-white ${
      isError ? 'bg-red-600' : 'bg-slate-800'
    }`;
    n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3200);
  }

  function getApiKey() {
    return (localStorage.getItem(KEY_STORAGE) || '').trim();
  }

  function canRealRecognize() {
    return state.useBackend || Boolean(PROXY_URL) || Boolean(getApiKey());
  }

  function setApiKey(key) {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
    updateKeyBadge();
  }

  /** 从 URL ?key= / #key= / config.geminiApiKey 注入，避免每次手填 */
  function bootstrapApiKey() {
    const cfgKey = (CFG.geminiApiKey || '').trim();
    if (cfgKey) setApiKey(cfgKey);

    let fromUrl = '';
    try {
      const q = new URLSearchParams(location.search);
      fromUrl = (q.get('key') || '').trim();
      if (!fromUrl && location.hash) {
        const h = new URLSearchParams(location.hash.replace(/^#/, ''));
        fromUrl = (h.get('key') || '').trim();
      }
    } catch (_) {}

    if (fromUrl) {
      setApiKey(fromUrl);
      // 去掉地址栏里的 key，避免分享屏幕时泄露
      try {
        const clean = location.pathname + location.search.replace(/[?&]key=[^&]*/g, '').replace(/^&/, '?').replace(/\?$/, '');
        history.replaceState(null, '', clean + (location.hash && !location.hash.includes('key=') ? location.hash : ''));
      } catch (_) {}
      toast('真实识别 Key 已写入本机，可拍真小票');
    }

    if (els.keyInput) els.keyInput.value = getApiKey();
  }

  function updateKeyBadge() {
    if (state.useBackend) return;
    if (PROXY_URL || (CFG.geminiApiKey || '').trim() || getApiKey()) {
      els.healthBadge.textContent = '真实识别已就绪';
      els.healthBadge.className = 'px-2.5 py-1 rounded-full badge-ok text-xs font-medium';
      if (els.btnKey && (PROXY_URL || (CFG.geminiApiKey || '').trim())) {
        els.btnKey.classList.add('hidden');
      }
      return;
    }
    els.healthBadge.textContent = '演示可用 · 真票需配置 Key';
    els.healthBadge.className = 'px-2.5 py-1 rounded-full badge-warn text-xs font-medium';
  }

  async function detectBackend() {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      if (!r.ok) throw new Error('no');
      const d = await r.json();
      state.useBackend = true;
      els.healthBadge.textContent = d.hasKey ? '本地服务 · Key 就绪' : '本地服务 · 演示可用';
      els.healthBadge.className = 'px-2.5 py-1 rounded-full badge-ok text-xs font-medium';
    } catch {
      state.useBackend = false;
      updateKeyBadge();
    }
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function stripJsonFence(text) {
    if (!text) return '';
    let t = String(text).trim();
    if (t.startsWith('```')) {
      t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }
    return t.trim();
  }

  function parseReceiptJson(text) {
    const cleaned = stripJsonFence(text);
    try {
      return JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('模型返回的内容不是合法 JSON');
    }
  }

  function estimateCostUsd(usage) {
    const prompt = Number(usage?.promptTokenCount || 0);
    const candidates = Number(usage?.candidatesTokenCount || 0);
    const thoughts = Number(usage?.thoughtsTokenCount || 0);
    const output = candidates + thoughts;
    const cost = (prompt / 1e6) * PRICE.inputPerM + (output / 1e6) * PRICE.outputPerM;
    return {
      inputTokens: prompt,
      outputTokens: output,
      totalTokens: Number(usage?.totalTokenCount || prompt + output),
      estimatedCostUsd: Number(cost.toFixed(6)),
    };
  }

  function detectVerticalHint(rawText) {
    if (!rawText || typeof rawText !== 'string') return false;
    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 4) return false;
    const shortLines = lines.filter((l) => [...l].length <= 2).length;
    return shortLines / lines.length >= 0.45;
  }

  function loadLocalHistory() {
    try {
      return JSON.parse(localStorage.getItem(HIST_STORAGE) || '[]');
    } catch {
      return [];
    }
  }

  function saveLocalHistory(list) {
    localStorage.setItem(HIST_STORAGE, JSON.stringify(list.slice(0, 40)));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function decodeQrFromDataUrl(dataUrl) {
    if (typeof jsQR !== 'function') return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const max = 800;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const imageData = ctx.getImageData(0, 0, c.width, c.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        resolve(code?.data || null);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async function callGeminiDirect(base64, mimeType) {
    const key = getApiKey();
    if (!key) throw new Error('未配置 Gemini Key');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: RECEIPT_PROMPT },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Gemini 错误 ${res.status}`);
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    return { text, usageMetadata: data.usageMetadata };
  }

  function buildRecord({ parsed, rawModelText, elapsedMs, usage, thumbnail, model }) {
    const confidence = parsed.confidence || {};
    const totalConf = Number(confidence.total ?? 0);
    const cost = estimateCostUsd(usage);
    return {
      id: uuid(),
      createdAt: new Date().toISOString(),
      model: model || MODEL,
      elapsedMs,
      ...cost,
      needsReview: !(totalConf >= 0.7),
      verticalHint: detectVerticalHint(parsed.raw_text || rawModelText),
      imagePreview: thumbnail,
      result: {
        shop_name: parsed.shop_name ?? null,
        date: parsed.date ?? null,
        time: parsed.time ?? null,
        items: Array.isArray(parsed.items) ? parsed.items : [],
        subtotal: parsed.subtotal ?? null,
        tax: parsed.tax ?? null,
        total: parsed.total ?? null,
        currency: parsed.currency ?? 'JPY',
        confidence: {
          total: confidence.total ?? null,
          date: confidence.date ?? null,
          items: confidence.items ?? null,
          ...(typeof confidence === 'object' && !Array.isArray(confidence) ? confidence : {}),
        },
        raw_text: parsed.raw_text || stripJsonFence(rawModelText),
        qr_payload: parsed.qr_payload ?? null,
      },
      rawModelText,
      edited: false,
    };
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    els.video.classList.add('hidden');
    els.btnSnap.classList.add('hidden');
  }

  function setPreview(dataUrl, mime, sampleIndex = null) {
    stopCamera();
    state.imageDataUrl = dataUrl;
    state.mimeType = mime || 'image/jpeg';
    state.sampleIndex = sampleIndex;
    els.imagePreview.src = dataUrl;
    els.imagePreview.classList.remove('hidden');
    els.previewPlaceholder.classList.add('hidden');
    els.btnRecognize.disabled = false;
  }

  function clearAll() {
    stopCamera();
    state.imageDataUrl = null;
    state.current = null;
    state.editing = false;
    state.sampleIndex = null;
    els.fileInput.value = '';
    els.imagePreview.classList.add('hidden');
    els.imagePreview.removeAttribute('src');
    els.previewPlaceholder.classList.remove('hidden');
    els.btnRecognize.disabled = true;
    els.btnEdit.disabled = true;
    els.btnSave.classList.add('hidden');
    els.btnCancelEdit.classList.add('hidden');
    els.btnEdit.classList.remove('hidden');
    els.jsonEdit.classList.add('hidden');
    els.jsonViewWrap.classList.remove('hidden');
    els.metaLine.textContent = '等待识别…';
    els.rawText.textContent = '—';
    els.jsonView.textContent = '{}';
    els.resultImage.classList.add('hidden');
    els.resultImageEmpty.classList.remove('hidden');
    els.flagNeedsReview.classList.add('hidden');
    els.flagVertical.classList.add('hidden');
    if (window.Prism) Prism.highlightElement(els.jsonView);
  }

  function makeThumbnail(dataUrl, max = 240) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function renderResult(record) {
    state.current = record;
    state.editing = false;
    const r = record.result || {};
    const modeHint = record.model === 'local-demo' ? '本地演示' : record.model || '';
    els.metaLine.textContent = `耗时 ${record.elapsedMs} ms · 约 $${Number(
      record.estimatedCostUsd || 0
    ).toFixed(6)} · ${modeHint}${record.edited ? ' · 已人工修正' : ''}${
      r.qr_payload ? ' · 已解二维码' : ''
    }`;

    els.flagNeedsReview.classList.toggle('hidden', !record.needsReview);
    els.flagVertical.classList.toggle('hidden', !record.verticalHint);

    const imgSrc = record.imagePreview || state.imageDataUrl;
    if (imgSrc) {
      els.resultImage.src = imgSrc;
      els.resultImage.classList.remove('hidden');
      els.resultImageEmpty.classList.add('hidden');
    }

    els.rawText.textContent = r.raw_text || '—';
    const jsonPretty = JSON.stringify(r, null, 2);
    els.jsonView.textContent = jsonPretty;
    els.jsonEdit.value = jsonPretty;
    els.jsonEdit.classList.add('hidden');
    els.jsonViewWrap.classList.remove('hidden');
    els.btnEdit.disabled = false;
    els.btnEdit.classList.remove('hidden');
    els.btnSave.classList.add('hidden');
    els.btnCancelEdit.classList.add('hidden');
    if (window.Prism) Prism.highlightElement(els.jsonView);
  }

  function formatMoney(n, currency) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    if ((currency || 'JPY') === 'JPY') return `¥${Number(n).toLocaleString('ja-JP')}`;
    return `${currency} ${Number(n)}`;
  }

  function confPct(v) {
    if (v == null || Number.isNaN(Number(v))) return '—';
    return `${Math.round(Number(v) * 100)}%`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderHistory(list) {
    if (!list || !list.length) {
      els.historyList.innerHTML = '<p class="text-sm text-slate-400 py-6 text-center">暂无记录</p>';
      return;
    }
    els.historyList.innerHTML = list
      .map((item) => {
        const r = item.result || {};
        const thumb = item.imagePreview
          ? `<img class="thumb" src="${item.imagePreview}" alt="" />`
          : `<div class="thumb"></div>`;
        return `
        <details class="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <summary class="cursor-pointer list-none flex items-center gap-3 p-3 hover:bg-slate-50">
            ${thumb}
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium truncate">${escapeHtml(r.shop_name || '未知店铺')}</span>
                ${item.model === 'local-demo' ? '<span class="text-[10px] px-1.5 py-0.5 rounded badge-ok">本地</span>' : ''}
                ${item.needsReview ? '<span class="text-[10px] px-1.5 py-0.5 rounded badge-warn">需确认</span>' : ''}
              </div>
              <div class="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                <span>总额 ${formatMoney(r.total, r.currency)}</span>
                <span>置信度 ${confPct(r.confidence?.total)}</span>
                <span>${item.elapsedMs} ms</span>
                <span>~$${Number(item.estimatedCostUsd || 0).toFixed(6)}</span>
              </div>
            </div>
          </summary>
          <div class="border-t px-3 py-3 bg-slate-50 text-xs">
            <pre class="whitespace-pre-wrap font-mono text-[11px] overflow-auto max-h-64">${escapeHtml(
              JSON.stringify(r, null, 2)
            )}</pre>
            <button type="button" data-load-id="${item.id}" class="mt-2 text-accent hover:underline load-history">载入到上方结果区</button>
          </div>
        </details>`;
      })
      .join('');

    els.historyList.querySelectorAll('.load-history').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-load-id');
        const found = list.find((x) => x.id === id);
        if (found) {
          if (found.imagePreview) setPreview(found.imagePreview, 'image/jpeg', null);
          renderResult(found);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  async function loadHistory() {
    if (state.useBackend) {
      try {
        const r = await fetch('/api/history');
        renderHistory(await r.json());
      } catch {
        els.historyList.innerHTML = '<p class="text-sm text-red-500 py-4 text-center">历史加载失败</p>';
      }
      return;
    }
    renderHistory(loadLocalHistory());
  }

  function persistRecord(record) {
    if (state.useBackend) return;
    const list = loadLocalHistory();
    list.unshift(record);
    saveLocalHistory(list);
  }

  async function recognizeLocalSample(idx, thumbnail) {
    const sample = SAMPLES[idx];
    await sleep(450 + Math.random() * 350);
    const qr = await decodeQrFromDataUrl(state.imageDataUrl);
    const parsed = {
      ...sample.result,
      qr_payload: qr,
      raw_text:
        sample.result.raw_text +
        (qr ? `\n\n[QR 本地解码]\n${qr}` : '\n\n[QR] 未检测到'),
    };
    return buildRecord({
      parsed,
      rawModelText: parsed.raw_text,
      elapsedMs: 480,
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      thumbnail,
      model: 'local-demo',
    });
  }

  async function recognize() {
    if (!state.imageDataUrl) return;
    const isSample = state.sampleIndex != null;

    if (!isSample && !canRealRecognize()) {
      return toast('真实小票需要服务端 Key（或本地填 Key）；也可先点「一键演示」', true);
    }

    els.loading.classList.remove('hidden');
    els.btnRecognize.disabled = true;
    const started = Date.now();
    try {
      const thumbnailBase64 = await makeThumbnail(state.imageDataUrl);
      let record;

      if (isSample) {
        record = await recognizeLocalSample(state.sampleIndex, thumbnailBase64);
        persistRecord(record);
      } else if (state.useBackend || PROXY_URL) {
        const base64 = state.imageDataUrl.replace(/^data:[^;]+;base64,/, '');
        const endpoint = state.useBackend ? '/api/recognize' : PROXY_URL;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: base64,
            mimeType: state.mimeType,
            thumbnailBase64,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '识别失败');
        const qr = await decodeQrFromDataUrl(state.imageDataUrl);
        if (qr) {
          data.result = data.result || {};
          data.result.qr_payload = qr;
        }
        record = data;
        if (!state.useBackend) persistRecord(record);
      } else {
        const base64 = state.imageDataUrl.replace(/^data:[^;]+;base64,/, '');
        const { text, usageMetadata } = await callGeminiDirect(base64, state.mimeType);
        const parsed = parseReceiptJson(text);
        const qr = await decodeQrFromDataUrl(state.imageDataUrl);
        if (qr) parsed.qr_payload = qr;
        record = buildRecord({
          parsed,
          rawModelText: text,
          elapsedMs: Date.now() - started,
          usage: usageMetadata,
          thumbnail: thumbnailBase64,
          model: MODEL,
        });
        persistRecord(record);
      }

      renderResult(record);
      await loadHistory();
      toast(record.model === 'local-demo' ? '本地演示完成（未耗 API）' : '识别完成');
    } catch (err) {
      toast(err.message || '识别失败', true);
    } finally {
      els.loading.classList.add('hidden');
      els.btnRecognize.disabled = !state.imageDataUrl;
    }
  }

  function qrPayloadForSample(idx) {
    const r = SAMPLES[idx].result;
    return JSON.stringify({
      type: 'receipt-demo',
      shop: r.shop_name,
      date: r.date,
      total: r.total,
      currency: r.currency,
    });
  }

  async function drawReceipt(variant) {
    const W = 420;
    const H = 720;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#faf7f2';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';

    const s = SAMPLES[variant] || SAMPLES[0];
    let y = 36;
    ctx.font = 'bold 26px "Hiragino Sans", "Noto Sans JP", sans-serif';
    ctx.fillText(s.title, W / 2, y);
    y += 28;
    ctx.font = '14px sans-serif';
    ctx.fillText(s.sub, W / 2, y);
    y += 22;
    ctx.fillText('TEL 03-0000-0000', W / 2, y);
    y += 18;
    ctx.strokeStyle = '#999';
    ctx.beginPath();
    ctx.moveTo(30, y);
    ctx.lineTo(W - 30, y);
    ctx.stroke();
    y += 28;
    ctx.font = '13px monospace';
    ctx.fillText(s.dateLabel, W / 2, y);
    y += 30;

    ctx.textAlign = 'left';
    ctx.font = variant === 2 ? 'italic 15px "Segoe Print", "Comic Sans MS", sans-serif' : '15px sans-serif';
    s.lines.forEach(([name, price]) => {
      ctx.fillText(name, 40, y);
      ctx.textAlign = 'right';
      ctx.fillText(price, W - 40, y);
      ctx.textAlign = 'left';
      y += 28;
    });

    y += 10;
    ctx.beginPath();
    ctx.moveTo(30, y);
    ctx.lineTo(W - 30, y);
    ctx.stroke();
    y += 28;
    const rows = [
      ['小計', `¥${s.total - s.tax8 - s.tax10}`],
      s.tax8 ? ['消費税(8%)', `¥${s.tax8}`] : null,
      s.tax10 ? ['消費税(10%)', `¥${s.tax10}`] : null,
      ['合計', `¥${s.total}`],
    ].filter(Boolean);
    rows.forEach(([k, v], i) => {
      ctx.font = i === rows.length - 1 ? 'bold 18px sans-serif' : '14px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(k, 40, y);
      ctx.textAlign = 'right';
      ctx.fillText(v, W - 40, y);
      y += 26;
    });

    y += 16;
    ctx.textAlign = 'center';
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#555';
    ctx.fillText(s.note, W / 2, y);
    ctx.fillText('デモ用合成小票', W / 2, y + 20);

    // 底部二维码（本地生成，jsQR 可解）
    try {
      if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
        const qrCanvas = document.createElement('canvas');
        await QRCode.toCanvas(qrCanvas, qrPayloadForSample(variant), {
          width: 120,
          margin: 1,
          errorCorrectionLevel: 'M',
        });
        const qx = (W - 120) / 2;
        const qy = H - 150;
        ctx.fillStyle = '#fff';
        ctx.fillRect(qx - 6, qy - 6, 132, 132);
        ctx.drawImage(qrCanvas, qx, qy, 120, 120);
        ctx.fillStyle = '#555';
        ctx.font = '11px sans-serif';
        ctx.fillText('電子レシート QR（本地可解）', W / 2, qy + 140);
      }
    } catch (_) {
      /* ignore */
    }

    return c.toDataURL('image/png');
  }

  async function loadSampleAndRecognize(idx) {
    const dataUrl = await drawReceipt(idx);
    setPreview(dataUrl, 'image/png', idx);
    els.sampleMenu.classList.add('hidden');
    await recognize();
  }

  async function openCamera() {
    try {
      stopCamera();
      state.sampleIndex = null;
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      els.video.srcObject = state.stream;
      els.video.classList.remove('hidden');
      els.imagePreview.classList.add('hidden');
      els.previewPlaceholder.classList.add('hidden');
      els.btnSnap.classList.remove('hidden');
      els.btnRecognize.disabled = true;
    } catch (err) {
      toast('无法打开摄像头：' + (err.message || '权限被拒绝'), true);
    }
  }

  function snapPhoto() {
    const v = els.video;
    if (!v.videoWidth) return toast('摄像头尚未就绪', true);
    const c = els.canvas;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    setPreview(c.toDataURL('image/jpeg', 0.92), 'image/jpeg', null);
  }

  els.btnCamera.addEventListener('click', openCamera);
  els.btnSnap.addEventListener('click', snapPhoto);
  els.btnReset.addEventListener('click', clearAll);
  els.btnRecognize.addEventListener('click', recognize);
  els.btnRefreshHistory.addEventListener('click', loadHistory);

  if (els.btnQuickDemo) {
    els.btnQuickDemo.addEventListener('click', () => loadSampleAndRecognize(0));
  }

  els.healthBadge.addEventListener('click', () => {
    if (!state.useBackend) els.keyPanel.classList.toggle('hidden');
  });
  if (els.btnKey) {
    els.btnKey.addEventListener('click', () => els.keyPanel.classList.toggle('hidden'));
  }
  if (els.btnSaveKey) {
    els.btnSaveKey.addEventListener('click', () => {
      setApiKey(els.keyInput.value);
      els.keyPanel.classList.add('hidden');
      toast(getApiKey() ? '已保存：上传真实小票将走 Gemini' : '已回到纯演示模式');
    });
  }
  if (els.btnClearKey) {
    els.btnClearKey.addEventListener('click', () => {
      els.keyInput.value = '';
      setApiKey('');
      toast('已清除 Key，继续用演示模式');
    });
  }

  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result, file.type || 'image/jpeg', null);
    reader.readAsDataURL(file);
  });

  els.btnSamples.addEventListener('click', () => {
    els.sampleMenu.classList.toggle('hidden');
  });

  document.querySelectorAll('.sample-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-sample') || 0);
      loadSampleAndRecognize(idx);
    });
  });

  els.btnEdit.addEventListener('click', () => {
    if (!state.current) return;
    state.editing = true;
    els.jsonViewWrap.classList.add('hidden');
    els.jsonEdit.classList.remove('hidden');
    els.jsonEdit.value = JSON.stringify(state.current.result, null, 2);
    els.btnEdit.classList.add('hidden');
    els.btnSave.classList.remove('hidden');
    els.btnCancelEdit.classList.remove('hidden');
    els.btnSave.disabled = false;
    els.btnCancelEdit.disabled = false;
  });

  els.btnCancelEdit.addEventListener('click', () => {
    if (state.current) renderResult(state.current);
  });

  els.btnSave.addEventListener('click', async () => {
    if (!state.current) return;
    let parsed;
    try {
      parsed = JSON.parse(els.jsonEdit.value);
    } catch {
      return toast('JSON 格式不正确', true);
    }

    if (state.useBackend) {
      try {
        const res = await fetch(`/api/history/${state.current.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ result: parsed }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '保存失败');
        renderResult(data);
        await loadHistory();
        toast('已保存');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    const list = loadLocalHistory();
    const idx = list.findIndex((x) => x.id === state.current.id);
    const updated = {
      ...state.current,
      result: parsed,
      edited: true,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) list[idx] = updated;
    else list.unshift(updated);
    saveLocalHistory(list);
    renderResult(updated);
    renderHistory(list);
    toast('已保存到本机浏览器');
  });

  bootstrapApiKey();
  detectBackend().then(loadHistory);
})();
