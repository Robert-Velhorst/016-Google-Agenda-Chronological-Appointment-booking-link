'use strict';

const test=require('node:test'); const assert=require('node:assert/strict'); const http=require('node:http'); const {createApp}=require('../src/app'); const {defaultSchedule,testRuntime}=require('./helpers');
test('HTTP API enforces operator auth and emits error envelope',async(t)=>{const runtime=testRuntime();t.after(()=>runtime.cleanup());const server=http.createServer(createApp({config:runtime.config,service:runtime.service,provider:runtime.provider}));await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise((resolve)=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;let response=await fetch(`${base}/api/admin/status`);assert.equal(response.status,401);const denied=await response.json();assert.equal(denied.error.code,'UNAUTHORIZED');response=await fetch(`${base}/api/admin/schedules`,{method:'POST',headers:{authorization:`Bearer ${runtime.config.adminToken}`,'content-type':'application/json'},body:JSON.stringify(defaultSchedule())});assert.equal(response.status,201);assert.match(response.headers.get('content-security-policy'),/default-src/);});

test('HAI feed requires its own token and never exposes management secrets',async(t)=>{
  const token='h'.repeat(40); const runtime=testRuntime({HAI_CONNECTOR_TOKEN:token}); t.after(()=>runtime.cleanup());
  const schedule=runtime.service.createSchedule(defaultSchedule(),'create'); await runtime.service.setScheduleStatus(schedule.id,'active','activate');
  const date=new Date(Date.now()+10*86400000).toISOString().slice(0,10); const [slot]=await runtime.service.slots(schedule.slug,30,date,date);
  await runtime.service.book(schedule.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slot.start},'idempotency-key-hai-000001','book');
  const server=http.createServer(createApp({config:runtime.config,service:runtime.service,provider:runtime.provider})); await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>new Promise((resolve)=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/integrations/hai/feed`)).status,401);
  assert.equal((await fetch(`${base}/api/integrations/hai/feed`,{headers:{authorization:`Bearer ${runtime.config.adminToken}`}})).status,401);
  const response=await fetch(`${base}/api/integrations/hai/feed?limit=1`,{headers:{authorization:`Bearer ${token}`}}); assert.equal(response.status,200);
  const feed=await response.json(); assert.equal(feed.authority,'read_only'); assert.equal(feed.items.length,1); assert.ok(feed.nextCursor);
  const serialized=JSON.stringify(feed); assert.doesNotMatch(serialized,/manageUrl|manage_token|idempotency|oauth/i);
  assert.doesNotMatch(serialized,/Ada Example|ada@example\.com/);
  const next=await (await fetch(`${base}/api/integrations/hai/feed?cursor=${encodeURIComponent(feed.nextCursor)}`,{headers:{authorization:`Bearer ${token}`}})).json(); assert.equal(next.items.length,0);
});

test('malformed paths are rejected as client errors',async(t)=>{
  const runtime=testRuntime();t.after(()=>runtime.cleanup());const server=http.createServer(createApp({config:runtime.config,service:runtime.service,provider:runtime.provider}));await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise((resolve)=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/public/schedules/%E0%A4%A`);
  assert.equal(response.status,400);assert.equal((await response.json()).error.code,'INVALID_PATH');
});

test('local data cannot orphan a connected Google authorization',async(t)=>{
  const runtime=testRuntime();t.after(()=>runtime.cleanup());const server=http.createServer(createApp({config:runtime.config,service:runtime.service,provider:runtime.provider}));await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise((resolve)=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;const options={method:'DELETE',headers:{authorization:`Bearer ${runtime.config.adminToken}`,'content-type':'application/json'},body:JSON.stringify({confirmation:'DELETE LOCAL DATA',acknowledgeGoogleEventsRemain:true})};
  let response=await fetch(`${base}/api/admin/data`,options);assert.equal(response.status,409);assert.equal((await response.json()).error.code,'DISCONNECT_GOOGLE_FIRST');
  runtime.provider.connected=false;response=await fetch(`${base}/api/admin/data`,options);assert.equal(response.status,200);assert.equal((await response.json()).deleted,true);
});
