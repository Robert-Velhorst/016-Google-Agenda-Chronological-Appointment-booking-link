import { useMemo } from 'react';
import { Icon } from './Icons';

const WEEKDAYS = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  nl: ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']
};

function parts(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return { year, month, day };
}

function dateKey(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function addDays(value, days) {
  const { year, month, day } = parts(value);
  return dateKey(year, month, day + days);
}

export function dateInTimeZone(timeZone, offset = 0) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const values = Object.fromEntries(formatter.formatToParts(new Date()).map((item) => [item.type, item.value]));
  return addDays(`${values.year}-${values.month}-${values.day}`, offset);
}

export function CalendarPicker({ value, onChange, locale, min, max, availableWeekdays }) {
  const { year, month } = parts(value);
  const days = useMemo(() => {
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const leading = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    return [...Array(leading).fill(null), ...Array.from({ length: count }, (_, index) => dateKey(year, month, index + 1))];
  }, [year, month]);
  const monthLabel = new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  const moveMonth = (amount) => {
    const next = dateKey(year, month + amount, 1);
    if (next > max) return onChange(max);
    if (dateKey(year, month + amount + 1, 0) < min) return onChange(min);
    onChange(next < min ? min : next);
  };
  return <div className="month-calendar" aria-label={locale === 'nl' ? 'Kies een datum' : 'Choose a date'}>
    <div className="month-header">
      <button type="button" className="icon-button" onClick={() => moveMonth(-1)} aria-label={locale === 'nl' ? 'Vorige maand' : 'Previous month'} disabled={dateKey(year, month, 1) <= min}><Icon name="chevronLeft" size={18}/></button>
      <strong>{monthLabel}</strong>
      <button type="button" className="icon-button" onClick={() => moveMonth(1)} aria-label={locale === 'nl' ? 'Volgende maand' : 'Next month'} disabled={dateKey(year, month + 1, 1) > max}><Icon name="chevronRight" size={18}/></button>
    </div>
    <div className="calendar-grid weekday-row">{WEEKDAYS[locale].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid day-grid">{days.map((item, index) => {
      if (!item) return <span key={`blank-${index}`} aria-hidden="true"/>;
      const dayOfWeek = ((new Date(`${item}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
      const disabled = item < min || item > max || (availableWeekdays?.length && !availableWeekdays.includes(dayOfWeek));
      return <button type="button" key={item} disabled={disabled} className={item === value ? 'selected' : ''} aria-pressed={item === value} onClick={() => onChange(item)}>{Number(item.slice(-2))}</button>;
    })}</div>
  </div>;
}
