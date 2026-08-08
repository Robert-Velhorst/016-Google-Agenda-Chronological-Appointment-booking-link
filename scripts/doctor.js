'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createVault } = require('../src/crypto');
const { openDatabase } = require('../src/db');

const checks = [];
function add(name, ok, detail, required = true) { checks.push({ name, ok, detail, required }); }
try {
  const config = loadConfig();
  add('configuration', true, `${config.appEnv} at ${config.baseUrl}`);
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  add('node', nodeMajor > 24 || (nodeMajor === 24 && nodeMinor >= 15), `${process.versions.node}; requires 24.15 or newer`);
  add('frontend build', fs.existsSync(path.resolve(__dirname, '..', 'dist', 'index.html')), 'run npm run build when missing', false);
  add('Google OAuth', config.googleConfigured, config.googleConfigured ? 'credentials present' : 'not configured; booking mutations disabled', false);
  add('encryption', createVault(config.encryptionKey).available, 'required for OAuth tokens and manage-token recovery');
  const db = openDatabase(config);
  add('database', true, `${db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count} migration(s)`);
  db.close();
} catch (error) { add('configuration/startup', false, error.message); }
for (const check of checks) console.log(`${check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN'} ${check.name}: ${check.detail}`);
if (checks.some((check) => !check.ok && check.required)) process.exitCode = 1;
