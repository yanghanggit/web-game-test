/**
 * lib/pipeline.js
 *
 * Dual-Agent Pipeline
 *
 *   Stage 0   — 意图分类：判断是否为换图需求，非换图立即返回引导语
 *   Stage 0.5 — 提示词优化：用 LLM 将用户中文意图改写为高质量英文 T2I 提示词
 *   Stage 1   — T2I Agent：用优化后提示词生图，返回 gen-images/<filename>
 *   Stage 2   — Asset Agent：枚举游戏资源，LLM 选目标，swap 文件
 */

'use strict';

const https = require('https');
const { runT2IAgent }    = require('./agent-t2i');
const { runAssetAgent }  = require('./agent-asset');

// ---------------------------------------------------------------------------
// 意图分类：用单次轻量 LLM 调用判断用户是否有图片替换意图
// 返回 { isImageSwap: bool, guidance: string|null }
// ---------------------------------------------------------------------------
async function classifyIntent(userPrompt, apiKey) {
  console.log(`[Pipeline] 意图分类 — prompt: "${userPrompt}"`);

  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content:
          '你是一个意图分类器，只判断用户是否想替换游戏中的图片（换图、生图、改图等）。\n' +
          '如果是，只回复：YES\n' +
          '如果不是，回复：NO，然后用一句话中文引导用户（格式：NO|引导语）\n' +
          '例：NO|请告诉我你想把游戏中的哪张图片换成什么内容，例如"把新闻图片换成猫咪"',
      },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 60,
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = (parsed.choices?.[0]?.message?.content || '').trim();
          console.log(`[Pipeline] 意图分类结果: "${text}"`);
          if (text.startsWith('YES')) {
            resolve({ isImageSwap: true, guidance: null });
          } else {
            // 格式 NO|引导语，或降级处理
            const guidance = text.includes('|')
              ? text.split('|').slice(1).join('|').trim()
              : '请告诉我你想把游戏中的哪张图片换成什么内容，例如"把新闻图片换成猫咪"';
            resolve({ isImageSwap: false, guidance });
          }
        } catch (e) {
          // 解析失败时放行，不阻断流程
          console.error('[Pipeline] 意图分类解析失败，放行:', e.message);
          resolve({ isImageSwap: true, guidance: null });
        }
      });
    });
    req.on('error', (e) => {
      // 网络失败时放行
      console.error('[Pipeline] 意图分类网络错误，放行:', e.message);
      resolve({ isImageSwap: true, guidance: null });
    });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// 提示词优化：将用户中文意图改写为适合 flux-schnell 的英文 T2I 提示词
// 返回 { refinedPrompt: string }
// 失败时 fail-open：返回原始 userPrompt
// ---------------------------------------------------------------------------
async function refineT2IPrompt(userPrompt, apiKey) {
  console.log(`[Pipeline] 提示词优化 — 原始: "${userPrompt}"`);

  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content:
          '你是一位专业的 AI 图像生成提示词（prompt）工程师，擅长为 Flux / Stable Diffusion 系列模型优化提示词。\n' +
          '用户会给你一段中文描述，请将其改写为高质量的英文 T2I 提示词，要求：\n' +
          '1. 语言：英文\n' +
          '2. 风格：photorealistic, high detail, vivid colors, sharp focus\n' +
          '3. 结构：主体描述 + 场景/背景 + 光线/风格修饰词\n' +
          '4. 长度：40–80 个英文词，不超过 100 词\n' +
          '5. 只输出提示词本身，不要任何解释、引号或标签',
      },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 150,
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const refined = (parsed.choices?.[0]?.message?.content || '').trim();
          if (refined) {
            console.log(`[Pipeline] T2I 优化提示词: "${refined}"`);
            resolve({ refinedPrompt: refined });
          } else {
            console.warn('[Pipeline] 提示词优化返回空内容，使用原始 prompt');
            resolve({ refinedPrompt: userPrompt });
          }
        } catch (e) {
          console.error('[Pipeline] 提示词优化解析失败，使用原始 prompt:', e.message);
          resolve({ refinedPrompt: userPrompt });
        }
      });
    });
    req.on('error', (e) => {
      console.error('[Pipeline] 提示词优化网络错误，使用原始 prompt:', e.message);
      resolve({ refinedPrompt: userPrompt });
    });
    req.write(body);
    req.end();
  });
}

/**
 * Run the full pipeline.
 *
 * @param {string}   userPrompt   - Raw user intent text
 * @param {string}   apiKey       - DeepSeek API key
 * @param {Function} onProgress   - Optional streaming status callback(message)
 * @returns {Promise<{
 *   stages: Array<{ stage: string, message: string }>,
 *   reply: string,
 *   swappedPath: string|null,
 * }>}
 */
async function runPipeline(userPrompt, apiKey, { onProgress = null } = {}) {
  const stages = [];

  function emit(stage, message) {
    stages.push({ stage, message });
    if (onProgress) onProgress({ stage, message });
  }

  // ── Stage 0: 意图分类 ────────────────────────────────────────────────────
  emit('classify', '🤔 理解意图...');
  const { isImageSwap, guidance } = await classifyIntent(userPrompt, apiKey);

  if (!isImageSwap) {
    console.log(`[Pipeline] 非换图意图，打断并引导: "${guidance}"`);
    emit('abort', guidance);
    return { stages, reply: guidance, swappedPath: null, earlyExit: true };
  }

  // ── Stage 0.5: 提示词优化 ────────────────────────────────────────────────
  emit('refine', '✏️ 优化生图提示词...');
  const { refinedPrompt } = await refineT2IPrompt(userPrompt, apiKey);

  // ── Stage 1: Text-to-Image ───────────────────────────────────────────────
  emit('t2i', '🎨 生图中...');

  const t2iResult = await runT2IAgent(refinedPrompt, {
    onProgress: (msg) => emit('t2i', msg),
  });

  emit('t2i', `生图完成：${t2iResult.filename}`);

  // ── Stage 2: Asset Discovery + Swap ─────────────────────────────────────
  emit('asset', '🔍 定位游戏资源...');

  const assetResult = await runAssetAgent(userPrompt, t2iResult.filename, apiKey, {
    onProgress: (msg) => emit('asset', msg),
  });

  if (assetResult.swappedPath) {
    emit('done', `✅ 替换完成：${assetResult.swappedPath}`);
  } else {
    emit('done', '⚠️ 未执行替换（LLM 未找到合适资源或操作失败）');
  }

  return {
    stages,
    reply:       assetResult.reply,
    swappedPath: assetResult.swappedPath,
  };
}

module.exports = { runPipeline };
