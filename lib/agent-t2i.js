/**
 * lib/agent-t2i.js
 *
 * Text-to-Image Agent (T2I)
 *
 * Current phase: MOCK
 *   - Simulates generation delay
 *   - Returns the first image already present in gen-images/ as if it were
 *     freshly generated
 *
 * Future phase: REAL
 *   - Call an actual T2I API (e.g. Stability AI, DALL-E, etc.)
 *   - Save the generated image to gen-images/<uuid>.jpg
 *   - Return the saved filename
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const GEN_IMAGES = path.join(__dirname, '..', 'gen-images');

// Simulated generation time in milliseconds
const MOCK_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run the T2I agent.
 *
 * @param {string} prompt        - User's natural language description of the desired image
 * @param {Function} onProgress  - Optional callback(message) for streaming status updates
 * @returns {Promise<{ filename: string, mock: true }>}
 */
async function runT2IAgent(prompt, { onProgress = null } = {}) {
  console.log(`[T2I] 收到提示词: "${prompt}"`);
  if (onProgress) onProgress(`[T2I] 收到提示词: "${prompt}"`);
  if (onProgress) onProgress('[T2I] 图片生成中...');

  // --- MOCK: simulate generation delay ---
  console.log(`[T2I] 开始模拟生图延迟 ${MOCK_DELAY_MS}ms...`);
  await sleep(MOCK_DELAY_MS);

  // Pick the first available image in gen-images/ as the "generated" result
  const allFiles = fs.readdirSync(GEN_IMAGES);
  const files = allFiles.filter(f =>
    !f.startsWith('.') && /\.(jpg|jpeg|png|webp)$/i.test(f)
  );
  console.log(`[T2I] gen-images/ 扫描结果: ${JSON.stringify(allFiles)} → 候选图片: ${JSON.stringify(files)}`);

  if (files.length === 0) {
    console.error('[T2I] gen-images/ 目录为空！');
    throw new Error('gen-images/ 目录为空，无法模拟生成图片。请先放入一张图片。');
  }

  const filename = files[0];
  console.log(`[T2I] 使用文件: ${filename}`);
  if (onProgress) onProgress(`[T2I] 图片生成完成: ${filename}`);

  return { filename, mock: true };
}

module.exports = { runT2IAgent };
