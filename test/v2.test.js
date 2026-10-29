import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from '../src/client.js';

async function fixture(t, handler) {
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    res.setHeader('content-type','application/json');
    await handler(new URL(req.url,'http://localhost'),req,res,raw?JSON.parse(raw):undefined);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return connect({url:`http://127.0.0.1:${server.address().port}`});
}
function base(url,res) {
  if(url.pathname==='/global/health'){res.setHeader('content-type','text/html');res.end('<html>UI</html>');return true;}
  if(url.pathname==='/api/info'){res.end('{"version":"2.2.0","pid":1,"urls":[]}');return true;}
  return false;
}
test('detect v2, preserve opaque cursors and normalize discovery',async t=>{
  const c=await fixture(t,(url,req,res)=>{
    if(base(url,res))return;
    if(url.pathname==='/api/project')return res.end('[{"id":"prj_1","canonical":"/work"}]');
    if(url.pathname==='/api/session'){assert.equal(url.searchParams.get('cursor'),'opaque-next');return res.end('{"data":[{"id":"ses_1"}],"cursor":{"next":"next2","previous":null}}');}
    res.statusCode=404;res.end('{}');
  });
  assert.equal((await c.health()).api,'v2');assert.equal((await c.projects())[0].worktree,'/work');
  assert.equal((await c.sessions({allProjects:true,cursor:'opaque-next'})).cursor.next,'next2');
});
test('v2 delegation selects model and location before durably admitting prompt',async t=>{
  const calls=[];
  const c=await fixture(t,(url,req,res,body)=>{
    if(base(url,res))return;
    calls.push([url.pathname,body]);
    if(url.pathname==='/api/session')return res.end('{"data":{"id":"ses_new"}}');
    if(url.pathname.endsWith('/prompt'))return res.end(JSON.stringify({data:{id:body.id}}));
    res.statusCode=404;res.end('{}');
  });
  const result=await c.delegate({directory:'/work',model:{providerID:'provider',modelID:'model'},prompt:'hello'});
  assert.deepEqual(calls[0][1].location,{directory:'/work'});
  assert.deepEqual(calls[0][1].model,{providerID:'provider',id:'model'});
  assert.equal(calls[1][1].text,'hello');assert.equal(result.messageID,calls[1][1].id);
});
test('v2 wait ignores historic idle until admitted prompt and later idle appear',async t=>{
  let reads=0;
  const c=await fixture(t,(url,req,res)=>{
    if(base(url,res))return;
    if(url.pathname.endsWith('/message')){
      reads++;
      const data=reads<3?[{id:'msg_old',type:'idle',outcome:'succeeded'}]:[{id:'msg_idle',type:'idle',outcome:'succeeded'},{id:'msg_reply',type:'assistant',content:[{type:'text',text:'done'}]},{id:'msg_new',type:'user',text:'task'}];
      return res.end(JSON.stringify({data,cursor:{next:null}}));
    }
    if(url.pathname==='/api/session/active')return res.end('{"data":{}}');
    if(url.pathname==='/api/form'||url.pathname==='/api/permission/request')return res.end('{"data":[]}');
    res.statusCode=404;res.end('{}');
  });
  const result=await c.wait({sessionID:'ses_1',directory:'/work',messageID:'msg_new',timeoutMs:1000,pollMs:5});
  assert.ok(reads>=3);assert.equal(result.state,'completed');assert.equal(result.message.parts[0].text,'done');
});
test('v2 replies use session-owned permission and form contracts',async t=>{
  const calls=[];
  const c=await fixture(t,(url,req,res,body)=>{
    if(base(url,res))return;
    calls.push({path:url.pathname,method:req.method,body});res.statusCode=204;res.end();
  });
  await assert.rejects(c.permissionReply({requestID:'per_1',reply:'once'}),/sessionID/);
  await c.permissionReply({sessionID:'ses_1',requestID:'per_1',reply:'once'});
  await c.questionReply({sessionID:'ses_1',requestID:'form_1',answer:{field:['label']}});
  await c.questionReject({sessionID:'ses_1',requestID:'form_1'});
  assert.deepEqual(calls,[
    {path:'/api/session/ses_1/permission/per_1/reply',method:'POST',body:{decision:'once'}},
    {path:'/api/session/ses_1/form/form_1/reply',method:'POST',body:{answer:{field:['label']}}},
    {path:'/api/session/ses_1/form/form_1',method:'DELETE',body:undefined}
  ]);
});
test('v2 wait follows message cursors and returns interrupted turn outcome',async t=>{
  const c=await fixture(t,(url,req,res)=>{
    if(base(url,res))return;
    if(url.pathname==='/api/session/active')return res.end('{"data":{}}');
    if(url.pathname==='/api/form'||url.pathname==='/api/permission/request')return res.end('{"data":[]}');
    if(url.pathname.endsWith('/message')) {
      if(!url.searchParams.has('cursor'))return res.end('{"data":[{"id":"msg_idle","type":"idle","outcome":"interrupted"}],"cursor":{"next":"page2"}}');
      assert.equal(url.searchParams.get('cursor'),'page2');assert.equal(url.searchParams.has('order'),false);
      return res.end('{"data":[{"id":"msg_target","type":"user","text":"hello"}],"cursor":{"next":null}}');
    }
    res.statusCode=404;res.end('{}');
  });
  assert.equal((await c.wait({sessionID:'ses_1',directory:'/work',messageID:'msg_target',timeoutMs:1000})).state,'interrupted');
});
