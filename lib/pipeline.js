/**
 * lib/pipeline.js
 *
 * Dual-Agent Pipeline
 *
 *   Agent 1 (T2I)   — receives user prompt, simulates/generates an image,
 *                      returns { filename } of file in gen-images/
 *   Agent 2 (Asset) — lists game image assets, LLM picks the best match,
 *                      swaps the T2I output with the chosen game asset
 */

'use strict';

const { runT2IAgent }    = require('./agent-t2i');
const { runAssetAgent }  = require('./agent-asset');

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

  // ── Stage 1: Text-to-Image ───────────────────────────────────────────────
  emit('t2i', '🎨 生图中...');

  const t2iResult = await runT2IAgent(userPrompt, {
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
