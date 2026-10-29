import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config, install } from '../src/install.js';

async function workspace() { return mkdtemp(join(tmpdir(), 'opencode install ')); }
const url = 'http://127.0.0.1:4096';

test('configuration uses argument arrays and correct host envelopes', () => {
  for (const agent of ['claude', 'cursor', 'gemini', 'generic', 'windsurf', 'cline', 'roo']) {
    const result = config({agent, url});
    const value = JSON.parse(result.content).mcpServers['opencode-client'];
    assert.equal(value.env.OPENCODE_URL, url);
    assert.equal(value.args.at(-1), 'mcp');
    assert.ok(value.args[0].endsWith(join('bin', 'opencode-client.js')));
  }
  assert.equal(JSON.parse(config({agent:'vscode',url}).content).servers['opencode-client'].type, 'stdio');
  assert.equal(JSON.parse(config({agent:'gemini',url}).content).mcpServers['opencode-client'].env.OPENCODE_TOKEN, '${OPENCODE_TOKEN}');
  assert.match(config({agent:'codex',url}).content, /env_vars = .*OPENCODE_TOKEN/);
  const local = JSON.parse(config({agent:'opencode',url}).content).mcp['opencode-client'];
  assert.equal(local.type, 'local');
  assert.equal(local.command.at(-1), 'mcp');
  assert.throws(() => config({agent:'unknown',url}), /Unsupported agent/);
  assert.throws(() => config({agent:'claude',url:'http://user:secret@localhost:4096'}), /credentials/);
});

test('dry run creates nothing; applying preserves JSONC comments and other servers', async () => {
  const target = await workspace();
  await mkdir(join(target,'.cursor'));
  const path = join(target,'.cursor/mcp.json');
  const original = '{\n // Keep this comment\n "mcpServers": {"existing":{"command":"other"}},\n "other": true,\n}\n';
  await writeFile(path, original);
  const dry = await install({agent:'cursor',target,url});
  assert.equal(dry.applied, false);
  assert.equal(await readFile(path,'utf8'),original);
  assert.equal((await readdir(join(target,'.cursor'))).length,1);
  const applied = await install({agent:'cursor',target,url,apply:true});
  const content = await readFile(path,'utf8');
  assert.match(content,/Keep this comment/);
  assert.match(content,/"existing"/);
  assert.match(content,/"opencode-client"/);
  assert.equal(await readFile(applied.files[0].backup,'utf8'),original);
  const second = await install({agent:'cursor',target,url,apply:true});
  assert.equal(second.files[0].changed,false);
  assert.equal(await readFile(path,'utf8'),content);
});

test('conflicting and invalid existing config never gets overwritten', async () => {
  const target = await workspace();
  await mkdir(join(target,'.cursor'));
  const path = join(target,'.cursor/mcp.json');
  for (const original of ['{"mcpServers":{"opencode-client":{"command":"mine"}}}', '{broken', '{"mcpServers":[]}', '{"mcpServers":null}']) {
    await writeFile(path,original);
    await assert.rejects(install({agent:'cursor',target,url,apply:true}));
    assert.equal(await readFile(path,'utf8'),original);
  }
});

test('Codex TOML appends only the new table and refuses existing conflicts', async () => {
  const target = await workspace();
  await mkdir(join(target,'.codex'));
  const path = join(target,'.codex/config.toml');
  const original = '# untouched\nmodel = "example"\n[mcp_servers.other]\ncommand = "other"\n';
  await writeFile(path,original);
  const dry = await install({agent:'codex',target,url});
  assert.ok(dry.config.content.startsWith(original));
  assert.match(dry.config.content,/mcp_servers\."opencode-client"/);
  assert.equal(await readFile(path,'utf8'),original);
  const existing = '[mcp_servers."opencode-client"]\ncommand = "mine"\n';
  await writeFile(path,existing);
  await assert.rejects(install({agent:'codex',target,url,apply:true}),/already exists/);
  assert.equal(await readFile(path,'utf8'),existing);
});

test('generation-only agents do not guess writable configuration paths', async () => {
  for (const agent of ['generic','windsurf','cline','roo']) {
    await assert.rejects(install({agent,target:await workspace(),url,apply:true}),/generation only/);
  }
});

test('Codex and Claude apply both config and skill and can be safely reinstalled', async () => {
  for (const agent of ['codex','claude']) {
    const target = await workspace();
    const first = await install({agent,target,url,apply:true});
    assert.equal(first.files.length,2);
    assert.equal(first.files.every(file => file.changed),true);
    assert.match(await readFile(first.files[1].path,'utf8'),/opencode/i);
    const second = await install({agent,target,url,apply:true});
    assert.equal(second.files.every(file => !file.changed),true);
    await writeFile(first.files[1].path,'My customized skill');
    await assert.rejects(install({agent,target,url,apply:true}),/Skill already exists/);
  }
});

test('existing skill conflicts are caught before configuration is written', async () => {
  const target = await workspace();
  await mkdir(join(target,'.claude/skills/opencode'),{recursive:true});
  await writeFile(join(target,'.claude/skills/opencode/SKILL.md'),'custom');
  await assert.rejects(install({agent:'claude',target,url,apply:true}),/Skill already exists/);
  await assert.rejects(readFile(join(target,'.mcp.json')),error => error.code === 'ENOENT');
});

test('OpenCode JSONC is edited in place instead of shadowed by JSON', async () => {
  const target = await workspace();
  await writeFile(join(target,'opencode.jsonc'),'{ // retain\n "model": "example/model"\n}\n');
  const result = await install({agent:'opencode',target,url,apply:true});
  assert.equal(result.config.relativePath,'opencode.jsonc');
  assert.match(await readFile(join(target,'opencode.jsonc'),'utf8'),/retain/);
  await assert.rejects(readFile(join(target,'opencode.json')),error => error.code === 'ENOENT');
});

test('malformed TOML is rejected and comments survive Codex installation', async () => {
  const target = await workspace();
  await mkdir(join(target,'.codex'));
  const path = join(target,'.codex/config.toml');
  await writeFile(path,'[broken\n');
  await assert.rejects(install({agent:'codex',target,url,apply:true}));
  assert.equal(await readFile(path,'utf8'),'[broken\n');
  const original = '# keep me\nmodel = "test" # inline comment\n[mcp_servers.other]\ncommand = "other"\n';
  await writeFile(path,original);
  await install({agent:'codex',target,url,apply:true});
  const updated = await readFile(path,'utf8');
  assert.ok(updated.startsWith(original));
  await install({agent:'codex',target,url,apply:true});
  assert.equal(await readFile(path,'utf8'),updated);
});

test('explicit host configuration path enables automatic safe merge without guessing',async()=>{
  const target=await workspace();
  const path=join(target,'host-settings.json');
  const original='{"mcpServers":{"other":{"command":"existing"}}}';
  await writeFile(path,original);
  const dry=await install({agent:'windsurf',target,configPath:'host-settings.json',url});
  assert.equal(await readFile(path,'utf8'),original);assert.equal(dry.files[0].path,path);
  await install({agent:'windsurf',target,configPath:'host-settings.json',url,apply:true});
  const actual=JSON.parse(await readFile(path,'utf8'));assert.equal(actual.mcpServers.other.command,'existing');assert.equal(actual.mcpServers['opencode-client'].env.OPENCODE_URL,url);
  await assert.rejects(install({agent:'generic',target,configPath:'../outside.json',url}),/inside/);
});
test('other project hosts install the portable skill in documented discovery locations',async()=>{
  for(const [agent,skill] of [['cursor','.cursor/skills/opencode/SKILL.md'],['vscode','.github/skills/opencode/SKILL.md'],['gemini','.gemini/skills/opencode/SKILL.md'],['opencode','.opencode/skills/opencode/SKILL.md']]){
    const target=await workspace();const result=await install({agent,target,url,apply:true});
    assert.equal(result.files[1].path,join(target,skill));assert.match(await readFile(join(target,skill),'utf8'),/opencode_delegate/);
  }
});
