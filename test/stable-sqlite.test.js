'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { openDatabase, audit, withImmediateTransaction } = require('../src/db');
const { createVault } = require('../src/crypto');
const { assertSqliteVersion } = require('../src/sqlite-runtime');

test('rejects an older SQLite engine', () => {
  assert.throws(() => assertSqliteVersion('3.54.0'), /SQLite 3.54.1 build required/);
  assert.doesNotThrow(() => assertSqliteVersion('3.54.1'));
});

test('rejects an unqualified addon before creating an operator directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-engine-guard-'));
  const target = path.join(root, 'must-not-exist', 'operator.sqlite');
  try {
    const result = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const Module = require('node:module'); const original = Module._load;
      let closed = false;
      Module._load = function(name, ...rest) {
        if (name === 'better-sqlite3') return class {
          constructor(filename) { assert.equal(filename, ':memory:'); }
          prepare() { return {get() { return {version:'3.54.0'}; }}; }
          close() { closed = true; }
        };
        return original.call(this, name, ...rest);
      };
      assert.throws(() => require('./src/db').openDatabase({databasePath:process.argv[1]}), /SQLite 3.54.1 build required/);
      assert.equal(closed,true);
    `, target], { cwd:path.resolve(__dirname,'..'), encoding:'utf8', timeout:30000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.dirname(target)), false);
  } finally { fs.rmdirSync(root); }
});

test('preserves original application schema, encrypted records, transactions and backup after upgrade', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-sqlite-upgrade-'));
  const filename = path.join(root,'fixture.sqlite');
  const backup = path.join(root,'fixture-backup.sqlite');
  const vault = createVault('11'.repeat(32));
  const ciphertext = vault.encrypt('synthetic-oauth-token');
  let db;
  try {
    const baseline = spawnSync(process.execPath, ['-e', `
      const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
      const { DatabaseSync }=require('node:sqlite'); const db=new DatabaseSync(process.argv[1]);
      assert.equal(db.prepare('select sqlite_version() v').get().v,'3.54.0');
      db.exec(fs.readFileSync('migrations/001_initial.sql','utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run('001_initial.sql','2026-10-01');
      db.prepare('INSERT INTO owners VALUES (?,?,?)').run('synthetic-owner','fixture@example.invalid','2026-10-01');
      db.prepare('INSERT INTO oauth_connections(owner_id,encrypted_tokens,scopes,status,updated_at) VALUES (?,?,?,?,?)').run('synthetic-owner',process.argv[2],'synthetic-scope','connected','2026-10-01');
      db.close();
    `, filename, ciphertext], {cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:30000});
    assert.equal(baseline.status,0,baseline.stderr);
    db=openDatabase({databasePath:filename,ownerId:'synthetic-owner',ownerEmail:'fixture@example.invalid'});
    assert.equal(db.prepare('SELECT sqlite_version() v').get().v,'3.54.1');
    assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n,3);
    assert.equal(db.prepare('SELECT encrypted_tokens FROM oauth_connections').get().encrypted_tokens,ciphertext);
    assert.equal(vault.decrypt(ciphertext),'synthetic-oauth-token');
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
    assert.throws(() => withImmediateTransaction(db, () => {
      db.prepare('UPDATE owners SET email=?').run('rollback@example.invalid');
      throw new Error('synthetic rollback');
    }), /synthetic rollback/);
    assert.equal(db.prepare('SELECT email FROM owners').get().email,'fixture@example.invalid');
    withImmediateTransaction(db, () => audit(db,{ownerId:'synthetic-owner',actorType:'test',action:'upgrade',entityType:'fixture'}));
    db.exec(`VACUUM INTO '${backup.replace(/'/g,"''")}'`);
    const Driver=require('../src/sqlite-runtime').getSqliteDriver();
    const copy=new Driver(backup,{readonly:true});
    try {
      assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      assert.equal(copy.prepare('SELECT count(*) n FROM audit_logs').get().n,1);
      assert.equal(vault.decrypt(copy.prepare('SELECT encrypted_tokens FROM oauth_connections').get().encrypted_tokens),'synthetic-oauth-token');
    } finally { copy.close(); }
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally {
    if(db) db.close();
    // Only exact files in the newly created synthetic fixture directory.
    for(const file of [filename,filename+'-wal',filename+'-shm',backup,backup+'-wal',backup+'-shm']) if(fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(root);
  }
});
