# 小票 AI 识别可行性验证 Demo

用 **Google Gemini 2.5 Flash** 识别日本/中文小票，输出结构化 JSON，便于评估后续民宿采购进销存的技术选型。

支持两种运行方式：

1. **GitHub Pages（手机测）**：纯静态页，浏览器直连 Gemini（Key 存在本机 localStorage）
2. **本地 Node 服务**：Express 代理调用（Key 写在 `.env`）

## 手机 / GitHub Pages

部署后打开 Pages 地址 → 右上角 **配置 Key** → 填入 [Gemini API Key](https://aistudio.google.com/apikey) → 测试样本或拍照识别。

> Key 只存在你的手机/电脑浏览器里，不会进 Git 仓库。演示结束后可点「清除」。

## 功能

- 拍照（摄像头）/ 上传图片 / 3 张内置测试样本
- 三栏结果：原图 · Raw Text · 结构化 JSON
- 人工修正并保存到本地 `results.json`
- 历史记录：缩略图、店铺、总额、置信度、耗时、费用估算
- Loading 动画、Prism.js JSON 高亮、低置信度 / 竖排提示

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

```bash
# Windows PowerShell
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

编辑 `.env`，填入 Google AI Studio 密钥：

```
GEMINI_API_KEY=你的密钥
```

申请地址：https://aistudio.google.com/apikey

### 3. 启动

```bash
npm start
```

浏览器打开：http://localhost:3789

（若端口冲突，可在 `.env` 里改 `PORT`）

### 演示建议

1. 点 **测试样本** → 选「コンビニ」→ **开始识别**
2. 查看右栏 JSON、耗时与费用
3. 点 **人工修正** 改字段后保存
4. 底部历史可展开回看

## 目录结构

```
urCodeDemo/
├── index.html      # 前端页面（Tailwind CDN）
├── app.js          # 前端逻辑（拍照/上传/样本/历史）
├── server.js       # Express + Gemini API
├── package.json
├── .env.example
├── .env            # 本地密钥（勿提交）
└── results.json    # 识别历史（自动生成）
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 / Key 是否配置 |
| POST | `/api/recognize` | `{ imageBase64, mimeType, thumbnailBase64 }` |
| GET | `/api/history` | 历史列表 |
| PUT | `/api/history/:id` | 保存人工修正 |
| DELETE | `/api/history/:id` | 删除一条 |

## 第三方库

| 库 | 用途 |
|----|------|
| `express` | HTTP 服务 |
| `cors` | 跨域 |
| `dotenv` | 环境变量 |
| `@google/genai` | Gemini SDK |
| Tailwind CSS (CDN) | 样式 |
| Prism.js (CDN) | JSON 高亮 |

## 费用说明（估算）

按 Gemini 2.5 Flash **Paid Tier** 公开价（约）：

- 输入：约 **$0.30 / 1M tokens**（含图片）
- 输出：约 **$2.50 / 1M tokens**（含 thinking）

单张小票常见量级：**约 $0.001～$0.01**（视图片分辨率与返回长度而定）。页面展示的是按本次 `usageMetadata` 估算的美元费用，**Free Tier 实际可能为 $0**。

OpenAI GPT-4o 兜底在本版 **未启用**（竖排时仅提示），需要时可再加。

## 不做的范围

用户系统、数据库、云部署、权限、批量上传 — 均不在本 Demo 内。

## 故障排查

- **未配置 API Key**：复制 `.env.example` → `.env` 并填入密钥后重启
- **识别失败 / 429**：检查配额、账单或稍后重试
- **摄像头打不开**：用 HTTPS 或 `localhost`；或改用上传 / 测试样本
