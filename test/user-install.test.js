import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config, install } from '../src/install.js';

const url='http://127.0.0.1:4096';
const expected={
  codex:['.codex/config.toml','.agents/skills/opencode/SKILL.md'],
  claude:['.claude.json','.claude/skills/opencode/SKILL.md'],
  cursor:['.cursor/mcp.json','.cursor/skills/opencode/SKILL.md'],
  gemini:['.gemini/settings.json','.gemini/skills/opencode/SKILL.md'],
  opencode:['.config/opencode/opencode.json','.config/opencode/skills/opencode/SKILL.md']
};
test('user scope installs configuration and skill once for all projects',async()=>{
  for(const [agent,[configuration,skill]] of Object.entries(expected)){
    const home=await mkdtemp(join(tmpdir(),'opencode user '));
    const options={agent,scope:'user',home,env:{},url};
    const dry=await install(options);
    assert.equal(dry.scope,'user');assert.equal(dry.files[0].path,join(home,configuration));
    assert.equal(dry.files[1].path,join(home,skill));assert.deepEqual(await readdir(home),[]);
    await install({...options,apply:true});
    assert.match(await readFile(join(home,configuration),'utf8'),/opencode-client/);
    assert.match(await readFile(join(home,skill),'utf8'),/opencode_delegate/);
    const repeated=await install({...options,apply:true});assert.equal(repeated.files.every(f=>!f.changed),true);
  }
});
test('Claude user scope preserves per-project settings and keeps unrelated secrets out of previews',async()=>{
  const home=await mkdtemp(join(tmpdir(),'opencode claude user '));
  const path=join(home,'.claude.json');
  const original='{"privateToken":"keep-this-secret","projects":{"/work":{"mcpServers":{"project-only":{"command":"existing"}}}},"mcpServers":{"other":{"command":"other"}}}';
  await writeFile(path,original);
  const result=await install({agent:'claude',scope:'user',home,env:{},url,apply:true});
  const actual=JSON.parse(await readFile(path,'utf8'));
  assert.equal(actual.privateToken,'keep-this-secret');assert.equal(actual.projects['/work'].mcpServers['project-only'].command,'existing');assert.equal(actual.mcpServers.other.command,'other');assert.ok(actual.mcpServers['opencode-client']);
  assert.equal(await readFile(result.files[0].backup,'utf8'),original);
  assert.equal(JSON.stringify(result).includes('keep-this-secret'),false);
});
test('user path resolution honors host directory overrides without moving Codex skills',()=>{
  const home=join(tmpdir(),'user-home');const custom=join(tmpdir(),'custom-root');
  const codex=config({agent:'codex',scope:'user',home,env:{CODEX_HOME:join(custom,'codex')},url});
  assert.equal(codex.path,join(custom,'codex/config.toml'));assert.equal(codex.skillPath,join(home,'.agents/skills/opencode/SKILL.md'));
  const claude=config({agent:'claude',scope:'user',home,env:{CLAUDE_CONFIG_DIR:join(custom,'claude')},url});
  assert.equal(claude.path,join(custom,'claude/.claude.json'));assert.equal(claude.skillPath,join(custom,'claude/skills/opencode/SKILL.md'));
  const opencode=config({agent:'opencode',scope:'user',home,env:{XDG_CONFIG_HOME:custom},url});
  assert.equal(opencode.path,join(custom,'opencode/opencode.json'));
});
test('user OpenCode JSONC and conflicting global skills receive the same preservation rules',async()=>{
  const home=await mkdtemp(join(tmpdir(),'opencode global conflict '));
  await mkdir(join(home,'.config/opencode'),{recursive:true});
  const path=join(home,'.config/opencode/opencode.jsonc');
  await writeFile(path,'{ // keep\n "model":"example/model"\n}');
  const options={agent:'opencode',scope:'user',home,env:{},url,apply:true};
  const result=await install(options);assert.equal(result.files[0].path,path);assert.match(await readFile(path,'utf8'),/keep/);
  const before=await readFile(path,'utf8');await writeFile(result.files[1].path,'custom skill');
  await assert.rejects(install(options),/Skill already exists/);assert.equal(await readFile(path,'utf8'),before);
});
test('user scope validates scope, rejects project target, and requires explicit paths for profile-dependent hosts',async()=>{
  const home=await mkdtemp(join(tmpdir(),'opencode explicit user '));
  await assert.rejects(install({agent:'codex',scope:'invalid',home,env:{},url}),/scope/);
  await assert.rejects(install({agent:'codex',scope:'user',target:home,home,env:{},url}),/target/);
  await assert.rejects(install({agent:'vscode',scope:'user',home,env:{},url}),/--config/);
  await assert.rejects(install({agent:'generic',scope:'user',configPath:'relative.json',home,env:{},url}),/absolute/);
  const path=join(home,'VS Code Profile/mcp.json');
  const result=await install({agent:'vscode',scope:'user',configPath:path,home,env:{},url,apply:true});
  assert.equal(result.files[0].path,path);assert.equal(result.files[1].path,join(home,'.copilot/skills/opencode/SKILL.md'));
  assert.equal(JSON.parse(await readFile(path,'utf8')).servers['opencode-client'].type,'stdio');
});
test('user install writes custom Codex config and shared user skill to their separate roots',async()=>{
  const home=await mkdtemp(join(tmpdir(),'opencode separate home '));
  const codexRoot=await mkdtemp(join(tmpdir(),'opencode custom config '));
  const result=await install({agent:'codex',scope:'user',home,env:{CODEX_HOME:codexRoot},url,apply:true});
  assert.equal(result.files[0].path,join(codexRoot,'config.toml'));
  assert.equal(result.files[1].path,join(home,'.agents/skills/opencode/SKILL.md'));
  assert.match(await readFile(join(codexRoot,'config.toml'),'utf8'),/opencode-client/);
  await assert.rejects(readFile(join(home,'.codex/config.toml')),e=>e.code==='ENOENT');
});
test('library config and install require explicit scope without inferring it from paths',async()=>{
  const target=await mkdtemp(join(tmpdir(),'opencode required scope '));
  assert.throws(()=>config({agent:'codex',url}),/scope.*required/i);
  for(const options of [{target},{configPath:join(target,'mcp.json')}]){
    await assert.rejects(install({agent:'generic',url,apply:true,...options}),/scope.*required/i);
  }
  assert.deepEqual(await readdir(target),[]);
});
