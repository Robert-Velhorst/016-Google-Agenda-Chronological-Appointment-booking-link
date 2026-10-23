// Builds only this checkout's native driver. All database probes use a new temp directory.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const require = createRequire(join(root, 'package.json'));
const pin = JSON.parse(readFileSync(join(root, 'sqlite-build.json'), 'utf8'));
const hash = bytes => createHash('sha3-256').update(bytes).digest('hex');
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--require-upgrade-baseline')) throw new Error('Unexpected build arguments');
const driver = realpathSync(dirname(require.resolve('better-sqlite3/package.json')));
if (!driver.startsWith(join(root, 'node_modules') + sep)) throw new Error('Refusing a driver outside this checkout');
if (require('better-sqlite3/package.json').version !== pin.driverVersion) throw new Error('Unreviewed native driver version');
if (process.versions.node !== pin.nodeVersion) throw new Error('Use the pinned current Node runtime');
if (require('node-gyp/package.json').version !== pin.nodeGypVersion) throw new Error('Unreviewed native builder version');
const buildRoot = join(root, '.build'); mkdirSync(buildRoot, { recursive: true });
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const pythonProbe = spawnSync(python, ['--version'], {encoding:'utf8', timeout:10000});
if (pythonProbe.status !== 0 || (pythonProbe.stdout + pythonProbe.stderr).trim() !== 'Python ' + pin.pythonVersion) throw new Error('Use the pinned current Python build runtime');
const work = mkdtempSync(join(buildRoot, 'booking-sqlite-build-'));
const archive = join(work, 'source.zip'), source = join(work, 'amalgamation'), fixture = join(work, 'synthetic-upgrade.sqlite');
function run(command, parameters, cwd = root) {
  const result = spawnSync(command, parameters, { cwd, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Native SQLite build/probe failed');
}
// Loading an old Windows DLL happens in a child that exits before it is rebuilt.
const baseline = spawnSync(process.execPath, ['--input-type=commonjs', '-e', `
 const { DatabaseSync: Database } = require('node:sqlite'); const db = new Database(process.argv[1]);
 const sqlite = db.prepare('select sqlite_version() version').get().version;
 db.exec('CREATE TABLE stable_upgrade_fixture(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
 db.prepare('INSERT INTO stable_upgrade_fixture VALUES (?, ?)').run(1, 'synthetic-baseline');
 db.close(); console.log(JSON.stringify({sqlite}));
`, fixture], { cwd: root, encoding: 'utf8', timeout: 30_000 });
let before = null;
if (baseline.status === 0) before = JSON.parse(baseline.stdout.trim()).sqlite;
if (args.length && before !== '3.54.0') throw new Error('Expected actual Node SQLite 3.54.0 upgrade baseline');

const response = await fetch(pin.archiveUrl, { signal: AbortSignal.timeout(60_000) });
if (!response.ok || new URL(response.url).origin !== 'https://sqlite.org') throw new Error('SQLite download origin/status refused');
let size = 0; const chunks = [];
for await (const chunk of response.body) {
  size += chunk.byteLength;
  if (size > 16 * 1024 * 1024) throw new Error('SQLite archive exceeds limit');
  chunks.push(chunk);
}
const bytes = Buffer.concat(chunks);
if (hash(bytes) !== pin.archiveSha3) throw new Error('SQLite archive checksum mismatch');
writeFileSync(archive, bytes, { flag: 'wx' }); mkdirSync(source);
run(python, ['-c', "import pathlib,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); out=pathlib.Path(sys.argv[2]); prefix=sys.argv[3]; [(out/name).write_bytes(z.read(prefix+'/'+name)) for name in ('sqlite3.c','sqlite3.h','sqlite3ext.h')]", archive, source, pin.archivePrefix]);
const amalgamation = readFileSync(join(source, 'sqlite3.c'));
if (hash(amalgamation) !== pin.sourceSha3) throw new Error('SQLite amalgamation checksum mismatch');
// Preserve the reviewed driver's bundled compile options with its documented custom-source path.
const definesSource = readFileSync(join(driver, 'deps/defines.gypi'), 'utf8');
const defines = [...definesSource.matchAll(/^\s*'([A-Z][A-Z0-9_]*(?:=-?\d+)?)',\s*$/gm)].map(match => match[1]);
if (defines.length !== 36 || !defines.includes('SQLITE_THREADSAFE=2') || !defines.includes('SQLITE_ENABLE_FTS5')) throw new Error('Unexpected driver compile options');
writeFileSync(join(source, 'sqlite3.c'), Buffer.concat([Buffer.from(defines.map(value => '#define ' + (value.includes('=') ? value.replace('=', ' ') : value + ' 1')).join('\n') + '\n'), amalgamation]));
run(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild', '--release', '--jobs=1', '--force_build=1', '--devdir=' + join(buildRoot, 'node-headers'), '--sqlite3=' + source], driver);
// Driver 13 prefers shipped prebuilds over the rebuilt addon. Verify our new
// addon explicitly, then remove only its eight known obsolete prebuild files.
const compiled = join(driver, 'build/Release/better_sqlite3.node');
run(process.execPath, ['--input-type=commonjs', '-e', "const assert=require('node:assert/strict');const Database=require('better-sqlite3');const db=new Database(':memory:',{nativeBinding:process.argv[1]});try{assert.equal(db.prepare('SELECT sqlite_version() v').get().v,'3.54.1');}finally{db.close();}", compiled]);
for (const target of ['linux-x64','linux-arm64','linuxmusl-x64','linuxmusl-arm64','darwin-x64','darwin-arm64','win32-x64','win32-arm64']) {
  const prebuild = join(driver, 'prebuilds', target + '.node');
  if (existsSync(prebuild)) {
    if (!realpathSync(prebuild).startsWith(driver + sep)) throw new Error('Refusing prebuild outside the local driver');
    unlinkSync(prebuild);
  }
}
const verification = join(work, 'verification.json');
run(process.execPath, ['--input-type=commonjs', '-e', `
 const fs = require('node:fs'), assert = require('node:assert/strict'); const Database = require('better-sqlite3');
 (async () => {
  const baseline = process.argv[3] === 'yes'; const db = new Database(baseline ? process.argv[1] : ':memory:');
  const sqlite = db.prepare('select sqlite_version() version').get().version; assert.equal(sqlite, '3.54.1');
  if (baseline) {
   assert.equal(db.prepare('SELECT value FROM stable_upgrade_fixture WHERE id=1').get().value, 'synthetic-baseline');
   db.transaction(() => db.prepare('INSERT INTO stable_upgrade_fixture VALUES (?, ?)').run(2, 'synthetic-after-upgrade'))();
   await db.backup(process.argv[1] + '.backup');
   const copy = new Database(process.argv[1] + '.backup', {readonly:true}); assert.equal(copy.prepare('SELECT count(*) n FROM stable_upgrade_fixture').get().n, 2); copy.close();
  }
  assert.equal(db.pragma('integrity_check', {simple:true}), 'ok'); db.close();
  fs.writeFileSync(process.argv[2], JSON.stringify({sqlite, upgradeAndBackupVerified:baseline}));
 })().catch(e => {console.error(e.message); process.exitCode=1;});
`, fixture, verification, before ? 'yes' : 'no']);
const proof = JSON.parse(readFileSync(verification, 'utf8'));
const binary = readFileSync(compiled);
mkdirSync(join(root, 'output'), { recursive: true });
writeFileSync(join(root, 'output/sqlite-build-verification.json'), JSON.stringify({ ...proof, previousSqlite: before, driver: pin.driverVersion, node: process.versions.node, python:pin.pythonVersion, nodeGyp:pin.nodeGypVersion, platform: process.platform, arch: process.arch, sourceSha3: pin.sourceSha3, archiveSha3: pin.archiveSha3, compileOptions: defines, binarySha256: createHash('sha256').update(binary).digest('hex'), operatorDataTouched: false }, null, 2) + '\n');
for (const name of ['sqlite3.c','sqlite3.h','sqlite3ext.h']) unlinkSync(join(source, name));
rmdirSync(source); unlinkSync(archive); unlinkSync(verification);
if (before) { unlinkSync(fixture); unlinkSync(fixture + '.backup'); }
rmdirSync(work);
console.log('Verified SQLite ' + proof.sqlite + ' on ' + process.platform);
