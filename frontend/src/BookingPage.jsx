import { useEffect, useMemo, useRef, useState } from 'react';
import { request, formatDateTime } from './api';
import { addDays, CalendarPicker, dateInTimeZone } from './CalendarPicker';
import { Icon } from './Icons';

const COPY = {
  en: {
    title: 'Book an appointment', duration: 'Choose duration', durationCaption: 'Service', durationHelp: 'Select how much time you need.', changeLater: 'You can review and change this later if needed.',
    time: 'Choose a time', timeCaption: 'Date & time', timeHelp: 'All times are shown in the schedule time zone.', details: 'Your details', detailsCaption: 'Review & confirm', detailsHelp: 'Please enter your information and review your booking.',
    next: 'Next', confirm: 'Confirm booking', checking: 'Checking availability…', recheck: 'Availability is checked again when you confirm.', retry: 'You can safely retry this exact attempt.', reviewError: 'Review your selection before trying again.',
    name: 'Full name', email: 'Email address', manage: 'Manage booking', reschedule: 'Reschedule', cancel: 'Cancel', reminder: 'Google Calendar sends the configured reminders.', noSlots: 'No available times for this date.', loadingSlots: 'Checking available times...', success: 'Your appointment is confirmed.',
    summary: 'Booking summary', durationLabel: 'Duration', dateTime: 'Date & time', timezone: 'Time zone', reminderLabel: 'Reminder', chooseTime: 'Choose a time', consent: 'I have reviewed the details and consent to creating this Google Calendar appointment.',
    privateToken: 'Private token required', manageHelp: 'Use the private link from your booking confirmation to reschedule or cancel.', another: 'Book another appointment', loading: 'Loading booking…', providerSuccess: 'Google Calendar has been updated and reminders are handled by Google.',
    schedule: 'Schedule', status: 'Status', newDate: 'New date', findTimes: 'Find available times', cancelConfirm: 'Cancel this booking? Google Calendar and the requester will be updated.', manageSafety: 'Availability is checked again before rescheduling. Cancellation is applied to Google Calendar immediately.', minutes: 'minutes', progress: 'Booking progress'
  },
  nl: {
    title: 'Boek een afspraak', duration: 'Kies de duur', durationCaption: 'Dienst', durationHelp: 'Kies hoeveel tijd je nodig hebt.', changeLater: 'Je kunt dit later controleren en zo nodig aanpassen.',
    time: 'Kies een tijd', timeCaption: 'Datum & tijd', timeHelp: 'Alle tijden worden in de tijdzone van de planning weergegeven.', details: 'Jouw gegevens', detailsCaption: 'Controleer & bevestig', detailsHelp: 'Vul je gegevens in en controleer je afspraak.',
    next: 'Volgende', confirm: 'Afspraak bevestigen', checking: 'Beschikbaarheid controleren…', recheck: 'De beschikbaarheid wordt opnieuw gecontroleerd wanneer je bevestigt.', retry: 'Je kunt deze exacte poging veilig opnieuw uitvoeren.', reviewError: 'Controleer je keuze voordat je het opnieuw probeert.',
    name: 'Volledige naam', email: 'E-mailadres', manage: 'Afspraak beheren', reschedule: 'Verplaatsen', cancel: 'Annuleren', reminder: 'Google Agenda verstuurt de ingestelde herinneringen.', noSlots: 'Geen beschikbare tijden op deze datum.', loadingSlots: 'Beschikbare tijden controleren...', success: 'Je afspraak is bevestigd.',
    summary: 'Afspraakoverzicht', durationLabel: 'Duur', dateTime: 'Datum & tijd', timezone: 'Tijdzone', reminderLabel: 'Herinnering', chooseTime: 'Kies een tijd', consent: 'Ik heb de gegevens gecontroleerd en geef toestemming om deze Google Agenda-afspraak te maken.',
    privateToken: 'Privélink vereist', manageHelp: 'Gebruik de privélink uit je bevestiging om te verplaatsen of annuleren.', another: 'Nog een afspraak boeken', loading: 'Afspraak laden…', providerSuccess: 'Google Agenda is bijgewerkt en verzorgt de herinneringen.',
    schedule: 'Planning', status: 'Status', newDate: 'Nieuwe datum', findTimes: 'Beschikbare tijden zoeken', cancelConfirm: 'Deze afspraak annuleren? Google Agenda en de aanvrager worden bijgewerkt.', manageSafety: 'De beschikbaarheid wordt opnieuw gecontroleerd voor verplaatsen. Annuleren wordt direct in Google Agenda toegepast.', minutes: 'minuten', progress: 'Voortgang van afspraak'
  }
};

function ErrorMessage({ error, copy }) {
  return error ? <div className="alert error" role="alert"><strong>{error.message}</strong><span>{error.retryable ? ` ${copy.retry}` : ` ${copy.reviewError}`}</span></div> : null;
}

function StepProgress({ active, copy }) {
  const steps = [[copy.duration, copy.durationCaption], [copy.time, copy.timeCaption], [copy.details, copy.detailsCaption]];
  return <ol className="booking-progress" aria-label={copy.progress}>{steps.map(([title, caption], index) => <li key={title} className={active === index + 1 ? 'active' : active > index + 1 ? 'complete' : ''} aria-current={active === index + 1 ? 'step' : undefined}><span>{index + 1}</span><div><strong>{title}</strong><small>{caption}</small></div></li>)}</ol>;
}

function ManageBooking({ bookingId, token, locale, onExit }) {
  const copy = COPY[locale];
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);
  const [date, setDate] = useState(dateInTimeZone('Europe/Amsterdam', 1));
  const [slots, setSlots] = useState([]);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    request(`/api/public/bookings/${bookingId}/manage`, { method: 'POST', body: JSON.stringify({ token }), signal: controller.signal })
      .then((result) => { setBooking(result.booking); setDate(dateInTimeZone(result.booking.schedule.timezone, 1)); })
      .catch((nextError) => { if (nextError.name !== 'AbortError') setError(nextError); });
    return () => controller.abort();
  }, [bookingId, token]);
  const duration = booking ? Math.round((new Date(booking.end) - new Date(booking.start)) / 60000) : 0;
  const findTimes = async () => { setWorking(true); setError(null); setSelected(null); try { const result = await request(`/api/public/schedules/${encodeURIComponent(booking.schedule.slug)}/slots?duration=${duration}&from=${date}&to=${date}`); setSlots(result.slots); } catch (nextError) { setError(nextError); } finally { setWorking(false); } };
  const reschedule = async () => { if (!selected) return; setWorking(true); setError(null); try { const result = await request(`/api/public/bookings/${bookingId}/reschedule`, { method: 'POST', body: JSON.stringify({ token, start: selected.start }) }); setBooking(result.booking); setSlots([]); setSelected(null); } catch (nextError) { setError(nextError); } finally { setWorking(false); } };
  const cancel = async () => { if (!window.confirm(copy.cancelConfirm)) return; setWorking(true); setError(null); try { const result = await request(`/api/public/bookings/${bookingId}/cancel`, { method: 'POST', body: JSON.stringify({ token }) }); setBooking(result.booking); } catch (nextError) { setError(nextError); } finally { setWorking(false); } };
  if (!booking) return <main className="booking-shell"><ErrorMessage error={error} copy={copy}/><p>{copy.loading}</p></main>;
  const minimumDate=dateInTimeZone(booking.schedule.timezone);
  const maximumDate=addDays(minimumDate,booking.schedule.maxAdvanceDays||60);
  return <main className="booking-shell manage"><div className="booking-top"><div className="brand"><Icon name="calendar"/><strong>Chronological Booking</strong></div><button className="text-button" onClick={onExit}>{copy.another}</button></div><section className="manage-panel"><h1>{copy.manage}</h1><dl><div><dt>{copy.schedule}</dt><dd>{booking.schedule.name}</dd></div><div><dt>{copy.dateTime}</dt><dd>{formatDateTime(booking.start, locale, booking.schedule.timezone)}</dd></div><div><dt>{copy.status}</dt><dd><span className={`state ${booking.status}`}>{booking.status}</span></dd></div><div><dt>{copy.email}</dt><dd>{booking.requesterEmail}</dd></div></dl><div className="info-note"><Icon name="calendar"/>{copy.manageSafety}</div>{booking.status === 'confirmed' ? <div className="reschedule-box"><label>{copy.newDate}<input type="date" min={minimumDate} max={maximumDate} value={date} onChange={(event) => {setDate(event.target.value);setSlots([]);setSelected(null);}}/></label><button className="secondary" onClick={findTimes} disabled={working}>{copy.findTimes}</button>{slots.length ? <div className="slot-list">{slots.map((item) => <button type="button" className={selected?.start === item.start ? 'selected' : ''} key={item.start} onClick={() => setSelected(item)}>{formatDateTime(item.start, locale, booking.schedule.timezone)}</button>)}</div> : null}<button className="primary" disabled={!selected || working} onClick={reschedule}>{copy.reschedule}</button></div> : null}<ErrorMessage error={error} copy={copy}/><button className="danger" disabled={working || booking.status === 'cancelled'} onClick={cancel}>{copy.cancel}</button></section></main>;
}

export function BookingPage({ slug }) {
  const params = useMemo(() => new URLSearchParams(window.location.hash.replace(/^#/, '')), []);
  const manageId = params.get('manage');
  const manageToken = params.get('token');
  const idempotencyKey = useRef(crypto.randomUUID());
  const [locale, setLocale] = useState('en');
  const [schedule, setSchedule] = useState(null);
  const [duration, setDuration] = useState(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState([]);
  const [slot, setSlot] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotRefresh, setSlotRefresh] = useState(0);
  const [details, setDetails] = useState({ name: '', email: '' });
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  const [mobileStep, setMobileStep] = useState(1);
  const copy = COPY[locale];
  const uncertainAttempt = Boolean(error?.retryable && ['GOOGLE_PROVIDER_ERROR', 'GOOGLE_NETWORK_ERROR'].includes(error.code));

  useEffect(() => {
    if (manageId) return undefined;
    const controller = new AbortController();
    request(`/api/public/schedules/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(({ schedule: next }) => {
        setSchedule(next);
        setDuration(next.durations[0]);
        setDate(dateInTimeZone(next.timezone, 1));
      })
      .catch((nextError) => { if (nextError.name !== 'AbortError') setError(nextError); });
    return () => controller.abort();
  }, [slug, manageId]);

  useEffect(() => {
    if (!duration || !date || manageId) return undefined;
    const controller = new AbortController();
    setSlot(null); setSlots([]); setError(null); setLoadingSlots(true);
    request(`/api/public/schedules/${encodeURIComponent(slug)}/slots?duration=${duration}&from=${date}&to=${date}`, { signal: controller.signal })
      .then((result) => setSlots(result.slots))
      .catch((nextError) => { if (nextError.name !== 'AbortError') setError(nextError); })
      .finally(()=>{if(!controller.signal.aborted)setLoadingSlots(false);});
    return () => controller.abort();
  }, [slug, duration, date, manageId, slotRefresh]);

  if (manageId && manageToken) return <ManageBooking bookingId={manageId} token={manageToken} locale={locale} onExit={() => window.location.assign(`/book/${slug}`)}/>;

  const resetAttempt = () => { if (!working && !uncertainAttempt) idempotencyKey.current = crypto.randomUUID(); };
  const chooseDuration = (value) => { resetAttempt(); setDuration(value); setSlot(null); };
  const chooseDate = (value) => { resetAttempt(); setDate(value); setSlot(null); };
  const chooseSlot = (value) => { resetAttempt(); setSlot(value); };
  const submit = async (event) => {
    event.preventDefault();
    if (!slot || !accepted) return;
    setWorking(true); setError(null);
    try {
      const result = await request(`/api/public/schedules/${encodeURIComponent(slug)}/book`, { method: 'POST', headers: { 'idempotency-key': idempotencyKey.current }, body: JSON.stringify({ ...details, duration, start: slot.start }) });
      setConfirmed(result.booking);
    } catch (nextError) {
      setError(nextError);
      if (nextError.code === 'SLOT_UNAVAILABLE') { setSlot(null); setSlotRefresh((current)=>current+1); idempotencyKey.current = crypto.randomUUID(); setMobileStep(2); }
    } finally { setWorking(false); }
  };

  if (!schedule && !error) return <main className="booking-shell"><p>{copy.loading}</p></main>;
  if (confirmed) return <main className="booking-shell"><div className="booking-top"><div className="brand"><Icon name="calendar"/><strong>Chronological Booking</strong></div></div><section className="success-panel"><div className="success-icon"><Icon name="check" size={30}/></div><h1>{copy.success}</h1><p>{schedule.name} · {formatDateTime(confirmed.start, locale, schedule.timezone)}</p><p>{copy.providerSuccess}</p><a className="primary button-link" href={confirmed.manageUrl}>{copy.manage}</a></section></main>;

  const minDate = schedule ? dateInTimeZone(schedule.timezone) : '';
  const maxDate = schedule ? addDays(minDate, schedule.maxAdvanceDays || 60) : '';
  return <main className="booking-shell"><div className="booking-top"><div className="brand"><Icon name="calendar"/><strong>Chronological Booking</strong></div><div className="language"><Icon name="globe" size={18}/><button type="button" className={locale === 'nl' ? 'active' : ''} onClick={() => setLocale('nl')}>Nederlands</button><span>/</span><button type="button" className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>English</button></div></div><h1>{copy.title}</h1>{schedule ? <p className="booking-intro">{schedule.name}{schedule.location ? ` · ${schedule.location}` : ''} · {schedule.timezone}</p> : null}<StepProgress active={mobileStep} copy={copy}/><ErrorMessage error={error} copy={copy}/>
    {schedule ? <form className="booking-grid" onSubmit={submit} aria-busy={working}><section className="booking-step" data-mobile-hidden={mobileStep !== 1}><div className="step-title"><span>1</span><div><h2>{copy.duration}</h2><p>{copy.durationHelp}</p></div></div><div className="duration-list">{schedule.durations.map((value) => <label className={duration === value ? 'selected' : ''} key={value}><input type="radio" name="duration" checked={duration === value} disabled={uncertainAttempt} onChange={() => chooseDuration(value)}/><strong>{value} {copy.minutes}</strong></label>)}</div><div className="info-note">{copy.changeLater}</div><button type="button" className="primary mobile-next" onClick={() => setMobileStep(2)}>{copy.next}</button></section>
      <section className="booking-step time-step" data-mobile-hidden={mobileStep !== 2}><div className="step-title"><span>2</span><div><h2>{copy.time}</h2><p>{copy.timeHelp}</p></div></div><div className="calendar-and-slots"><CalendarPicker value={date} onChange={chooseDate} locale={locale} min={minDate} max={maxDate} availableWeekdays={schedule.availableWeekdays}/><div className="day-slots"><strong>{new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))}</strong><div className="slot-list" aria-live="polite" aria-busy={loadingSlots}>{slots.map((item) => <button type="button" className={slot?.start === item.start ? 'selected' : ''} key={item.start} disabled={uncertainAttempt} onClick={() => chooseSlot(item)}>{new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: schedule.timezone }).format(new Date(item.start))}{slot?.start === item.start ? <Icon name="check" size={17}/> : null}</button>)}{loadingSlots?<p className="empty">{copy.loadingSlots}</p>:!slots.length&&!error?<p className="empty">{copy.noSlots}</p>:null}</div></div></div><div className="info-note"><Icon name="clock"/>{schedule.timezone}</div><button type="button" className="primary mobile-next" disabled={!slot} onClick={() => setMobileStep(3)}>{copy.next}</button></section>
      <section className="booking-step review" data-mobile-hidden={mobileStep !== 3}><div className="step-title"><span>3</span><div><h2>{copy.details}</h2><p>{copy.detailsHelp}</p></div></div><label>{copy.name}<input value={details.name} disabled={uncertainAttempt} onChange={(event) => { resetAttempt(); setDetails((current) => ({ ...current, name: event.target.value })); }} required minLength="2" maxLength="120" autoComplete="name"/></label><label>{copy.email}<input type="email" value={details.email} disabled={uncertainAttempt} onChange={(event) => { resetAttempt(); setDetails((current) => ({ ...current, email: event.target.value })); }} required maxLength="254" autoComplete="email"/></label><div className="summary"><h3>{copy.summary}</h3><dl><div><dt>{copy.durationLabel}</dt><dd>{duration} {copy.minutes}</dd></div><div><dt>{copy.dateTime}</dt><dd>{slot ? formatDateTime(slot.start, locale, schedule.timezone) : copy.chooseTime}</dd></div><div><dt>{copy.timezone}</dt><dd>{schedule.timezone}</dd></div><div><dt>{copy.reminderLabel}</dt><dd>{copy.reminder}</dd></div></dl></div><div className="info-note strong"><Icon name="calendar"/>{copy.recheck}</div><label className="checkbox"><input type="checkbox" checked={accepted} disabled={uncertainAttempt} onChange={(event) => setAccepted(event.target.checked)} required/> {copy.consent}</label><button className="primary confirm" disabled={!slot || !accepted || working}>{working ? copy.checking : copy.confirm}</button></section></form> : null}
    <section className="manage-strip"><div><h2>{copy.manage}</h2><p>{copy.manageHelp}</p></div><span><Icon name="calendar"/> {copy.privateToken}</span></section></main>;
}
