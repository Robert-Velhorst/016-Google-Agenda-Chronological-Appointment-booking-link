'use strict';
// Package inventory evidence only. This does not assess every compiled library
// inside Node/Chromium or establish deployment/provider acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const imageID = fs.readFileSync(process.argv[3], 'utf8').trim();
assert.match(imageID, /^sha256:[a-f0-9]{64}$/);
assert.equal(report.SchemaVersion, 2);
assert.equal(report.ArtifactType, 'container_image');
assert.equal(report.Metadata.ImageID, imageID);
assert.equal(report.Metadata.OS.Family, 'alpine');
assert.equal(report.Metadata.OS.Name, '3.24.3');
if (Object.hasOwn(report.Metadata.OS, 'EOSL')) assert.equal(report.Metadata.OS.EOSL, false);
assert.ok(Array.isArray(report.Results) && report.Results.length);
let osPackages = 0;
const installed = new Map();
for (const result of report.Results) {
  assert.ok(Array.isArray(result.Packages) && result.Packages.length);
  for (const key of ['Vulnerabilities', 'ExperimentalModifiedFindings']) {
    if (Object.hasOwn(result,key)) assert.ok(Array.isArray(result[key]) && result[key].length === 0, 'Unresolved vulnerability: '+key);
  }
  if(result.Class === 'os-pkgs') { assert.equal(result.Type,'alpine'); osPackages += result.Packages.length; }
  for(const pkg of result.Packages) {
    assert.ok(typeof pkg.Name === 'string' && pkg.Name.length && typeof pkg.Version === 'string' && pkg.Version.length);
    if(!installed.has(pkg.Name)) installed.set(pkg.Name,new Set());
    installed.get(pkg.Name).add(pkg.Version);
  }
}
assert.ok(osPackages > 0);
const dependencies = require('../package.json').dependencies;
for(const [name,version] of Object.entries(dependencies)) assert.ok(installed.get(name)?.has(version),'Missing exact runtime dependency: '+name);
console.log(JSON.stringify({passed:true,scope:'recorded OS and npm package findings',imageID,osPackages,directDependencies:Object.keys(dependencies).length,wholeImageAcceptance:false,deploymentAcceptance:false}));
