'use strict';

const { Temporal } = require('@js-temporal/polyfill');
const { AppError } = require('./errors');

function parseSchedule(row) {
  return {
    ...row,
    durations: JSON.parse(row.durations_json),
    weeklyAvailability: JSON.parse(row.weekly_availability_json),
    reminderMinutes: JSON.parse(row.reminder_minutes_json)
  };
}

function validateTimeZone(timeZone) {
  try {
    Temporal.Now.instant().toZonedDateTimeISO(timeZone);
    return timeZone;
  } catch {
    throw new AppError('INVALID_TIMEZONE', 'The selected time zone is not valid.', 422);
  }
}

function validateScheduleInput(input) {
  const name = String(input.name || '').trim();
  if (name.length < 2 || name.length > 120) throw new AppError('INVALID_NAME', 'Schedule name must be 2-120 characters.', 422);
  const timezone = validateTimeZone(String(input.timezone || 'Europe/Amsterdam'));
  const calendarId = String(input.calendarId || 'primary').trim();
  if (!calendarId || calendarId.length > 320) throw new AppError('INVALID_CALENDAR', 'Calendar ID is invalid.', 422);
  const durations = [...new Set((input.durations || []).map(Number))].sort((a, b) => a - b);
  if (!durations.length || durations.some((value) => !Number.isInteger(value) || value < 5 || value > 1440)) {
    throw new AppError('INVALID_DURATIONS', 'Durations must contain whole minutes between 5 and 1440.', 422);
  }
  const availability = input.weeklyAvailability || {};
  const normalizedAvailability = {};
  let windowCount = 0;
  for (let day = 1; day <= 7; day += 1) {
    const windows = availability[day] || availability[String(day)] || [];
    if (!Array.isArray(windows)) throw new AppError('INVALID_AVAILABILITY', 'Weekly availability is invalid.', 422);
    const normalizedWindows = [];
    for (const window of windows) {
      if (!Array.isArray(window) || window.length !== 2 || !/^\d{2}:\d{2}$/.test(window[0]) || !/^\d{2}:\d{2}$/.test(window[1])) {
        throw new AppError('INVALID_AVAILABILITY', 'Availability windows must use HH:MM start/end values.', 422);
      }
      let start;
      let end;
      try {
        start = Temporal.PlainTime.from(window[0]);
        end = Temporal.PlainTime.from(window[1]);
      } catch {
        throw new AppError('INVALID_AVAILABILITY', 'Availability windows contain an invalid time.', 422);
      }
      if (Temporal.PlainTime.compare(start, end) >= 0) throw new AppError('INVALID_AVAILABILITY', 'Availability window end must be after start.', 422);
      normalizedWindows.push([start.toString({ smallestUnit: 'minute' }), end.toString({ smallestUnit: 'minute' })]);
      windowCount += 1;
    }
    normalizedWindows.sort((left, right) => left[0].localeCompare(right[0]));
    for (let index = 1; index < normalizedWindows.length; index += 1) {
      if (normalizedWindows[index][0] < normalizedWindows[index - 1][1]) {
        throw new AppError('INVALID_AVAILABILITY', 'Availability windows on the same day must not overlap.', 422);
      }
    }
    normalizedAvailability[day] = normalizedWindows;
  }
  if (!windowCount) throw new AppError('INVALID_AVAILABILITY', 'At least one availability window is required.', 422);
  const int = (value, fallback, min, max, code) => {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new AppError(code, `${code} is outside the supported range.`, 422);
    return parsed;
  };
  const reminderMinutes = [...new Set((input.reminderMinutes || [1440]).map(Number))].sort((a, b) => b - a);
  if (reminderMinutes.some((value) => !Number.isInteger(value) || value < 0 || value > 40320)) {
    throw new AppError('INVALID_REMINDERS', 'Reminder minutes are invalid.', 422);
  }
  return {
    name,
    timezone,
    calendarId,
    location: String(input.location || '').trim().slice(0, 240),
    durations,
    weeklyAvailability: normalizedAvailability,
    slotIntervalMinutes: int(input.slotIntervalMinutes, 15, 5, 240, 'INVALID_SLOT_INTERVAL'),
    bufferBeforeMinutes: int(input.bufferBeforeMinutes, 0, 0, 1440, 'INVALID_BUFFER'),
    bufferAfterMinutes: int(input.bufferAfterMinutes, 0, 0, 1440, 'INVALID_BUFFER'),
    minNoticeMinutes: int(input.minNoticeMinutes, 120, 0, 525600, 'INVALID_NOTICE'),
    maxAdvanceDays: int(input.maxAdvanceDays, 60, 1, 730, 'INVALID_ADVANCE'),
    reminderMinutes
  };
}

function overlaps(start, end, busyStart, busyEnd) {
  return Temporal.Instant.compare(start, busyEnd) < 0 && Temporal.Instant.compare(end, busyStart) > 0;
}

function generateCandidateSlots(schedule, durationMinutes, fromDate, toDate, busyIntervals = [], now = Temporal.Now.instant()) {
  if (!schedule.durations.includes(durationMinutes)) throw new AppError('INVALID_DURATION', 'That duration is not offered.', 422);
  let from;
  let requestedTo;
  try {
    from = Temporal.PlainDate.from(fromDate);
    requestedTo = Temporal.PlainDate.from(toDate);
  } catch {
    throw new AppError('INVALID_DATE_RANGE', 'Slot dates must be valid ISO calendar dates.', 422);
  }
  const maximumDate = now.toZonedDateTimeISO(schedule.timezone).toPlainDate().add({ days: schedule.max_advance_days });
  const to = Temporal.PlainDate.compare(requestedTo, maximumDate) > 0 ? maximumDate : requestedTo;
  if (Temporal.PlainDate.compare(from, to) > 0) throw new AppError('INVALID_DATE_RANGE', 'The slot date range is invalid.', 422);
  const minimumStart = now.add({ minutes: schedule.min_notice_minutes });
  const busy = busyIntervals.map((interval) => ({
    start: Temporal.Instant.from(interval.start).subtract({ minutes: schedule.buffer_before_minutes }),
    end: Temporal.Instant.from(interval.end).add({ minutes: schedule.buffer_after_minutes })
  }));
  const slots = [];
  for (let date = from; Temporal.PlainDate.compare(date, to) <= 0; date = date.add({ days: 1 })) {
    const windows = schedule.weeklyAvailability[String(date.dayOfWeek)] || schedule.weeklyAvailability[date.dayOfWeek] || [];
    for (const [startText, endText] of windows) {
      let cursor;
      let windowEnd;
      try {
        const startTime = Temporal.PlainTime.from(startText);
        const endTime = Temporal.PlainTime.from(endText);
        const dateFields = { year: date.year, month: date.month, day: date.day, timeZone: schedule.timezone };
        cursor = Temporal.ZonedDateTime.from({ ...dateFields, hour: startTime.hour, minute: startTime.minute }, { disambiguation: 'reject' });
        windowEnd = Temporal.ZonedDateTime.from({ ...dateFields, hour: endTime.hour, minute: endTime.minute }, { disambiguation: 'reject' });
      } catch {
        continue;
      }
      while (Temporal.ZonedDateTime.compare(cursor.add({ minutes: durationMinutes }), windowEnd) <= 0) {
        const start = cursor.toInstant();
        const end = cursor.add({ minutes: durationMinutes }).toInstant();
        if (Temporal.Instant.compare(start, minimumStart) >= 0 && !busy.some((interval) => overlaps(start, end, interval.start, interval.end))) {
          slots.push({ start: start.toString(), end: end.toString(), localStart: cursor.toString(), timezone: schedule.timezone });
        }
        cursor = cursor.add({ minutes: schedule.slot_interval_minutes });
      }
    }
  }
  return slots;
}

function validateRequestedSlot(schedule, durationMinutes, startText) {
  let start;
  try { start = Temporal.Instant.from(startText); }
  catch { throw new AppError('INVALID_START', 'The requested start time must be a valid timestamp.', 422); }
  const zoned = start.toZonedDateTimeISO(schedule.timezone);
  const date = zoned.toPlainDate();
  const slots = generateCandidateSlots(schedule, durationMinutes, date.toString(), date.toString(), [], Temporal.Now.instant());
  const match = slots.find((slot) => slot.start === start.toString());
  if (!match) throw new AppError('SLOT_OUTSIDE_POLICY', 'The requested time is outside this schedule policy.', 409);
  return match;
}

module.exports = { generateCandidateSlots, overlaps, parseSchedule, validateRequestedSlot, validateScheduleInput, validateTimeZone };
