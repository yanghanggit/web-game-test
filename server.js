require('dotenv').config();
const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { runAgent } = require('./lib/agent');

const app = express();
const PORT = process.env.PORT || 3000;

// Fix MIME types required by Cocos Creator web builds
express.static.mime.define({
  'application/wasm': ['wasm'],
  'application/octet-stream': ['bin'],
});

// Serve page-a.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Disable cache for game assets so replaced images are always fetched fresh
app.use('/game/assets', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Serve web-mobile/ under /game/ sub-path (game internal relative paths resolve correctly)
app.use('/game', express.static(path.join(__dirname, 'web-mobile')));

// POST /api/swap-images
// Scans gen-images/ and overwrites any same-named file found under web-mobile/assets/*/native/
app.post('/api/swap-images', (req, res) => {
  const genDir = path.join(__dirname, 'gen-images');
  const assetsDir = path.join(__dirname, 'web-mobile', 'assets');

  // Recursively collect all files under a directory
  function walk(dir) {
    let results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results = results.concat(walk(full));
      else results.push(full);
    }
    return results;
  }

  const genFiles = fs.readdirSync(genDir).filter(f => !f.startsWith('.'));
  const nativeFiles = walk(assetsDir);

  const swapped = [];
  const notFound = [];

  for (const filename of genFiles) {
    const src = path.join(genDir, filename);
    const targets = nativeFiles.filter(f => path.basename(f) === filename);
    if (targets.length === 0) {
      notFound.push(filename);
    } else {
      for (const dest of targets) {
        fs.copyFileSync(src, dest);
        swapped.push(path.relative(__dirname, dest));
      }
    }
  }

  res.json({ swapped, notFound });
  console.log(`[swap-images] swapped: ${JSON.stringify(swapped)}, notFound: ${JSON.stringify(notFound)}`);
});

// POST /api/agent  { "instruction": "...", "apiKey": "..." }
app.post('/api/agent', express.json(), async (req, res) => {
  const { instruction, apiKey } = req.body || {};
  if (!instruction) return res.status(400).json({ error: 'instruction required' });

  const key = apiKey || process.env.DEEPSEEK_API_KEY;
  if (!key) return res.status(400).json({ error: 'apiKey required (or set DEEPSEEK_API_KEY env var)' });

  console.log(`[agent] instruction: "${instruction}"`);

  try {
    const { reply, steps } = await runAgent(instruction, key, {
      onStep: (step) => {
        console.log(`[agent] tool=${step.tool} result=${JSON.stringify(step.result)}`);
      },
    });
    console.log(`[agent] reply: "${reply}"`);
    res.json({ reply, steps });
  } catch (err) {
    console.error('[agent] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n=== Cocos Game Server ===\n');
  console.log(`  Local:   http://localhost:${PORT}`);

  // Print all LAN IPv4 addresses
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`  LAN:     http://${iface.address}:${PORT}`);
      }
    }
  }

  console.log('\nPress Ctrl+C to stop.\n');
});
