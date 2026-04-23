/**
 * lib/cocos-asset-finder.js
 *
 * Deterministic tool: locates Cocos Creator web-build native asset files
 * by searching pack (scene serialization) data for a keyword, then resolving
 * the matching UUID to a native/ file path.
 *
 * Three-step tracing method:
 *   1. config.json  → uuids[] + packs{}
 *   2. pack JSON    → search keyword → short UUID
 *   3. short UUID   → full UUID → native/<prefix>/<uuid>.<ext>
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode a Cocos short-code UUID (Base64url, 22 chars) to the standard
 * xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx format.
 *
 * Cocos encodes the 16-byte UUID as Base64 (url-safe, no padding).
 * If the input already looks like a full UUID (contains '-'), return as-is.
 */
function decodeShortUUID(short) {
  if (short.includes('-')) return short;           // already full UUID
  if (short.length < 22)   return null;            // too short, skip (pack names etc.)

  try {
    // Base64url → Base64 standard
    const b64 = short.replace(/-/g, '+').replace(/_/g, '/') + '==';
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== 16) return null;

    const hex = buf.toString('hex');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
  } catch {
    return null;
  }
}

/**
 * Recursively walk a directory and return all file paths.
 */
function walk(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walk(full));
    else results.push(full);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Step 1 — Parse config.json for a bundle (main / internal / …)
// ---------------------------------------------------------------------------

function loadBundleConfig(bundleDir) {
  const configPath = path.join(bundleDir, 'config.json');
  if (!fs.existsSync(configPath)) return null;

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  return {
    name:   raw.name,
    uuids:  raw.uuids  || [],   // short-code UUID array, index == resource index
    packs:  raw.packs  || {},   // { packName: [idx, ...] }
    dir:    bundleDir,
  };
}

// ---------------------------------------------------------------------------
// Step 2 — Search pack files for a keyword, collect matching short UUIDs
// ---------------------------------------------------------------------------

function searchPacks(bundleConfig, keyword) {
  const importDir = path.join(bundleConfig.dir, 'import');
  if (!fs.existsSync(importDir)) return [];

  const packFiles = walk(importDir).filter(f => f.endsWith('.json'));
  const lowerKw   = keyword.toLowerCase();
  const hits      = [];   // { packFile, shortUUID, context }

  for (const packFile of packFiles) {
    let raw;
    try { raw = fs.readFileSync(packFile, 'utf8'); } catch { continue; }

    if (!raw.toLowerCase().includes(lowerKw)) continue;

    // Extract all quoted strings near the keyword and try to resolve as UUIDs
    // Also collect the surrounding context snippet for debugging
    const contextStart = Math.max(0, raw.toLowerCase().indexOf(lowerKw) - 80);
    const contextEnd   = Math.min(raw.length, contextStart + 200);
    const context      = raw.slice(contextStart, contextEnd);

    // Find all 22-char Base64 strings in the file (Cocos short UUIDs).
    // Strip optional @subAsset suffix (e.g. "b2wESvIkxJNoPy2lr91uoK@f9941").
    const shortUUIDs = [...raw.matchAll(/"([A-Za-z0-9+/_-]{22,23})(?:@[A-Za-z0-9]+)?"/g)]
      .map(m => m[1])
      .filter(s => !s.startsWith('db://'));

    hits.push({ packFile, shortUUIDs, context });
  }

  return hits;
}

// ---------------------------------------------------------------------------
// Step 3 — Resolve short UUIDs to native file paths
//
// Key insight: the first 2 chars of a Cocos short UUID are always identical
// to the first 2 chars of the full UUID (e.g. "b2wESv..." → "b2c044af-...").
// So we use the prefix to navigate to import/<prefix>/ and read the full UUID
// from the filenames there, then locate the corresponding native file.
// ---------------------------------------------------------------------------

function resolveNativeFiles(bundleConfig, shortUUIDs) {
  const importDir = path.join(bundleConfig.dir, 'import');
  const nativeDir = path.join(bundleConfig.dir, 'native');
  if (!fs.existsSync(nativeDir)) return [];

  const results = [];
  const seenPrefixes = new Set();

  for (const short of shortUUIDs) {
    const prefix = short.slice(0, 2);
    if (seenPrefixes.has(prefix)) continue;
    seenPrefixes.add(prefix);

    // Try to resolve full UUID from import/<prefix>/ directory listing
    let fullUUID = null;
    const importSubDir = path.join(importDir, prefix);
    if (fs.existsSync(importSubDir)) {
      // Files like "b2c044af-224c-4936-83f2-da5afdd6ea0a.json" (no '@')
      const importFiles = fs.readdirSync(importSubDir)
        .filter(f => f.endsWith('.json') && !f.includes('@'));
      if (importFiles.length > 0) {
        fullUUID = importFiles[0].replace('.json', '');
      }
    }

    // Find native files under native/<prefix>/
    const nativeSubDir = path.join(nativeDir, prefix);
    if (!fs.existsSync(nativeSubDir)) continue;

    const nativeFiles = fs.readdirSync(nativeSubDir)
      .map(f => path.join(nativeSubDir, f));

    for (const file of nativeFiles) {
      // If fullUUID resolved, use it; otherwise derive from filename
      const basename = path.basename(file);
      const resolvedUUID = fullUUID || basename.replace(/\.[^.]+$/, '');
      results.push({ shortUUID: short, fullUUID: resolvedUUID, prefix, file });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Find native asset files in a Cocos web-mobile build that are associated
 * with a given keyword (resource name, node name, partial UUID, etc.).
 *
 * @param {string} assetsRoot  - Absolute path to web-mobile/assets/
 * @param {string} keyword     - Search term (case-insensitive)
 * @returns {Array<{bundle, shortUUID, fullUUID, file, context}>}
 */
function findAssets(assetsRoot, keyword) {
  const bundles = fs.readdirSync(assetsRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => loadBundleConfig(path.join(assetsRoot, e.name)))
    .filter(Boolean);

  const results = [];

  for (const bundle of bundles) {
    const hits = searchPacks(bundle, keyword);

    for (const hit of hits) {
      const resolved = resolveNativeFiles(bundle, hit.shortUUIDs);

      if (resolved.length > 0) {
        for (const r of resolved) {
          results.push({
            bundle:    bundle.name,
            packFile:  hit.packFile,
            shortUUID: r.shortUUID,
            fullUUID:  r.fullUUID,
            file:      r.file,
            context:   hit.context,
          });
        }
      } else {
        // keyword found in pack but no native file resolved — still report
        results.push({
          bundle:    bundle.name,
          packFile:  hit.packFile,
          shortUUID: null,
          fullUUID:  null,
          file:      null,
          context:   hit.context,
        });
      }
    }
  }

  // Deduplicate by native file path
  const seen = new Set();
  return results.filter(r => {
    if (!r.file) return true;
    if (seen.has(r.file)) return false;
    seen.add(r.file);
    return true;
  });
}

module.exports = { findAssets, decodeShortUUID };
