/**
 * scripts/test-t2i.js
 *
 * 独立测试：Replicate flux-schnell 文生图
 *
 * 用法：
 *   node scripts/test-t2i.js "带草帽的小狗"
 *   node scripts/test-t2i.js   # 使用默认 prompt
 */

'use strict';

require('dotenv').config();
const { runT2IAgent } = require('../lib/agent-t2i');

const prompt = process.argv[2] || 'a cute dog wearing a straw hat';

console.log('=== T2I 独立测试 ===');
console.log(`Prompt: "${prompt}"`);
console.log(`REPLICATE_API_TOKEN: ${process.env.REPLICATE_API_TOKEN ? '已设置 ✅' : '未设置 ❌ (将使用 Mock 模式)'}`);
console.log('---');

runT2IAgent(prompt, {
  onProgress: (msg) => console.log('[progress]', msg),
})
  .then((result) => {
    console.log('---');
    console.log('✅ 成功:', result);
  })
  .catch((err) => {
    console.error('---');
    console.error('❌ 失败:', err.message);
    process.exit(1);
  });
