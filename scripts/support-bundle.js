'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');

const config = loadConfig();
const db = openDatabase(config);
const output = path.join(path.dirname(config.databasePath), 'support-bundles', `support-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
const bundle = {
  generatedAt: new Date().toISOString(),
  runtime: { node: process.versions.node, platform: process.platform, arch: process.arch },
  configuration: { appEnv: config.appEnv, baseUrl: config.baseUrl, googleConfigured: config.googleConfigured, encryptionConfigured: Boolean(config.encryptionKey) },
  migrations: db.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),
  counts: {
    schedules: db.prepare('SELECT COUNT(*) AS count FROM schedules').get().count,
    bookings: db.prepare('SELECT COUNT(*) AS count FROM bookings').get().count,
    failedBookings: db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE status='failed' OR error_code IS NOT NULL").get().count
  },
  recentAudit: db.prepare('SELECT action, entity_type, created_at FROM audit_logs ORDER BY id DESC LIMIT 50').all()
};
fs.writeFileSync(output, JSON.stringify(bundle, null, 2), { mode: 0o600 });
db.close();
console.log(`Redacted support bundle created: ${output}`);
