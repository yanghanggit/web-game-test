/**
 * lib/agent-t2i.js
 *
 * Text-to-Image Agent (T2I)
 *
 * Two modes (selected automatically at runtime):
 *
 *   REAL  — REPLICATE_API_TOKEN is set in .env
 *           Calls Replicate flux-schnell, downloads the result, saves to
 *           gen-images/generated-<timestamp>.jpg
 *
 *   MOCK  — No REPLICATE_API_TOKEN
 *           Simulates a 2 s generation delay, then returns the first image
 *           already present in gen-images/ (useful for development / testing
 *           without consuming API credits).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');

const GEN_IMAGES = path.join(__dirname, '..', 'gen-images');

// Simulated generation time in milliseconds (Mock mode only)
const MOCK_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// REAL mode — Replicate flux-schnell
// ---------------------------------------------------------------------------

async function generateWithReplicate(prompt, { onProgress = null } = {}) {
  // Lazy-require so the module is only loaded when actually needed
  const Replicate = require('replicate');
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  if (onProgress) onProgress('[T2I] 正在调用 Replicate flux-schnell...');
  console.log('[T2I] Replicate 生图开始...');

  const output = await replicate.run('black-forest-labs/flux-schnell', {
    input: {
      prompt,
      go_fast: true,
      num_outputs: 1,
      aspect_ratio: '1:1',
      output_format: 'jpg',
      output_quality: 85,
      num_inference_steps: 4,
    },
  });

  // output is an array of ReadableStream objects
  console.log(`[T2I] Replicate 原始输出类型: ${typeof output}, 长度: ${Array.isArray(output) ? output.length : 'N/A'}`);
  console.log(`[T2I] output[0] 类型: ${typeof output?.[0]}, 值: ${String(output?.[0]).slice(0, 120)}`);
  const imageStream = output[0];
  if (!imageStream) throw new Error('[T2I] Replicate 未返回图片');

  const filename = `generated-${Date.now()}.jpg`;
  const destPath = path.join(GEN_IMAGES, filename);

  console.log(`[T2I] 下载图片 → ${destPath}`);
  if (onProgress) onProgress(`[T2I] 下载图片到 gen-images/${filename}...`);

  // The Replicate JS client returns a Response-like object; pipe it to disk
  await new Promise((resolve, reject) => {
    const url = typeof imageStream.url === 'function' ? imageStream.url() : String(imageStream);
    console.log(`[T2I] 图片 URL: ${url}`);
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      console.log(`[T2I] HTTP 响应状态: ${res.statusCode}, Content-Type: ${res.headers['content-type']}`);
      res.pipe(file);
      file.on('finish', () => {
        const sizeKB = (fs.statSync(destPath).size / 1024).toFixed(1);
        console.log(`[T2I] 文件写入完成，大小: ${sizeKB} KB`);
        file.close(resolve);
      });
      file.on('error', reject);
    }).on('error', reject);
  });

  console.log(`[T2I] ✅ 图片已保存: ${filename}`);
  if (onProgress) onProgress(`[T2I] 图片生成完成: ${filename}`);

  return { filename, mock: false };
}

// ---------------------------------------------------------------------------
// MOCK mode — returns existing file in gen-images/
// ---------------------------------------------------------------------------

async function generateMock(prompt, { onProgress = null } = {}) {
  console.warn('[T2I] ⚠️  REPLICATE_API_TOKEN 未设置，使用 Mock 模式。');
  console.log(`[T2I] 开始模拟生图延迟 ${MOCK_DELAY_MS}ms...`);
  if (onProgress) onProgress('[T2I] 图片生成中（Mock 模式）...');

  await sleep(MOCK_DELAY_MS);

  const allFiles = fs.readdirSync(GEN_IMAGES);
  const files = allFiles.filter(f =>
    !f.startsWith('.') && /\.(jpg|jpeg|png|webp)$/i.test(f)
  );
  console.log(`[T2I] gen-images/ 扫描结果: ${JSON.stringify(allFiles)} → 候选图片: ${JSON.stringify(files)}`);

  if (files.length === 0) {
    console.error('[T2I] gen-images/ 目录为空！');
    throw new Error(
      'Mock 模式下 gen-images/ 目录为空。' +
      '请放入一张测试图片，或在 .env 中配置 REPLICATE_API_TOKEN 启用真实生图。'
    );
  }

  const filename = files[0];
  console.log(`[T2I] 使用文件: ${filename}`);
  if (onProgress) onProgress(`[T2I] 图片生成完成: ${filename}`);

  return { filename, mock: true };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the T2I agent.
 *
 * @param {string} prompt        - User's natural language description of the desired image
 * @param {object} opts
 * @param {Function} opts.onProgress  - Optional status callback(message)
 * @returns {Promise<{ filename: string, mock: boolean }>}
 */
async function runT2IAgent(prompt, { onProgress = null } = {}) {
  console.log(`[T2I] 收到提示词: "${prompt}"`);
  if (onProgress) onProgress(`[T2I] 收到提示词: "${prompt}"`);

  if (process.env.REPLICATE_API_TOKEN) {
    return generateWithReplicate(prompt, { onProgress });
  } else {
    return generateMock(prompt, { onProgress });
  }
}

module.exports = { runT2IAgent };

