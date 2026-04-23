const express = require('express');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Fix MIME types required by Cocos Creator web builds
express.static.mime.define({
  'application/wasm': ['wasm'],
  'application/octet-stream': ['bin'],
});

// Serve web-mobile/ as the web root
app.use(express.static(path.join(__dirname, 'web-mobile')));

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
