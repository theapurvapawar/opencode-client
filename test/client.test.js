import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { OpenCodeClient } from '../src/client.js';

async function fixture(t, handler) {
  const server = createServer(async (req,res) => {
    let body=''; for await (const chunk of req) body+=chunk;
    res.setHeader('content-type','application/json');
    await handler(req,res,body ? JSON.parse(body):undefined);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return new OpenCodeClient({url:`http://127.0.0.1:${server.address().port}/api`,timeoutMs:1000});
}
test('request preserves prefix, directory encoding and basic authentication', async t=>{
  const c=await fixture(t,(req,res)=>{
    assert.equal(req.url,'/api/session?directory=%2Fwork%2Fa+b');
    assert.equal(req.headers.authorization,'Basic '+Buffer.from('opencode:secret').toString('base64'));
    res.end('[]');
  });
  c.password='secret';
  assert.deepEqual(await c.request('GET','/session',{directory:'/work/a b'}),[]);
});
test('HTML frontend is a diagnostic error, never healthy', async t=>{
  const c=await fixture(t,(_,res)=>{res.setHeader('content-type','text/html');res.end('<html>UI</html>');});
  await assert.rejects(c.health(),/JSON|API/);
});
test('delegate returns recoverable session on ambiguous prompt failure; no retry', async t=>{
  let sends=0;
  const c=await fixture(t,(req,res)=>{
    if(req.url.startsWith('/api/session?')) return res.end('{"id":"ses_new"}');
    sends++;res.statusCode=500;res.end('{"error":"failed"}');
  });
  await assert.rejects(c.delegate({directory:'/work',prompt:'hello'}),e=>e.sessionID==='ses_new' && e.message.includes('ses_new'));
  assert.equal(sends,1);
});
test('wait does not call idle before the expected message finishes', async t=>{
  let reads=0;
  const c=await fixture(t,(req,res)=>{
    if(req.url.includes('/message')) { reads++; return res.end(JSON.stringify(reads<3?[]:[{info:{id:'msg_reply',role:'assistant',parentID:'msg_expected',time:{completed:1},finish:'stop'},parts:[]} ])); }
    if(req.url.includes('/status')) return res.end('{}');
    if(req.url.includes('/permission')||req.url.includes('/question')) return res.end('[]');
    res.end('{"id":"ses_test"}');
  });
  const result=await c.wait({sessionID:'ses_test',directory:'/work',messageID:'msg_expected',timeoutMs:1000,pollMs:5});
  assert.equal(result.state,'completed');assert.ok(reads>=3);
});
test('wait surfaces permissions without answering them', async t=>{
  const c=await fixture(t,(req,res)=>{
    assert.equal(req.method,'GET');
    if(req.url.includes('/permission')) return res.end('[{"id":"per_1","sessionID":"ses_test"}]');
    if(req.url.includes('/message')||req.url.includes('/question')) return res.end('[]');
    res.end('{}');
  });
  assert.equal((await c.wait({sessionID:'ses_test',directory:'/work',timeoutMs:100})).state,'blocked');
});
test('redirect aborts before posting new prompt', async t=>{
  const calls=[];
  const c=await fixture(t,(req,res,body)=>{calls.push(req.url);if(req.url.includes('/abort'))res.end('true');else {assert.notEqual(body.messageID,'msg_old');res.statusCode=204;res.end();}});
  await c.redirect({directory:'/work',sessionID:'ses_1',messageID:'msg_old',prompt:'new instructions'});
  assert.match(calls[0],/abort/);assert.match(calls[1],/prompt_async/);
});
test('reject credentials in URLs',()=>assert.throws(()=>new OpenCodeClient({url:'http://user:secret@localhost:4096'}),/credentials/));
test('wait without correlation reports idle rather than historical success', async t=>{
  const c=await fixture(t,(req,res)=>{
    if(req.url.includes('/message'))return res.end('[{"info":{"role":"assistant","parentID":"msg_old","time":{"completed":1},"finish":"stop"},"parts":[]}]');
    if(req.url.includes('/permission')||req.url.includes('/question'))return res.end('[]');
    res.end('{}');
  });
  assert.equal((await c.wait({sessionID:'ses_1',directory:'/work'})).state,'idle');
});
