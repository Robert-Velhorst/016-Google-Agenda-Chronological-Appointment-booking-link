'use strict';

const pin = require('../sqlite-build.json');
let qualifiedDriver;

function assertSqliteVersion(version) {
  if (version !== pin.version) throw new Error(`SQLite ${pin.version} build required; run npm run build:sqlite`);
}

function getSqliteDriver() {
  if (qualifiedDriver) return qualifiedDriver;
  if (require('better-sqlite3/package.json').version !== pin.driverVersion) throw new Error('Unreviewed SQLite driver version');
  const Driver = require('better-sqlite3');
  // This probe cannot open an operator database and cannot create its directory.
  const probe = new Driver(':memory:');
  try { assertSqliteVersion(probe.prepare('SELECT sqlite_version() version').get().version); }
  finally { probe.close(); }
  qualifiedDriver = Driver;
  return Driver;
}

module.exports = { assertSqliteVersion, getSqliteDriver };
