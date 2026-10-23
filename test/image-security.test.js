'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const image='sha256:'+'a'.repeat(64);
function fixture() {
  return {SchemaVersion:2,ArtifactType:'container_image',Metadata:{ImageID:image,OS:{Family:'alpine',Name:'3.24.3',EOSL:false}},Results:[
    {Class:'os-pkgs',Type:'alpine',Packages:[{Name:'musl',Version:'fixture-version'}],Vulnerabilities:[]},
    {Class:'lang-pkgs',Type:'npm',Packages:Object.entries(require('../package.json').dependencies).map(([Name,Version])=>({Name,Version})),Vulnerabilities:[]}
  ]};
}
function verify(scan,id=image) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'booking-scan-fixture-'));
  const report=path.join(dir,'scan.json'), identity=path.join(dir,'image-id.txt');
  try {
    fs.writeFileSync(report,JSON.stringify(scan));fs.writeFileSync(identity,id);
    return spawnSync(process.execPath,['scripts/verify-image-security.js',report,identity],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:30000});
  } finally {fs.unlinkSync(report);fs.unlinkSync(identity);fs.rmdirSync(dir);}
}
test('package gate accepts complete exact-image inventory',()=>{
  const result=verify(fixture());assert.equal(result.status,0,result.stderr);
  const proof=JSON.parse(result.stdout);assert.equal(proof.directDependencies,3);assert.equal(proof.wholeImageAcceptance,false);
});
for(const [name,mutate] of [
  ['a different image',s=>{s.Metadata.ImageID='sha256:'+'b'.repeat(64);}],
  ['an old base OS',s=>{s.Metadata.OS.Name='3.24.2';}],
  ['missing OS inventory',s=>{s.Results.shift();}],
  ['missing direct dependency',s=>{s.Results[1].Packages.pop();}],
  ['any reported severity',s=>{s.Results[0].Vulnerabilities=[{VulnerabilityID:'synthetic-low',Severity:'LOW'}];}],
  ['a modified finding',s=>{s.Results[0].ExperimentalModifiedFindings=[{VulnerabilityID:'synthetic'}];}]
]) test('package gate rejects '+name,()=>{const scan=fixture();mutate(scan);assert.notEqual(verify(scan).status,0);});
