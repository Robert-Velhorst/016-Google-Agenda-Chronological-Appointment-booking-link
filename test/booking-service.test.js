'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultSchedule, futureDate, testRuntime } = require('./helpers');

test('critical path is idempotent, prevents overlap, reschedules, and cancels', async (t) => {
  const runtime=testRuntime(); t.after(()=>runtime.cleanup());
  const draft=runtime.service.createSchedule(defaultSchedule(),'request-create');
  const active=await runtime.service.setScheduleStatus(draft.id,'active','request-activate');
  const date=futureDate(10); const slots=await runtime.service.slots(active.slug,30,date,date); assert.ok(slots.length>2);
  const first=await runtime.service.book(active.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slots[0].start},'idempotency-key-00000001','request-book');
  const replay=await runtime.service.book(active.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slots[0].start},'idempotency-key-00000001','request-replay');
  assert.equal(first.id,replay.id); assert.equal(runtime.provider.created,1); assert.equal(first.status,'confirmed');
  await assert.rejects(()=>runtime.service.book(active.slug,{name:'Other User',email:'other@example.com',duration:30,start:slots[0].start},'idempotency-key-00000002','request-conflict'),(error)=>error.code==='SLOT_UNAVAILABLE');
  const url=new URL(first.manageUrl); const token=new URLSearchParams(url.hash.slice(1)).get('token');
  const rescheduled=await runtime.service.reschedule(first.id,token,{start:slots[2].start},'request-reschedule'); assert.equal(rescheduled.start,slots[2].start);
  const cancelled=await runtime.service.cancel(first.id,token,'request-cancel'); assert.equal(cancelled.status,'cancelled');
  const repeatedCancel=await runtime.service.cancel(first.id,token,'request-cancel-again'); assert.equal(repeatedCancel.status,'cancelled');
  assert.ok(runtime.service.auditLog().some((entry)=>entry.action==='booking.confirmed'));
});

test('emergency stop fails closed for public slots and bookings', async (t) => {
  const runtime=testRuntime(); t.after(()=>runtime.cleanup()); const draft=runtime.service.createSchedule(defaultSchedule(),'create'); await runtime.service.setScheduleStatus(draft.id,'active','activate'); runtime.service.setEmergencyStop(true,'stop'); const date=futureDate(5);
  await assert.rejects(()=>runtime.service.slots(draft.slug,30,date,date),(error)=>error.code==='BOOKING_PAUSED');
});

test('manage tokens are required and invalid tokens disclose no booking', async (t) => {
  const runtime=testRuntime(); t.after(()=>runtime.cleanup()); const draft=runtime.service.createSchedule(defaultSchedule(),'create'); await runtime.service.setScheduleStatus(draft.id,'active','activate'); const date=futureDate(5); const [slot]=await runtime.service.slots(draft.slug,30,date,date); const booking=await runtime.service.book(draft.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slot.start},'idempotency-key-00000003','book');
  assert.throws(()=>runtime.service.managedBooking(booking.id,'wrong-token'),(error)=>error.code==='BOOKING_NOT_FOUND');
});

test('separate schedules sharing one calendar cannot overlap', async (t) => {
  const runtime=testRuntime(); t.after(()=>runtime.cleanup());
  const first=runtime.service.createSchedule(defaultSchedule(),'create-first');
  const second=runtime.service.createSchedule({...defaultSchedule(),name:'Second booking link'},'create-second');
  await runtime.service.setScheduleStatus(first.id,'active','activate-first');
  await runtime.service.setScheduleStatus(second.id,'active','activate-second');
  const date=futureDate(7);
  const [slot]=await runtime.service.slots(first.slug,30,date,date);
  await runtime.service.book(first.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slot.start},'idempotency-key-calendar-01','book-first');
  await assert.rejects(
    ()=>runtime.service.book(second.slug,{name:'Grace Example',email:'grace@example.com',duration:30,start:slot.start},'idempotency-key-calendar-02','book-second'),
    (error)=>error.code==='SLOT_UNAVAILABLE'
  );
});

test('provider create failure keeps one recoverable reservation', async (t) => {
  const runtime=testRuntime(); t.after(()=>runtime.cleanup());
  const schedule=runtime.service.createSchedule(defaultSchedule(),'create');
  await runtime.service.setScheduleStatus(schedule.id,'active','activate');
  const date=futureDate(8);
  const [slot]=await runtime.service.slots(schedule.slug,30,date,date);
  runtime.provider.failCreate=true;
  await assert.rejects(
    ()=>runtime.service.book(schedule.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slot.start},'idempotency-key-failure-01','book'),
    (error)=>error.code==='GOOGLE_PROVIDER_ERROR'&&error.retryable
  );
  assert.equal(runtime.service.listBookings().length,1);
  assert.equal(runtime.service.listBookings()[0].status,'pending');
  runtime.provider.failCreate=false;
  const recovered=await runtime.service.book(schedule.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slot.start},'idempotency-key-failure-01','retry');
  assert.equal(recovered.status,'confirmed');
  assert.equal(runtime.service.listBookings().length,1);
});

test('definitive provider conflicts release the local reservation', async (t) => {
  const runtime=testRuntime(); t.after(()=>runtime.cleanup());
  const schedule=runtime.service.createSchedule(defaultSchedule(),'create');
  await runtime.service.setScheduleStatus(schedule.id,'active','activate');
  const date=futureDate(8); const [slot]=await runtime.service.slots(schedule.slug,30,date,date);
  runtime.provider.events.set('external-conflict',{id:'external-conflict',start:slot.start,end:slot.end});
  await assert.rejects(
    ()=>runtime.service.book(schedule.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slot.start},'idempotency-key-definitive-01','book'),
    (error)=>error.code==='SLOT_UNAVAILABLE'&&!error.retryable
  );
  assert.equal(runtime.service.listBookings()[0].status,'failed');
});

test('an ambiguous provider create is reconciled without a duplicate event', async (t) => {
  const runtime=testRuntime(); t.after(()=>runtime.cleanup());
  const schedule=runtime.service.createSchedule(defaultSchedule(),'create');
  await runtime.service.setScheduleStatus(schedule.id,'active','activate');
  const date=futureDate(9); const [slot]=await runtime.service.slots(schedule.slug,30,date,date);
  runtime.provider.storeThenFail=true;
  await assert.rejects(
    ()=>runtime.service.book(schedule.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slot.start},'idempotency-key-ambiguous-01','book'),
    (error)=>error.code==='GOOGLE_PROVIDER_ERROR'&&error.retryable
  );
  const recovered=await runtime.service.book(schedule.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slot.start},'idempotency-key-ambiguous-01','retry');
  assert.equal(recovered.status,'confirmed');
  assert.equal(runtime.provider.created,1);
  assert.equal(runtime.provider.events.size,1);
});

test('concurrent requests reserve locally without nested SQLite transactions', async (t) => {
  const runtime=testRuntime(); t.after(()=>runtime.cleanup());
  const schedule=runtime.service.createSchedule(defaultSchedule(),'create');
  await runtime.service.setScheduleStatus(schedule.id,'active','activate');
  const date=futureDate(11); const [slot]=await runtime.service.slots(schedule.slug,30,date,date);
  runtime.provider.createDelayMs=50;
  const attempts=await Promise.allSettled([
    runtime.service.book(schedule.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slot.start},'idempotency-key-concurrent-01','book-one'),
    runtime.service.book(schedule.slug,{name:'Grace Example',email:'grace@example.com',duration:30,start:slot.start},'idempotency-key-concurrent-02','book-two')
  ]);
  assert.equal(attempts.filter((item)=>item.status==='fulfilled').length,1);
  const rejected=attempts.find((item)=>item.status==='rejected');
  assert.equal(rejected.reason.code,'SLOT_UNAVAILABLE');
  assert.equal(runtime.provider.created,1);
});

test('idempotency key reuse with different details is rejected', async (t) => {
  const runtime=testRuntime(); t.after(()=>runtime.cleanup());
  const schedule=runtime.service.createSchedule(defaultSchedule(),'create');
  await runtime.service.setScheduleStatus(schedule.id,'active','activate');
  const date=futureDate(12); const slots=await runtime.service.slots(schedule.slug,30,date,date);
  await runtime.service.book(schedule.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slots[0].start},'idempotency-key-reuse-0001','book');
  await assert.rejects(
    ()=>runtime.service.book(schedule.slug,{name:'Different Person',email:'different@example.com',duration:30,start:slots[1].start},'idempotency-key-reuse-0001','reuse'),
    (error)=>error.code==='IDEMPOTENCY_CONFLICT'
  );
});

test('buffer rules block adjacent concurrent reservations and pending slots stay hidden', async (t) => {
  const runtime=testRuntime(); t.after(()=>runtime.cleanup());
  const schedule=runtime.service.createSchedule({...defaultSchedule(),bufferAfterMinutes:15},'create');
  await runtime.service.setScheduleStatus(schedule.id,'active','activate');
  const date=futureDate(13); const slots=await runtime.service.slots(schedule.slug,30,date,date);
  runtime.provider.createDelayMs=50;
  const attempts=await Promise.allSettled([
    runtime.service.book(schedule.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slots[0].start},'idempotency-key-buffer-0001','book-one'),
    runtime.service.book(schedule.slug,{name:'Grace Example',email:'grace@example.com',duration:30,start:slots[1].start},'idempotency-key-buffer-0002','book-two')
  ]);
  assert.equal(attempts.filter((item)=>item.status==='fulfilled').length,1);
  assert.equal(attempts.find((item)=>item.status==='rejected').reason.code,'SLOT_UNAVAILABLE');
  const expectedQueryStart=new Date(new Date(attempts.find((item)=>item.status==='fulfilled').value.start).getTime()-15*60000).toISOString().replace('.000Z','Z');
  assert.ok(runtime.provider.conflictQueries.some((query)=>query.start===expectedQueryStart));

  const remaining=await runtime.service.slots(schedule.slug,30,date,date);
  assert.ok(!remaining.some((item)=>item.start===slots[0].start||item.start===slots[1].start));
});

test('admin lists and complete exports exclude management and idempotency secrets', async (t) => {
  const runtime=testRuntime(); t.after(()=>runtime.cleanup());
  const schedule=runtime.service.createSchedule(defaultSchedule(),'create');
  await runtime.service.setScheduleStatus(schedule.id,'active','activate');
  const date=futureDate(14); const [slot]=await runtime.service.slots(schedule.slug,30,date,date);
  await runtime.service.book(schedule.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slot.start},'idempotency-key-redaction-01','book');
  for (const record of [runtime.service.listBookings()[0],runtime.service.exportData().bookings[0]]) {
    assert.ok(record.schedule_timezone);
    assert.equal('manage_token_hash' in record,false);
    assert.equal('manage_token_cipher' in record,false);
    assert.equal('idempotency_key' in record,false);
    assert.equal('google_etag' in record,false);
  }
  const insert=runtime.db.prepare(`INSERT INTO bookings(id,schedule_id,idempotency_key,requester_name,requester_email,start_at,end_at,status,provider_status,manage_token_hash,manage_token_cipher,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  runtime.db.exec('BEGIN IMMEDIATE');
  try { for(let index=0;index<500;index+=1)insert.run(`bulk-${index}`,schedule.id,`bulk-key-${index}`,'Bulk User','bulk@example.com','2025-01-01T00:00:00Z','2025-01-01T00:30:00Z','cancelled','cancelled','hash','x.y.z','2025-01-01T00:00:00Z','2025-01-01T00:00:00Z');runtime.db.exec('COMMIT'); } catch(error){runtime.db.exec('ROLLBACK');throw error;}
  assert.equal(runtime.service.listBookings().length,500);
  assert.equal(runtime.service.exportData().bookings.length,501);
});

test('operator reconciliation confirms stored events and releases definitively missing ones', async (t) => {
  const runtime=testRuntime({RECONCILE_MIN_AGE_MS:'0'}); t.after(()=>runtime.cleanup());
  const schedule=runtime.service.createSchedule(defaultSchedule(),'create');
  await runtime.service.setScheduleStatus(schedule.id,'active','activate');
  const date=futureDate(15); const slots=await runtime.service.slots(schedule.slug,30,date,date);
  runtime.provider.storeThenFail=true;
  await assert.rejects(()=>runtime.service.book(schedule.slug,{name:'Ada Example',email:'ada@example.com',duration:30,start:slots[0].start},'idempotency-key-reconcile-01','book-one'));
  runtime.provider.failCreate=true;
  await assert.rejects(()=>runtime.service.book(schedule.slug,{name:'Grace Example',email:'grace@example.com',duration:30,start:slots[2].start},'idempotency-key-reconcile-02','book-two'));
  const result=await runtime.service.reconcilePendingBookings('reconcile');
  assert.deepEqual(result,{checked:2,confirmed:1,released:1,unresolved:0});
  assert.deepEqual(runtime.service.listBookings().map((item)=>item.status).sort(),['confirmed','failed']);
});
