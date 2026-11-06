/**
 * 小票 AI 识别 Demo — Express + Gemini 2.5 Flash
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { GoogleGenAI } = require('@google/genai');

const PORT = Number(process.env.PORT) || 3789;
const RESULTS_FILE = path.join(__dirname, 'results.json');
const MODEL = 'gemini-2.5-flash';

/** Gemini 2.5 Flash Paid Tier 估算（USD / 1M tokens） */
const PRICE = {
  inputPerM: 0.3,
  outputPerM: 2.5,
};

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

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

function loadResults() {
  try {
    if (!fs.existsSync(RESULTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveResults(list) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(list, null, 2), 'utf8');
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
  const cost =
    (prompt / 1e6) * PRICE.inputPerM + (output / 1e6) * PRICE.outputPerM;
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

function getAiClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'your_gemini_api_key_here') {
    const err = new Error('未配置 GEMINI_API_KEY，请复制 .env.example 为 .env 并填入密钥');
    err.status = 500;
    throw err;
  }
  return new GoogleGenAI({ apiKey: key });
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    hasKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here'),
  });
});

app.get('/api/history', (_req, res) => {
  res.json(loadResults());
});

app.post('/api/recognize', async (req, res) => {
  const started = Date.now();
  try {
    const { imageBase64, mimeType = 'image/jpeg', thumbnailBase64 } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: '缺少 imageBase64' });
    }

    const base64Data = String(imageBase64).replace(/^data:[^;]+;base64,/, '');
    const ai = getAiClient();

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        { text: RECEIPT_PROMPT },
        {
          inlineData: {
            mimeType: mimeType.includes('/') ? mimeType : 'image/jpeg',
            data: base64Data,
          },
        },
      ],
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const rawModelText = response.text || '';
    const parsed = parseReceiptJson(rawModelText);
    const elapsedMs = Date.now() - started;
    const cost = estimateCostUsd(response.usageMetadata);

    const confidence = parsed.confidence || {};
    const totalConf = Number(confidence.total ?? 0);
    const needsReview = !(totalConf >= 0.7);
    const verticalHint = detectVerticalHint(parsed.raw_text || rawModelText);

    const preview =
      thumbnailBase64 ||
      `data:${mimeType};base64,${base64Data}`;

    const record = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      model: MODEL,
      elapsedMs,
      ...cost,
      needsReview,
      verticalHint,
      imagePreview: preview,
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
      },
      rawModelText,
      edited: false,
    };

    const list = loadResults();
    list.unshift(record);
    // 控制文件体积：图片只保留最近 20 条完整预览
    list.slice(20).forEach((r) => {
      if (r.imagePreview && r.imagePreview.length > 5000) {
        r.imagePreview = null;
      }
    });
    saveResults(list);

    res.json(record);
  } catch (err) {
    console.error('[recognize]', err);
    res.status(err.status || 500).json({
      error: err.message || '识别失败',
      elapsedMs: Date.now() - started,
    });
  }
});

app.put('/api/history/:id', (req, res) => {
  try {
    const list = loadResults();
    const idx = list.findIndex((r) => r.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: '记录不存在' });

    const body = req.body || {};
    if (body.result) {
      list[idx].result = { ...list[idx].result, ...body.result };
      list[idx].edited = true;
      list[idx].updatedAt = new Date().toISOString();
    }
    saveResults(list);
    res.json(list[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/history/:id', (req, res) => {
  const list = loadResults().filter((r) => r.id !== req.params.id);
  saveResults(list);
  res.json({ ok: true });
});

if (!fs.existsSync(RESULTS_FILE)) {
  saveResults([]);
}

app.listen(PORT, () => {
  console.log(`\n  小票 AI Demo 已启动`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  模型: ${MODEL}`);
  console.log(
    `  API Key: ${
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here'
        ? '已配置'
        : '未配置（请编辑 .env）'
    }\n`
  );
});
