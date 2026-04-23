# web-game-test

Cocos Creator 3.8.8 Web 游戏的局域网服务器壳。在游戏底部提供 AI 控制栏，用户输入一句自然语言（如"把图片换成戴草帽的小狗"），系统自动完成提示词优化 → 文生图 → 游戏资源替换，无需指定任何资源路径。

## 功能概览

- **局域网服务器**：一键启动，同 LAN 的手机/电脑直接访问
- **AI 换图 Pipeline**：4 阶段串联
  1. **意图分类** — 过滤无关输入，避免浪费 API 调用
  2. **提示词优化** — DeepSeek 将中文意图改写为高质量英文 T2I 提示词
  3. **文生图（T2I）** — Replicate `flux-schnell` 生成图片
  4. **资源替换** — DeepSeek Function Calling 自动找到游戏内目标图片并 swap

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key（见下方"外部依赖"）
cp .env.example .env   # 或直接新建 .env

# 3. 启动服务器
npm start
```

启动后终端会打印所有可访问地址：

```text
=== Cocos Game Server ===

  Local:   http://localhost:3000
  LAN:     http://192.168.x.x:3000
```

同一局域网内的手机或电脑直接访问 LAN 地址即可运行游戏。底部 AI 输入栏发送自然语言指令即可触发换图流程。

## 外部依赖（API Key）

在项目根目录创建 `.env` 文件，填入以下两个 Key：

```dotenv
# DeepSeek — 意图分类 + 提示词优化 + 资源匹配（必填）
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# Replicate — 文生图 flux-schnell（留空则自动降级为 Mock 模式）
REPLICATE_API_TOKEN=r8_xxxxxxxxxxxxxxxxxxxxxxxx
```

| Key | 获取地址 | 说明 |
| ------ | ------ | ------ |
| `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com) | Pipeline 三个 LLM 阶段共用 |
| `REPLICATE_API_TOKEN` | [replicate.com/account](https://replicate.com/account) | 不填则用 Mock 模式（返回 gen-images/ 现有文件） |

## 主要文件

| 路径 | 说明 |
| ------ | ------ |
| `server.js` | Express 服务器入口，含 `/api/pipeline` 端点 |
| `index.html` | 壳页面：iframe 嵌入游戏 + 底部 AI 控制栏 |
| `lib/pipeline.js` | 4 阶段 Pipeline 编排 |
| `lib/agent-t2i.js` | T2I Agent（Replicate / Mock 双路径） |
| `lib/agent-asset.js` | Asset Agent（资源枚举 + swap） |
| `web-mobile/` | Cocos Creator 编译产物（不需修改） |
| `gen-images/` | T2I 输出暂存目录（已加入 .gitignore） |

## 自定义端口

```bash
PORT=8080 npm start
```

## 知识库

设计细节、技术决策与项目背景信息（也是辅助 AI Agent 理解本项目的知识库）在 [`docs/`](docs/README.md)。
