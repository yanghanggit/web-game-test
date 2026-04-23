/**
 * lib/agent.js
 *
 * ReAct-style Agent powered by DeepSeek (OpenAI-compatible API).
 * The agent receives a natural language instruction, decides which tools
 * to call, and iterates until the task is done.
 *
 * Tools:
 *   - find_asset(keyword)        → locate native file by keyword
 *   - swap_image(src, dest)      → overwrite dest with src
 *   - list_gen_images()          → list files in gen-images/
 *   - generate_image(prompt)     → (stub) future text-to-image hook
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');
const { findAssets } = require('./cocos-asset-finder');

const ASSETS_ROOT = path.join(__dirname, '..', 'web-mobile', 'assets');
const GEN_IMAGES  = path.join(__dirname, '..', 'gen-images');
const PROJECT_ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI function-calling format)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'find_asset',
      description: 'Search the Cocos game build for a native asset file (image, etc.) by keyword. Returns a list of matching file paths.',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: 'The search keyword, e.g. a node name like "fake-news", or a partial UUID.',
          },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_gen_images',
      description: 'List all files currently in the gen-images/ staging directory.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'swap_image',
      description: 'Replace a game asset file with a new image from gen-images/. Provide the filename in gen-images/ and the destination path inside the game build.',
      parameters: {
        type: 'object',
        properties: {
          src_filename: {
            type: 'string',
            description: 'Filename (not full path) of the source image in gen-images/.',
          },
          dest_path: {
            type: 'string',
            description: 'Full file path of the destination asset inside the game build (web-mobile/assets/...).',
          },
        },
        required: ['src_filename', 'dest_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: '(Stub) Generate an image from a text prompt and save it to gen-images/. Currently not implemented.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text description of the image to generate.',
          },
          filename: {
            type: 'string',
            description: 'Filename to save as in gen-images/ (e.g. "output.jpg").',
          },
        },
        required: ['prompt', 'filename'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function toolFindAsset({ keyword }) {
  const results = findAssets(ASSETS_ROOT, keyword);
  if (results.length === 0) {
    return { found: false, message: `No asset found for keyword "${keyword}"` };
  }
  return {
    found: true,
    assets: results.map(r => ({
      bundle:   r.bundle,
      fullUUID: r.fullUUID,
      file:     path.relative(PROJECT_ROOT, r.file),
    })),
  };
}

function toolListGenImages() {
  const files = fs.readdirSync(GEN_IMAGES).filter(f => !f.startsWith('.'));
  return { files };
}

function toolSwapImage({ src_filename, dest_path }) {
  const src  = path.join(GEN_IMAGES, src_filename);
  const dest = path.join(PROJECT_ROOT, dest_path);

  // Security: ensure dest stays inside PROJECT_ROOT/web-mobile/assets
  const assetsDir = path.join(PROJECT_ROOT, 'web-mobile', 'assets');
  if (!dest.startsWith(assetsDir)) {
    return { success: false, error: 'Destination must be inside web-mobile/assets/' };
  }
  if (!fs.existsSync(src)) {
    return { success: false, error: `Source file not found: gen-images/${src_filename}` };
  }
  if (!fs.existsSync(dest)) {
    return { success: false, error: `Destination file not found: ${dest_path}` };
  }

  fs.copyFileSync(src, dest);
  return { success: true, swapped: dest_path };
}

function toolGenerateImage({ prompt, filename }) {
  // Stub — will be replaced by actual text-to-image API call in a future phase
  return {
    success: false,
    message: 'generate_image is not yet implemented. Please place an image manually in gen-images/ and use swap_image instead.',
  };
}

// ---------------------------------------------------------------------------
// Execute a single tool call
// ---------------------------------------------------------------------------

function executeTool(name, args) {
  switch (name) {
    case 'find_asset':     return toolFindAsset(args);
    case 'list_gen_images': return toolListGenImages();
    case 'swap_image':     return toolSwapImage(args);
    case 'generate_image': return toolGenerateImage(args);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// DeepSeek API call (OpenAI-compatible)
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
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main Agent loop (ReAct: Reason → Act → Observe → repeat)
// ---------------------------------------------------------------------------

/**
 * Run the agent with a natural language instruction.
 *
 * @param {string} instruction  - User's natural language command
 * @param {string} apiKey       - DeepSeek API key
 * @param {object} opts
 * @param {number} opts.maxSteps  - Max tool call iterations (default: 8)
 * @param {Function} opts.onStep  - Callback(step) for streaming progress
 * @returns {Promise<{reply: string, steps: Array}>}
 */
async function runAgent(instruction, apiKey, { maxSteps = 8, onStep = null } = {}) {
  const messages = [
    {
      role: 'system',
      content:
        'You are a game asset management assistant. ' +
        'You help the user locate and replace image assets in a Cocos Creator web game build. ' +
        'Use the provided tools to find assets, list available replacement images, and perform swaps. ' +
        'Always confirm what was done after completing the task.',
    },
    {
      role: 'user',
      content: instruction,
    },
  ];

  const steps = [];

  for (let i = 0; i < maxSteps; i++) {
    const response = await callDeepSeek(messages, apiKey);

    if (response.error) {
      throw new Error(`DeepSeek API error: ${JSON.stringify(response.error)}`);
    }

    const choice  = response.choices?.[0];
    const message = choice?.message;

    if (!message) {
      throw new Error(`Unexpected response shape: ${JSON.stringify(response)}`);
    }

    messages.push(message);

    // No tool calls → agent is done, return final reply
    if (!message.tool_calls || message.tool_calls.length === 0) {
      const reply = message.content || '';
      return { reply, steps };
    }

    // Execute each tool call
    for (const toolCall of message.tool_calls) {
      const name   = toolCall.function.name;
      const args   = JSON.parse(toolCall.function.arguments || '{}');
      const result = executeTool(name, args);

      const step = { tool: name, args, result };
      steps.push(step);
      if (onStep) onStep(step);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  return { reply: '(max steps reached without a final answer)', steps };
}

module.exports = { runAgent };
