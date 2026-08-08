'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(config) {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  runMigrations(db, path.resolve(__dirname, '..', 'migrations'));
  db.prepare('INSERT OR IGNORE INTO owners(id, email, created_at) VALUES (?, ?, ?)')
    .run(config.ownerId, config.ownerEmail, new Date().toISOString());
  return db;
}

function runMigrations(db, directory) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));
  const files = fs.readdirSync(directory).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function withImmediateTransaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = operation();
    if (value && typeof value.then === 'function') {
      throw new Error('Database transactions must not await network or other asynchronous work');
    }
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function audit(db, entry) {
  db.prepare(`INSERT INTO audit_logs
    (owner_id, actor_type, action, entity_type, entity_id, request_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(entry.ownerId || null, entry.actorType, entry.action, entry.entityType,
      entry.entityId || null, entry.requestId || null, JSON.stringify(entry.details || {}), new Date().toISOString());
}

module.exports = { audit, openDatabase, runMigrations, withImmediateTransaction };
