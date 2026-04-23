# iframe 游戏壳页面（index.html）

## 架构概述

根路径 `/` 返回 `index.html`（页面 A），游戏本体挂载在 `/game/` 子路径下，通过 `<iframe>` 嵌入。游戏文件（`web-mobile/`）**不做任何修改**。

```bash
GET /          → index.html      （壳页面，含底部 UI）
GET /game/*    → web-mobile/*    （Cocos 游戏静态资源）
```

## 布局结构

```text
┌─────────────────────────────┐
│  <iframe src="/game/...">   │  flex: 1，占满剩余高度
│                             │
└─────────────────────────────┘
│  底部栏（#bottom-bar）        │
│  [重新开始]  [自定义按钮]     │  #btn-row
│  [AI 输入框................] [AI 执行]  │  #agent-row
│  （状态反馈文字）             │  #agent-status
└─────────────────────────────┘
```

## 重新开始按钮实现

### 核心代码

```js
document.getElementById('btn-restart').addEventListener('click', () => {
  gameFrame.src = '/game/index.html?t=' + Date.now();
});
```

### 为什么加时间戳

| 写法 | 问题 |
| ------ | ------ |
| `gameFrame.src = gameFrame.src` | src 字符串未变，部分浏览器直接读内存缓存，不发网络请求 |
| `gameFrame.src = '/game/index.html?t=' + Date.now()` | 每次 URL 不同，浏览器必须重新发请求，能拿到服务器最新文件 |

时间戳方案对**开发迭代**尤为重要：修改 `web-mobile/` 内的资源后，客户端点击重新开始即可加载最新内容，无需手动刷新整个页面。

## AI Pipeline 输入栏

`#agent-row` 包含自然语言输入框与「AI 执行」按钮，点击后调用 `POST /api/pipeline`。

完整流程见 [dual-agent-pipeline.md](dual-agent-pipeline.md)，前端行为摘要：

| 服务端返回 | 前端动作 |
| ------ | ------ |
| `earlyExit: true` | 在 `#agent-status` 展示 LLM 引导语，不刷新游戏 |
| `swappedPath` 有值 | 展示替换路径，800ms 后刷新 iframe（带时间戳） |
| `error` | 展示红色错误信息 |

前端阶段动画通过 `setInterval` 驱动，约每 2.2s 切换一个阶段标签（`🤔 理解意图... → 🎨 生图中... → 🔍 定位游戏资源...`），不依赖服务端推送。

---

## 游戏与壳页面通信

两者同源（同一 server），可双向通信：

```js
// 壳页面 → 游戏
gameFrame.contentWindow.postMessage({ action: 'custom', data: {} }, '*');

// 游戏内部接收
window.addEventListener('message', (e) => {
  if (e.data.action === 'custom') { /* ... */ }
});
```

使用 `postMessage` 而非直接访问 `contentWindow` 的 JS 对象，可保持解耦，未来跨域部署也无需改动。
