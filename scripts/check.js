'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = [];
for (const directory of ['src', 'scripts', 'test']) {
  const full = path.join(root, directory);
  if (!fs.existsSync(full)) continue;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(path.join(full, entry.name));
}
files.push(path.join(root, 'content.js'), path.join(root, 'test-content.js'));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${path.relative(root, file)} failed syntax validation:\n${result.stderr}`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
for (const icon of Object.values(manifest.icons || {})) if (!fs.existsSync(path.join(root, icon))) throw new Error(`Missing manifest icon: ${icon}`);
console.log(`Syntax checked ${files.length} JavaScript files; manifest and icons are valid.`);
