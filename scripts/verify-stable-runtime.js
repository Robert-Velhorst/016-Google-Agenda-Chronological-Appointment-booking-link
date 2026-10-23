'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { getSqliteDriver } = require('../src/sqlite-runtime');
const pin = require('../sqlite-build.json');

const installed=process.argv.length===3 && process.argv[2]==='--installed';
assert.ok(process.argv.length===2 || installed, 'Unexpected arguments');
assert.equal(process.versions.node, pin.nodeVersion);
if(installed) { assert.equal(process.platform,'linux'); assert.equal(process.getuid(),1000); assert.equal(process.getgid(),1000); }
const Database = getSqliteDriver();
const db = new Database(':memory:');
try {
  const sqlite = db.prepare('SELECT sqlite_version() version').get().version;
  assert.equal(sqlite, pin.version);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  const driver=path.dirname(require.resolve('better-sqlite3/package.json'));
  const binarySha256=createHash('sha256').update(fs.readFileSync(path.join(driver,'build/Release/better_sqlite3.node'))).digest('hex');
  const proof=JSON.parse(fs.readFileSync(path.join(__dirname,'../output/sqlite-build-verification.json'),'utf8'));
  assert.equal(proof.binarySha256,binarySha256); assert.equal(proof.sourceSha3,pin.sourceSha3); assert.equal(proof.archiveSha3,pin.archiveSha3);
  assert.equal(proof.previousSqlite,'3.54.0'); assert.equal(proof.upgradeAndBackupVerified,true); assert.equal(proof.compileOptions.length,36);
  const report = {node:process.versions.node, sqlite, driver:pin.driverVersion, platform:process.platform, arch:process.arch, uid:typeof process.getuid==='function'?process.getuid():null, nativeBinarySha256:binarySha256, sourceSha3:proof.sourceSha3, databaseScope:'new in-memory fixture only', operatorDataTouched:false};
  if(!installed) {fs.mkdirSync(path.join(__dirname, '../output'), {recursive:true});fs.writeFileSync(path.join(__dirname, '../output/stable-runtime-verification.json'), JSON.stringify(report, null, 2)+'\n');}
  console.log(JSON.stringify(report));
} finally { db.close(); }
