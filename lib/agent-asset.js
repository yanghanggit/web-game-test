/**
 * lib/agent-asset.js
 *
 * Asset Agent
 *
 * Responsibilities:
 *   1. List all image assets in the Cocos game build (resource discovery)
 *   2. Use DeepSeek LLM to decide which asset best matches the user's intent
 *   3. Swap the chosen asset with the file produced by the T2I agent
 *
 * Tool: list_all_image_assets()
 *   Walks all pack files and extracts { name, file } for every native image,
 *   giving the LLM a full "asset catalogue" to reason over.
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { findAssets } = require('./cocos-asset-finder');

const ASSETS_ROOT  = path.join(__dirname, '..', 'web-mobile', 'assets');
const GEN_IMAGES   = path.join(__dirname, '..', 'gen-images');
const PROJECT_ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Tool: list_all_image_assets
// Collects every native image file and pairs it with the resource name from
// the pack file. Strategy: search pack files for common image-related keywords
// to get names, then list all native image files as a fallback.
// ---------------------------------------------------------------------------

function listAllImageAssets() {
  // Common node/resource name keywords to discover named sprites
  const DISCOVERY_KEYWORDS = ['SpriteFrame', 'cc.Sprite'];
  const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

  const seen = new Map(); // file path → best name

  // Collect all native image files first (full scan)
  function walkNative(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkNative(full);
      } else if (IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        if (!seen.has(full)) seen.set(full, path.basename(full));
      }
    }
  }
  walkNative(path.join(ASSETS_ROOT, 'main', 'native'));
  walkNative(path.join(ASSETS_ROOT, 'internal', 'native'));

  // Try to enrich with resource names via findAssets
  for (const kw of DISCOVERY_KEYWORDS) {
    const results = findAssets(ASSETS_ROOT, kw);
    for (const r of results) {
      if (r.file && fs.existsSync(r.file)) {
        // Only overwrite the name if it's not yet named meaningfully
        if (seen.get(r.file) === path.basename(r.file)) {
          seen.set(r.file, r.fullUUID || path.basename(r.file));
        }
      }
    }
  }

  // Also search for any explicitly named nodes by scanning pack context strings
  // Strategy: find pack hits for Sprite and extract the "name" field nearby
  const namedResults = findAssets(ASSETS_ROOT, '"name"');
  for (const r of namedResults) {
    if (r.file && r.context) {
      const nameMatch = r.context.match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch) {
        seen.set(r.file, nameMatch[1]);
      }
    }
  }

  return Array.from(seen.entries()).map(([file, name]) => ({
    name,
    file: path.relative(PROJECT_ROOT, file),
  }));
}

// ---------------------------------------------------------------------------
// Tool: swap_image
// ---------------------------------------------------------------------------

function swapImage(srcFilename, destPath) {
  const src  = path.join(GEN_IMAGES, srcFilename);
  const dest = path.join(PROJECT_ROOT, destPath);

  const assetsDir = path.join(PROJECT_ROOT, 'web-mobile', 'assets');
  if (!dest.startsWith(assetsDir)) {
    return { success: false, error: 'Destination must be inside web-mobile/assets/' };
  }
  if (!fs.existsSync(src)) {
    return { success: false, error: `Source not found: gen-images/${srcFilename}` };
  }
  if (!fs.existsSync(dest)) {
    return { success: false, error: `Destination not found: ${destPath}` };
  }

  fs.copyFileSync(src, dest);
  return { success: true, swapped: destPath };
}

// ---------------------------------------------------------------------------
// Tool definitions for DeepSeek Function Calling
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_all_image_assets',
      description:
        'List all image assets in the Cocos game build. Returns an array of { name, file } objects. ' +
        'Use this first to understand what images exist before deciding which one to replace.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'swap_image',
      description:
        'Replace a game asset image with the newly generated image. ' +
        'Call this after identifying the correct destination asset.',
      parameters: {
        type: 'object',
        properties: {
          src_filename: {
            type: 'string',
            description: 'Filename in gen-images/ to use as the replacement source.',
          },
          dest_path: {
            type: 'string',
            description: 'Relative path (from project root) of the game asset to replace.',
          },
        },
        required: ['src_filename', 'dest_path'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// DeepSeek API call
// ---------------------------------------------------------------------------

function callDeepSeek(messages, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
    });

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
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Execute tool by name
// ---------------------------------------------------------------------------

function executeTool(name, args) {
  switch (name) {
    case 'list_all_image_assets':
      return listAllImageAssets();
    case 'swap_image':
      return swapImage(args.src_filename, args.dest_path);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Asset Agent main loop
// ---------------------------------------------------------------------------

/**
 * @param {string} userIntent    - Original user prompt (e.g. "把游戏里的图片换成猫咪")
 * @param {string} genFilename   - Filename in gen-images/ produced by T2I agent
 * @param {string} apiKey        - DeepSeek API key
 * @param {object} opts
 * @param {Function} opts.onProgress  - Callback(message) for status updates
 * @returns {Promise<{ reply: string, swapped: string|null }>}
 */
async function runAssetAgent(userIntent, genFilename, apiKey, { onProgress = null, maxSteps = 6 } = {}) {
  if (onProgress) onProgress('[Asset] 分析游戏资源...');

  const messages = [
    {
      role: 'system',
      content:
        'You are a game asset replacement assistant. ' +
        'A new image has been generated and saved as "' + genFilename + '" in the gen-images/ directory. ' +
        'Your job is to:\n' +
        '  1. Call list_all_image_assets() to discover what image assets exist in the game.\n' +
        '  2. Based on the user\'s intent, decide which asset to replace.\n' +
        '  3. Call swap_image() with the correct src_filename and dest_path.\n' +
        '  4. Confirm what was replaced.\n' +
        'Always call list_all_image_assets first before making any swap decision.',
    },
    {
      role: 'user',
      content: userIntent,
    },
  ];

  let swappedPath = null;

  for (let i = 0; i < maxSteps; i++) {
    const response = await callDeepSeek(messages, apiKey);

    if (response.error) {
      throw new Error(`DeepSeek error: ${JSON.stringify(response.error)}`);
    }

    const choice  = response.choices?.[0];
    const message = choice?.message;
    if (!message) throw new Error(`Unexpected API response: ${JSON.stringify(response)}`);

    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { reply: message.content || '', swappedPath };
    }

    for (const toolCall of message.tool_calls) {
      const name   = toolCall.function.name;
      const args   = JSON.parse(toolCall.function.arguments || '{}');
      const result = executeTool(name, args);

      if (onProgress) onProgress(`[Asset] 工具调用: ${name} → ${JSON.stringify(result).slice(0, 80)}`);

      if (name === 'swap_image' && result.success) {
        swappedPath = result.swapped;
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  return { reply: '(max steps reached)', swappedPath };
}

module.exports = { runAssetAgent, listAllImageAssets };
