import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

test('real stdio MCP handshake, tools, schema rejection and delegation round trip', async t=>{
  let accepted;let posts=0;
  const http=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    res.setHeader('content-type','application/json');
    const url=new URL(req.url,'http://localhost');
    if(req.method==='POST') posts++;
    if(url.pathname==='/global/health') return res.end('{"healthy":true,"version":"test"}');
    if(url.pathname==='/session' && req.method==='POST') return res.end('{"id":"ses_mcp"}');
    if(url.pathname.endsWith('/prompt_async')) {accepted=JSON.parse(body);res.statusCode=204;return res.end();}
    if(url.pathname.endsWith('/message')) return res.end(JSON.stringify([{info:{id:'msg_response',role:'assistant',parentID:accepted.messageID,time:{completed:1},finish:'stop'},parts:[{type:'text',text:'done'}]}]));
    if(url.pathname==='/session/status')return res.end('{}');
    if(url.pathname==='/permission'||url.pathname==='/question')return res.end('[]');
    res.statusCode=404;res.end('{}');
  });
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>http.close(resolve)));
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/opencode-client.js',import.meta.url)),'mcp','--url',`http://127.0.0.1:${http.address().port}`],stderr:'pipe'});
  const client=new Client({name:'integration-test',version:'1.0.0'});
  t.after(()=>client.close());
  await client.connect(transport);
  const {tools}=await client.listTools();
  assert.equal(tools.length,18);
  assert.equal(tools.find(t=>t.name==='opencode_delegate').annotations.readOnlyHint,false);
  const health=await client.callTool({name:'opencode_health',arguments:{}});
  assert.equal(JSON.parse(health.content[0].text).healthy,true);
  const invalid=await client.callTool({name:'opencode_delegate',arguments:{prompt:'missing directory'}});
  assert.equal(invalid.isError,true);assert.equal(posts,0);
  const submission=JSON.parse((await client.callTool({name:'opencode_delegate',arguments:{directory:'/work',prompt:'Say done'}})).content[0].text);
  assert.equal(submission.state,'accepted');assert.equal(posts,2);
  const result=JSON.parse((await client.callTool({name:'opencode_wait',arguments:{sessionID:submission.sessionID,directory:'/work',messageID:submission.messageID}})).content[0].text);
  assert.equal(result.state,'completed');assert.equal(result.message.parts[0].text,'done');
});
