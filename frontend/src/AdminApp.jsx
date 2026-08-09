import { useCallback, useEffect, useMemo, useState } from 'react';
import { request, formatDateTime } from './api';
import { Icon } from './Icons';

const NAV = [
  ['overview', 'Overview', 'overview'], ['schedules', 'Schedules', 'schedules'], ['bookings', 'Bookings', 'bookings'],
  ['exceptions', 'Exceptions', 'exceptions'], ['audit', 'Audit', 'audit'], ['settings', 'Settings', 'settings']
];
const DEFAULT_AVAILABILITY = { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']], 4: [['09:00', '17:00']], 5: [['09:00', '17:00']] };

function OperatorLogin({ onLogin, error }) {
  const [value, setValue] = useState('');
  return <main className="login-page"><form className="login-panel" onSubmit={(event) => { event.preventDefault(); onLogin(value); }}>
    <div className="brand"><Icon name="calendar" size={26}/><strong>Chronological Booking</strong></div>
    <h1>Operator sign in</h1><p>Enter the operator token configured on this server. It stays in this browser tab only.</p>
    <label>Operator token<input type="password" autoComplete="current-password" value={value} onChange={(event) => setValue(event.target.value)} required minLength="24" /></label>
    {error ? <div className="alert error" role="alert">{error}</div> : null}
    <button className="primary" type="submit">Open dashboard</button>
  </form></main>;
}

function StatusDot({ connected }) { return <span className={`status-dot ${connected ? 'ok' : 'warn'}`} aria-hidden="true"/>; }

function ScheduleForm({ token, onCreated }) {
  const [form, setForm] = useState({ name: '', timezone: 'Europe/Amsterdam', calendarId: 'primary', location: '', durations: '30,60', start: '09:00', end: '17:00' });
  const [message, setMessage] = useState('');
  const submit = async (event) => {
    event.preventDefault(); setMessage('');
    try {
      const weeklyAvailability = Object.fromEntries([1,2,3,4,5].map((day) => [day, [[form.start, form.end]]]));
      const payload = { ...form, durations: form.durations.split(',').map((value) => Number(value.trim())), weeklyAvailability };
      const result = await request('/api/admin/schedules', { method: 'POST', body: JSON.stringify(payload) }, token);
      setMessage('Draft schedule created. Connect Google and activate it before sharing.');
      setForm((current) => ({ ...current, name: '' })); onCreated(result.schedule);
    } catch (error) { setMessage(error.message); }
  };
  return <form className="schedule-form" onSubmit={submit}><div className="section-heading"><div><h2>Create schedule</h2><p>Creates a draft; no Google Calendar change happens yet.</p></div></div>
    <div className="form-grid"><label>Name<input value={form.name} onChange={(e) => setForm({...form, name:e.target.value})} required /></label>
      <label>Time zone<input value={form.timezone} onChange={(e) => setForm({...form, timezone:e.target.value})} required /></label>
      <label>Google calendar ID<input value={form.calendarId} onChange={(e) => setForm({...form, calendarId:e.target.value})} required /></label>
      <label>Location<input value={form.location} onChange={(e) => setForm({...form, location:e.target.value})} /></label>
      <label>Durations (minutes)<input value={form.durations} onChange={(e) => setForm({...form, durations:e.target.value})} required /></label>
      <label>Weekday start<input type="time" value={form.start} onChange={(e) => setForm({...form, start:e.target.value})} required /></label>
      <label>Weekday end<input type="time" value={form.end} onChange={(e) => setForm({...form, end:e.target.value})} required /></label></div>
    {message ? <div className="alert" role="status">{message}</div> : null}<button className="primary" type="submit">Create draft schedule</button></form>;
}

function AvailabilityTable({ schedules }) {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  return <section><div className="section-heading"><div><h2>Weekly availability</h2><p>Policy windows; Google conflicts are applied live on public pages.</p></div></div>
    <div className="availability-table"><div className="availability-row header"><span>Schedule</span>{days.map((day) => <span key={day}>{day}</span>)}</div>
      {schedules.length ? schedules.slice(0,4).map((schedule) => <div className="availability-row" key={schedule.id}><strong>{schedule.name}<small>{schedule.timezone}</small></strong>{days.map((_, index) => <span key={index}>{(schedule.weeklyAvailability?.[index+1] || []).map((window) => window.join('–')).join(', ') || '—'}</span>)}</div>) : <div className="empty">Create a schedule to define availability.</div>}</div></section>;
}

function ScheduleTable({ schedules, token, reload }) {
  const [message,setMessage]=useState('');
  const activate = async (id, status) => { setMessage(''); try { await request(`/api/admin/schedules/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, token); reload(); } catch(error) { setMessage(error.message); } };
  const copy = async (slug) => { setMessage(''); try { await navigator.clipboard.writeText(`${window.location.origin}/book/${slug}`); setMessage('Booking link copied.'); } catch { setMessage('The browser blocked clipboard access. Copy the booking-page address manually.'); } };
  return <section><div className="section-heading"><h2>Schedules</h2></div>{message?<div className="alert" role="status">{message}</div>:null}<div className="table-wrap"><table><thead><tr><th>Name</th><th>Time zone</th><th>Durations</th><th>Status</th><th>Share link</th><th>Action</th></tr></thead><tbody>
    {schedules.map((schedule) => <tr key={schedule.id}><td><strong>{schedule.name}</strong><small>{schedule.location || 'No location'}</small></td><td>{schedule.timezone}</td><td>{schedule.durations.join(', ')} min</td><td><span className={`state ${schedule.status}`}>{schedule.status}</span></td><td><button className="text-button" onClick={() => copy(schedule.slug)}><Icon name="copy" size={16}/> Copy link</button></td><td>{schedule.status === 'draft' || schedule.status === 'paused' ? <button className="secondary" onClick={() => activate(schedule.id,'active')}>Activate</button> : schedule.status === 'active' ? <button className="secondary" onClick={() => activate(schedule.id,'paused')}>Pause</button> : '—'}</td></tr>)}
    {!schedules.length ? <tr><td colSpan="6" className="empty">No schedules yet.</td></tr> : null}</tbody></table></div></section>;
}

function BookingTable({ bookings }) { return <section><div className="section-heading"><h2>Bookings</h2></div><div className="table-wrap"><table><thead><tr><th>Date & time</th><th>Requester</th><th>Schedule</th><th>Provider</th><th>Status</th></tr></thead><tbody>
  {bookings.map((booking) => <tr key={booking.id}><td>{formatDateTime(booking.start_at, 'en', booking.schedule_timezone)}</td><td><strong>{booking.requester_name}</strong><small>{booking.requester_email}</small></td><td>{booking.schedule_name}</td><td>{booking.provider_status}</td><td><span className={`state ${booking.status}`}>{booking.status}</span></td></tr>)}
  {!bookings.length ? <tr><td colSpan="5" className="empty">No bookings yet.</td></tr> : null}</tbody></table></div></section>; }

function Exceptions({ status, bookings }) {
  const items = [];
  if (!status?.google?.connected) items.push({ title: 'Google Calendar unavailable', detail: status?.google?.status === 'not_configured' ? 'OAuth credentials are not configured on the server.' : 'The operator must connect or renew Google Calendar.' });
  if (status?.emergencyStop) items.push({ title: 'Booking emergency stop active', detail: 'Public slot discovery, booking, and rescheduling are paused; cancellation remains available.' });
  bookings.filter((item) => item.status === 'failed' || item.error_code).forEach((item) => items.push({ title: `Booking ${item.id.slice(0,8)} needs review`, detail: item.error_code || item.provider_status }));
  return <div className="exceptions"><h2>Needs attention</h2>{items.map((item, index) => <article key={index}><Icon name="exceptions"/><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}{!items.length ? <div className="healthy"><Icon name="check"/> No operational exceptions.</div> : null}</div>;
}

function Settings({ token, status, reload }) {
  const [deleteText, setDeleteText] = useState(''); const [ack, setAck] = useState(false); const [message, setMessage] = useState('');
  const connect = async () => { try { const result = await request('/api/admin/google/start', { method:'POST' }, token); window.location.assign(result.authorizationUrl); } catch(error){ setMessage(error.message); } };
  const disconnect = async () => { if(!window.confirm('Disconnect Google Calendar? Active public schedules will stop working until you reconnect.'))return; try { await request('/api/admin/google/disconnect',{method:'POST'},token); setMessage('Google Calendar disconnected.'); reload(); } catch(error){setMessage(error.message);} };
  const toggleStop = async () => { try { await request('/api/admin/emergency-stop', { method:'POST', body:JSON.stringify({enabled:!status.emergencyStop}) }, token); reload(); } catch(error){setMessage(error.message);} };
  const reconcile = async () => { try { const result=await request('/api/admin/reconcile',{method:'POST'},token); setMessage(`Reconciliation checked ${result.checked}: ${result.confirmed} confirmed, ${result.released} safely released, ${result.unresolved} still unresolved.`); reload(); } catch(error){setMessage(error.message);} };
  const exportData = async () => { try { const data = await request('/api/admin/export', {}, token); const link=document.createElement('a'); link.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); link.download='chronological-booking-export.json'; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(()=>URL.revokeObjectURL(link.href),1000); setMessage('Complete export downloaded.'); } catch(error){setMessage(error.message);} };
  const deleteData = async () => { try { const result=await request('/api/admin/data',{method:'DELETE',body:JSON.stringify({confirmation:deleteText,acknowledgeGoogleEventsRemain:ack})},token); setMessage(result.externalGoogleEventsDeleted ? 'Data deleted.' : 'Local data deleted. Existing Google events were intentionally preserved.'); reload(); } catch(error){setMessage(error.message);} };
  return <div className="settings-grid"><section><h2>Google Calendar</h2><p>Connection status: <strong>{status.google.status}</strong></p><button className="primary" onClick={connect}>{status.google.connected ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}</button>{status.google.connected?<button className="danger" onClick={disconnect}>Disconnect Google Calendar</button>:null}</section>
    <section><h2>Emergency controls</h2><p>Stops new slot discovery and bookings. Existing Google events are not changed.</p><button className={status.emergencyStop?'primary':'danger'} onClick={toggleStop}>{status.emergencyStop?'Resume bookings':'Stop new bookings'}</button></section>
    <section><h2>Provider reconciliation</h2><p>Checks old uncertain reservations against Google without creating or deleting events.</p><button className="secondary" onClick={reconcile}>Reconcile uncertain bookings</button></section>
    <section><h2>Export</h2><p>Download schedules, bookings, and audit history as JSON.</p><button className="secondary" onClick={exportData}>Export local data</button></section>
    <section className="danger-zone"><h2>Delete local data</h2><p>This does not delete existing Google events. Disconnect Google first so its access token can be revoked before the local copy is removed.</p><label>Type DELETE LOCAL DATA<input value={deleteText} onChange={(e)=>setDeleteText(e.target.value)} /></label><label className="checkbox"><input type="checkbox" checked={ack} onChange={(e)=>setAck(e.target.checked)} /> I understand Google events remain.</label><button className="danger" disabled={status.google.connected||deleteText!=='DELETE LOCAL DATA'||!ack} onClick={deleteData}>Delete local data</button></section>{message?<div className="alert" role="status">{message}</div>:null}</div>;
}

export function AdminApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem('operatorToken') || ''); const [section,setSection]=useState('overview'); const [data,setData]=useState(null); const [error,setError]=useState('');
  const load = useCallback(async (authToken=token) => { if(!authToken)return; try { const [status,schedules,bookings,audit]=await Promise.all([request('/api/admin/status',{},authToken),request('/api/admin/schedules',{},authToken),request('/api/admin/bookings',{},authToken),request('/api/admin/audit',{},authToken)]); setData({status,schedules:schedules.schedules,bookings:bookings.bookings,audit:audit.audit}); setError(''); } catch(err){ setError(err.message); if(err.status===401){sessionStorage.removeItem('operatorToken');setToken('');} } },[token]);
  useEffect(()=>{load();},[load]);
  const login=(value)=>{sessionStorage.setItem('operatorToken',value);setToken(value);};
  const logout=()=>{sessionStorage.removeItem('operatorToken');setToken('');setData(null);setError('');};
  const exceptions=useMemo(()=>data?.bookings.filter((item)=>item.status==='failed'||item.error_code)||[],[data]);
  if(!token)return <OperatorLogin onLogin={login} error={error}/>;
  if(!data)return <main className="login-page"><div className="login-panel"><div className="brand"><Icon name="calendar" size={26}/><strong>Chronological Booking</strong></div><p>Loading the operator dashboard...</p></div></main>;
  const main = section==='overview'?<><AvailabilityTable schedules={data.schedules}/><ScheduleTable schedules={data.schedules} token={token} reload={load}/><BookingTable bookings={data.bookings.slice(0,8)}/></>:section==='schedules'?<><ScheduleForm token={token} onCreated={()=>load()}/><ScheduleTable schedules={data.schedules} token={token} reload={load}/></>:section==='bookings'?<BookingTable bookings={data.bookings}/>:section==='exceptions'?<Exceptions status={data.status} bookings={data.bookings}/>:section==='audit'?<section><div className="section-heading"><h2>Audit history</h2></div><div className="audit-list">{data.audit.map((item)=><article key={item.id}><time>{formatDateTime(item.created_at)}</time><strong>{item.action}</strong><span>{item.entity_type} {item.entity_id?.slice(0,8)||''}</span></article>)}</div></section>:<Settings token={token} status={data.status} reload={load}/>;
  return <div className="app-shell"><header><div className="brand"><Icon name="calendar" size={25}/><strong>Chronological Booking</strong></div><div className="header-actions"><span><StatusDot connected={data.status.google.connected}/>{data.status.google.connected?'Google Calendar connected':`Google: ${data.status.google.status}`}</span><button className="secondary" onClick={()=>setSection('settings')}>{data.status.google.connected?'Manage connection':'Connect Google Calendar'}</button><button className="text-button" onClick={logout}>Sign out</button></div></header>
    <aside><nav>{NAV.map(([id,label,icon])=><button key={id} className={section===id?'active':''} onClick={()=>setSection(id)}><Icon name={icon}/>{label}{id==='exceptions'&&exceptions.length?<span className="count">{exceptions.length}</span>:null}</button>)}</nav><button className="primary create" onClick={()=>setSection('schedules')}>Create schedule</button></aside>
    <main className="dashboard"><div className="page-heading"><div><h1>{NAV.find(([id])=>id===section)?.[1]}</h1><p>{section==='overview'?'Live operational state; no calendar changes happen without confirmed Google authorization.':'Manage this area with audited actions.'}</p></div></div>{error?<div className="alert error">{error}</div>:null}{main}</main>
    {section==='overview'?<aside className="exception-rail"><Exceptions status={data.status} bookings={data.bookings}/></aside>:null}</div>;
}
