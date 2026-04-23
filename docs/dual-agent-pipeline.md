# 双 Agent Pipeline 架构

## 概述

用户输入一句自然语言（如"把新闻图片换成猫咪"），服务器端串联三个阶段自动完成游戏图片替换，无需用户指定资源路径。

```text
用户 prompt
   │
   ▼
[Stage 0]   意图分类（LLM，~1s）
   │ NO → 立即返回引导语，中断
   │ YES ↓
[Stage 0.5] 提示词优化（LLM，~1s）
   │ → 将中文自然语言改写为高质量英文 T2I 提示词
   │ 失败时 fail-open，继续使用原始 prompt
   ↓
[Stage 1]   T2I Agent（Replicate flux-schnell / Mock 降级）
   │ → 产出：gen-images/generated-<timestamp>.jpg
   │
   ▼
[Stage 2]   Asset Agent（DeepSeek Function Calling）
   ├─ list_all_image_assets() → 枚举游戏内所有图片
   ├─ LLM 根据原始用户 prompt 选目标资源
   └─ swap_image(src, dest)   → 覆写 native/ 文件
   │
   ▼
前端收到 swappedPath → 刷新 iframe（带时间戳）
```

---

## 文件结构

| 文件 | 职责 |
| ------ | ------ |
| `lib/pipeline.js` | 串联三个阶段，导出 `runPipeline(prompt, apiKey)` |
| `lib/agent-t2i.js` | Stage 1：T2I Agent（接收**优化后英文提示词**，REAL / MOCK 双模式） |
| `lib/agent-asset.js` | Stage 2：Asset Agent，含 `listAllImageAssets` 和 `swapImage` 工具 |
| `server.js` | `POST /api/pipeline` 端点，读取 `DEEPSEEK_API_KEY` 环境变量 |
| `gen-images/` | T2I 输出与 Asset Agent 输入的交接目录（已加入 .gitignore） |

---

## Stage 0 — 意图分类

**目的**：过滤无关输入，避免白白消耗 T2I 延迟和 Asset Agent API 调用。

**实现**：向 DeepSeek 发一条极短请求（无 tools，`max_tokens: 60`），prompt 要求只回复 `YES` 或 `NO|引导语`。

**容错**：若 LLM 调用失败（网络错误/解析错误），**放行**，不阻断正常流程。

---

## Stage 0.5 — 提示词优化

**目的**：用户输入通常是简短中文，直接传给 Replicate 生成质量较低。此阶段调用 DeepSeek 将意图改写为 40–80 词的专业英文 T2I 提示词，提升生图质量。

**实现**：向 DeepSeek 发一条 `max_tokens: 150` 的请求，System prompt 要求只输出提示词本身（无引号、无解释），风格包含 `photorealistic, high detail, vivid colors, sharp focus` 等修饰词。

**容错**：调用失败（网络错误/解析错误/返回空）时 **fail-open**，继续使用原始用户 prompt，打印警告日志。

> **注意**：Stage 2（Asset Agent）传入的仍是原始用户中文 prompt，以确保资源匹配基于用户真实意图，不受翻译影响。

---

## Stage 1 — T2I Agent

`lib/agent-t2i.js` 根据 `REPLICATE_API_TOKEN` 环境变量**自动切换**两种模式：

| 模式 | 触发条件 | 行为 |
| ------ | ------ | ------ |
| **REAL** | `.env` 中 `REPLICATE_API_TOKEN` 已填写 | 调用 Replicate `flux-schnell`，下载图片保存为 `gen-images/generated-<timestamp>.jpg` |
| **MOCK** | `REPLICATE_API_TOKEN` 为空 | 模拟 2s 延迟，返回 `gen-images/` 中第一个已有文件，打印警告 |

**Replicate 调用参数**
```js
model: 'black-forest-labs/flux-schnell'
input: { go_fast: true, num_outputs: 1, aspect_ratio: '1:1', output_format: 'jpg', output_quality: 85, num_inference_steps: 4 }
// 接收的 prompt 为 Stage 0.5 优化后的英文提示词
```

图片下载后通过 `https.get` 直接流式写入 `gen-images/`，文件名格式 `generated-<timestamp>.jpg`。

---

## Stage 2 — Asset Agent

### 工具定义

| 工具 | 行为 |
| ------ | ------ |
| `list_all_image_assets()` | 遍历 `web-mobile/assets/*/native/`，返回 `[{ name, file }]` |
| `swap_image(src_filename, dest_path)` | 将 `gen-images/<src>` 复制到 `dest_path`，有路径安全校验 |

### LLM 决策流程

1. 系统 prompt 告知 LLM：已生成文件为 `<filename>`，任务是找到正确目标资源并替换
2. LLM 必须先调用 `list_all_image_assets()` 获取资源列表
3. 根据用户意图从列表中选出目标，调用 `swap_image()`
4. 返回确认文案，Agent 循环结束

### 路径安全

`swap_image` 校验 `dest_path` 必须在 `web-mobile/assets/` 内，防止路径穿越。

---

## API 接口

### `POST /api/pipeline`

**Request**

```json
{ "instruction": "把新闻图片换成猫咪" }
```

**Response（成功）**

```json
{
  "stages": [
    { "stage": "classify", "message": "🤔 理解意图..." },
    { "stage": "refine",   "message": "✏️ 优化生图提示词..." },
    { "stage": "t2i",      "message": "🎨 生图中..." },
    { "stage": "asset",    "message": "🔍 定位游戏资源..." },
    { "stage": "done",     "message": "✅ 替换完成：web-mobile/assets/..." }
  ],
  "reply": "已将 fake-news 图片替换为生成图片。",
  "swappedPath": "web-mobile/assets/main/native/b2/b2c044af-....jpg",
  "earlyExit": false
}
```

**Response（意图不符）**

```json
{
  "stages": [
    { "stage": "classify", "message": "🤔 理解意图..." },
    { "stage": "abort",    "message": "请告诉我你想把游戏中的哪张图片换成什么内容..." }
  ],
  "reply": "请告诉我你想把游戏中的哪张图片换成什么内容...",
  "swappedPath": null,
  "earlyExit": true
}
```

---

## 环境变量

| 变量 | 用途 |
| ------ | ------ |
| `DEEPSEEK_API_KEY` | 意图分类（Stage 0）和 Asset Agent（Stage 2）共用，在 `.env` 中配置 |
| `REPLICATE_API_TOKEN` | T2I Agent（Stage 1）真实生图，留空则自动降级为 Mock 模式 |
