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
    const prefix = short.slice(0, 2);
    const b64 = short.slice(2).replace(/-/g, '+').replace(/_/g, '/') + '==';
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== 15) return null;

    const hex = prefix + buf.toString('hex');
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
  const nativeDir = path.join(bundleConfig.dir, 'native');
  if (!fs.existsSync(nativeDir)) return [];

  const results = [];
  const seenFiles = new Set();

  for (const short of shortUUIDs) {
    const fullUUID = decodeShortUUID(short);
    if (!fullUUID) continue;

    const prefix = fullUUID.slice(0, 2);

    const nativeSubDir = path.join(nativeDir, prefix);
    if (!fs.existsSync(nativeSubDir)) continue;

    const nativeFiles = fs.readdirSync(nativeSubDir)
      .filter(f => f.startsWith(`${fullUUID}.`))
      .map(f => path.join(nativeSubDir, f));

    for (const file of nativeFiles) {
      if (seenFiles.has(file)) continue;
      seenFiles.add(file);
      results.push({ shortUUID: short, fullUUID, prefix, file });
    }
  }

  return results;
}

function extractNames(raw) {
  return [...raw.matchAll(/"name"\s*:\s*"([^"]+)"/g)]
    .map(match => match[1].trim())
    .filter(Boolean);
}

function extractShortUUIDs(raw) {
  return [...raw.matchAll(/"([A-Za-z0-9+/_-]{22,23})(?:@[A-Za-z0-9]+)?"/g)]
    .map(match => match[1])
    .filter(value => !value.startsWith('db://'));
}

function listStructuredAssets(assetsRoot) {
  const bundles = fs.readdirSync(assetsRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => loadBundleConfig(path.join(assetsRoot, e.name)))
    .filter(Boolean);

  const assetsByFile = new Map();

  for (const bundle of bundles) {
    const importDir = path.join(bundle.dir, 'import');
    const nativeDir = path.join(bundle.dir, 'native');
    if (!fs.existsSync(importDir)) continue;

    const importFiles = walk(importDir).filter(f => f.endsWith('.json'));

    for (const packFile of importFiles) {
      let raw;
      try { raw = fs.readFileSync(packFile, 'utf8'); } catch { continue; }

      const names = [...new Set(extractNames(raw))];
      const shortUUIDs = [...new Set(extractShortUUIDs(raw))];
      const resolved = resolveNativeFiles(bundle, shortUUIDs);

      for (const item of resolved) {
        const existing = assetsByFile.get(item.file);
        if (existing) {
          existing.names = [...new Set(existing.names.concat(names))];
          existing.packFiles = [...new Set(existing.packFiles.concat(packFile))];
          continue;
        }

        assetsByFile.set(item.file, {
          bundle: bundle.name,
          shortUUID: item.shortUUID,
          fullUUID: item.fullUUID,
          file: item.file,
          names,
          packFiles: [packFile],
          context: raw.slice(0, 400),
        });
      }
    }

    if (!fs.existsSync(nativeDir)) continue;
    const nativeFiles = walk(nativeDir);
    for (const file of nativeFiles) {
      if (assetsByFile.has(file)) continue;
      const basename = path.basename(file);
      assetsByFile.set(file, {
        bundle: bundle.name,
        shortUUID: null,
        fullUUID: basename.replace(/\.[^.]+$/, ''),
        file,
        names: [],
        packFiles: [],
        context: '',
      });
    }
  }

  return Array.from(assetsByFile.values()).map(asset => ({
    bundle: asset.bundle,
    shortUUID: asset.shortUUID,
    fullUUID: asset.fullUUID,
    file: asset.file,
    name: asset.names[0] || asset.fullUUID || path.basename(asset.file),
    names: asset.names,
    packFiles: asset.packFiles,
    context: asset.context,
  }));
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
  const lowerKw = keyword.toLowerCase();
  return listStructuredAssets(assetsRoot).filter(asset => {
    const haystacks = [
      asset.name,
      ...(asset.names || []),
      asset.fullUUID,
      asset.file,
      asset.context,
    ].filter(Boolean);
    return haystacks.some(value => value.toLowerCase().includes(lowerKw));
  });
}

module.exports = { findAssets, listStructuredAssets, decodeShortUUID };
