import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli=fileURLToPath(new URL('../bin/opencode-client.js',import.meta.url));
test('CLI user scope reaches generator and explicit-file installer without project target',async t=>{
  const generated=JSON.parse(execFileSync(process.execPath,[cli,'config','--agent','cursor','--scope','user'],{encoding:'utf8'}));
  assert.equal(generated.scope,'user');assert.equal(generated.path,join(homedir(),'.cursor/mcp.json'));
  const target=await mkdtemp(join(tmpdir(),'opencode user cli '));
  t.after(()=>rm(target,{recursive:true,force:true}));
  const path=join(target,'global-mcp.json');
  const args=[cli,'install','--agent','generic','--scope','user','--config',path];
  const dry=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));
  assert.equal(dry.scope,'user');assert.equal(dry.applied,false);assert.deepEqual(await readdir(target),[]);
  const applied=JSON.parse(execFileSync(process.execPath,[...args,'--apply'],{encoding:'utf8'}));
  assert.equal(applied.applied,true);assert.ok(JSON.parse(await readFile(path,'utf8')).mcpServers['opencode-client']);
  assert.equal(spawnSync(process.execPath,[cli,'install','--agent','generic','--scope','invalid'],{encoding:'utf8'}).status,1);
});
test('config and install reject missing scope even when a target or config path is supplied',async t=>{
  const target=await mkdtemp(join(tmpdir(),'opencode explicit scope '));
  t.after(()=>rm(target,{recursive:true,force:true}));
  for(const args of [
    ['config','--agent','generic'],
    ['install','--agent','generic','--target',target,'--config','mcp.json','--apply'],
    ['install','--agent','generic','--config',join(target,'mcp.json'),'--apply']
  ]){
    const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
    assert.equal(result.status,1);assert.match(JSON.parse(result.stderr).error,/scope.*required/i);
  }
  assert.deepEqual(await readdir(target),[]);
});
