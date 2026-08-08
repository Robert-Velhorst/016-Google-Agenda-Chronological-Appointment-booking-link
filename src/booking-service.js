'use strict';

const crypto = require('node:crypto');
const { Temporal } = require('@js-temporal/polyfill');
const { audit, withImmediateTransaction } = require('./db');
const { AppError } = require('./errors');
const { googleEventId, safeEqual, tokenHash } = require('./crypto');
const { generateCandidateSlots, parseSchedule, validateRequestedSlot, validateScheduleInput } = require('./policy');

function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function eventTime(value) { return typeof value === 'string' ? value : value?.dateTime; }
function encodeCursor(row) { return Buffer.from(JSON.stringify({ updatedAt: row.updated_at, id: row.id })).toString('base64url'); }
function decodeCursor(value) {
  if (!value) return { updatedAt: '1970-01-01T00:00:00.000Z', id: '' };
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (typeof parsed.updatedAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.updatedAt))) throw new Error('invalid');
    return parsed;
  } catch {
    throw new AppError('INVALID_CURSOR', 'The HAI connector cursor is invalid.', 400);
  }
}
function slug(name) {
  const stem = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'schedule';
  return `${stem}-${crypto.randomBytes(4).toString('hex')}`;
}
function publicSchedule(schedule) {
  return {
    id: schedule.id,
    slug: schedule.slug,
    name: schedule.name,
    timezone: schedule.timezone,
    location: schedule.location,
    durations: schedule.durations,
    status: schedule.status,
    reminderMinutes: schedule.reminderMinutes,
    maxAdvanceDays: schedule.max_advance_days,
    availableWeekdays: Object.entries(schedule.weeklyAvailability)
      .filter(([, windows]) => Array.isArray(windows) && windows.length > 0)
      .map(([day]) => Number(day))
  };
}

class BookingService {
  constructor({ config, db, provider, vault }) {
    this.config = config;
    this.db = db;
    this.provider = provider;
    this.vault = vault;
  }

  emergencyStopped() {
    return this.db.prepare("SELECT value FROM app_settings WHERE key='emergency_stop'").get()?.value === 'true';
  }

  status() {
    return {
      appEnv: this.config.appEnv,
      emergencyStop: this.emergencyStopped(),
      google: this.provider.connectionStatus(this.config.ownerId),
      hai: { configured: Boolean(this.config.haiConnectorToken), mode: 'read_only_feed' },
      database: 'ready',
      publicBaseUrl: this.config.baseUrl
    };
  }

  createSchedule(input, requestId) {
    const value = validateScheduleInput(input);
    const scheduleId = id();
    const scheduleSlug = slug(value.name);
    const timestamp = now();
    this.db.prepare(`INSERT INTO schedules
      (id, owner_id, slug, name, timezone, calendar_id, location, durations_json, weekly_availability_json,
       slot_interval_minutes, buffer_before_minutes, buffer_after_minutes, min_notice_minutes, max_advance_days,
       reminder_minutes_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
      .run(scheduleId, this.config.ownerId, scheduleSlug, value.name, value.timezone, value.calendarId, value.location,
        JSON.stringify(value.durations), JSON.stringify(value.weeklyAvailability), value.slotIntervalMinutes,
        value.bufferBeforeMinutes, value.bufferAfterMinutes, value.minNoticeMinutes, value.maxAdvanceDays,
        JSON.stringify(value.reminderMinutes), timestamp, timestamp);
    audit(this.db, { ownerId: this.config.ownerId, actorType: 'operator', action: 'schedule.created', entityType: 'schedule', entityId: scheduleId, requestId, details: { status: 'draft' } });
    return this.getSchedule(scheduleId);
  }

  getSchedule(scheduleId) {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id=? AND owner_id=?').get(scheduleId, this.config.ownerId);
    if (!row) throw new AppError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404);
    return parseSchedule(row);
  }

  scheduleBySlug(scheduleSlug, activeOnly = true) {
    const row = this.db.prepare(`SELECT * FROM schedules WHERE slug=?${activeOnly ? " AND status='active'" : ''}`).get(scheduleSlug);
    if (!row) throw new AppError('SCHEDULE_NOT_FOUND', 'This booking page is not available.', 404);
    return parseSchedule(row);
  }

  listSchedules() {
    return this.db.prepare('SELECT * FROM schedules WHERE owner_id=? ORDER BY created_at DESC').all(this.config.ownerId).map(parseSchedule);
  }

  async setScheduleStatus(scheduleId, status, requestId) {
    if (!['active', 'paused', 'archived'].includes(status)) throw new AppError('INVALID_STATUS', 'Schedule status is invalid.', 422);
    const schedule = this.getSchedule(scheduleId);
    if (status === 'active') await this.provider.verify(this.config.ownerId, schedule.calendar_id);
    this.db.prepare('UPDATE schedules SET status=?, updated_at=? WHERE id=? AND owner_id=?').run(status, now(), scheduleId, this.config.ownerId);
    audit(this.db, { ownerId: this.config.ownerId, actorType: 'operator', action: `schedule.${status}`, entityType: 'schedule', entityId: scheduleId, requestId, details: {} });
    return this.getSchedule(scheduleId);
  }

  async slots(scheduleSlug, duration, fromDate, toDate) {
    if (this.emergencyStopped()) throw new AppError('BOOKING_PAUSED', 'Bookings are temporarily paused by the operator.', 503, true);
    const schedule = this.scheduleBySlug(scheduleSlug);
    const startDate = Temporal.PlainDate.from(fromDate);
    const endDate = Temporal.PlainDate.from(toDate);
    if (startDate.until(endDate).days < 0 || startDate.until(endDate).days > 31) throw new AppError('INVALID_DATE_RANGE', 'Slot searches are limited to 31 days.', 422);
    const start = startDate.toZonedDateTime({ timeZone: schedule.timezone, plainTime: '00:00' }).toInstant();
    const end = endDate.add({ days: 1 }).toZonedDateTime({ timeZone: schedule.timezone, plainTime: '00:00' }).toInstant();
    const busy = await this.provider.busy(schedule.owner_id, schedule.calendar_id, start.toString(), end.toString(), schedule.timezone);
    return generateCandidateSlots(schedule, Number(duration), fromDate, toDate, busy);
  }

  localConflict(schedule, startAt, endAt, excludeBookingId = null) {
    return this.db.prepare(`SELECT id FROM bookings
      WHERE schedule_id IN (SELECT id FROM schedules WHERE owner_id=? AND calendar_id=?)
      AND status IN ('pending','confirmed')
      AND ((start_at < ? AND end_at > ?) OR (reserved_start_at IS NOT NULL AND reserved_start_at < ? AND reserved_end_at > ?))
      AND (? IS NULL OR id <> ?) LIMIT 1`).get(schedule.owner_id, schedule.calendar_id, endAt, startAt, endAt, startAt, excludeBookingId, excludeBookingId);
  }

  async book(scheduleSlug, input, idempotencyKey, requestId) {
    if (this.emergencyStopped()) throw new AppError('BOOKING_PAUSED', 'Bookings are temporarily paused by the operator.', 503, true);
    if (!this.vault.available) throw new AppError('BOOKING_NOT_CONFIGURED', 'Secure booking storage is not configured.', 503);
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) throw new AppError('IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key header is required.', 400);
    const schedule = this.scheduleBySlug(scheduleSlug);
    const requesterName = String(input.name || '').trim();
    const requesterEmail = String(input.email || '').trim().toLowerCase();
    if (requesterName.length < 2 || requesterName.length > 120) throw new AppError('INVALID_REQUESTER', 'Your name is required.', 422);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail) || requesterEmail.length > 254) throw new AppError('INVALID_EMAIL', 'A valid email address is required.', 422);
    const duration = Number(input.duration);
    const slot = validateRequestedSlot(schedule, duration, input.start);
    const reservation = withImmediateTransaction(this.db, () => {
      const repeated = this.db.prepare('SELECT * FROM bookings WHERE schedule_id=? AND idempotency_key=?').get(schedule.id, idempotencyKey);
      if (repeated) {
        const sameRequest = repeated.requester_name === requesterName && repeated.requester_email === requesterEmail
          && repeated.start_at === slot.start && repeated.end_at === slot.end;
        if (!sameRequest) throw new AppError('IDEMPOTENCY_CONFLICT', 'This retry key was already used for different booking details.', 409);
        if (repeated.status === 'confirmed' || repeated.status === 'cancelled') return { row: repeated, complete: true, existing: true };
        if (this.localConflict(schedule, slot.start, slot.end, repeated.id)) throw new AppError('SLOT_UNAVAILABLE', 'That time is no longer available.', 409);
        this.db.prepare("UPDATE bookings SET status='pending', provider_status='reconciling', error_code=NULL, updated_at=? WHERE id=?")
          .run(now(), repeated.id);
        return { row: this.db.prepare('SELECT * FROM bookings WHERE id=?').get(repeated.id), complete: false, existing: true };
      }
      if (this.localConflict(schedule, slot.start, slot.end)) throw new AppError('SLOT_UNAVAILABLE', 'That time was just booked. Choose another time.', 409);
      const bookingId = id();
      const manageToken = crypto.randomBytes(32).toString('base64url');
      const timestamp = now();
      this.db.prepare(`INSERT INTO bookings
        (id, schedule_id, idempotency_key, requester_name, requester_email, start_at, end_at, status, provider_status,
         manage_token_hash, manage_token_cipher, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'reserved', ?, ?, ?, ?)`)
        .run(bookingId, schedule.id, idempotencyKey, requesterName, requesterEmail, slot.start, slot.end,
          tokenHash(manageToken), this.vault.encrypt(manageToken), timestamp, timestamp);
      return { row: this.db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId), complete: false, existing: false };
    });
    if (reservation.complete) return this.bookingResponse(reservation.row);
    return this.confirmReservation(schedule, reservation.row, reservation.existing, requestId);
  }

  markProviderFailure(bookingId, error, requestId, ownerId) {
    const retryable = Boolean(error.retryable || error.providerStatus === 429 || error.providerStatus >= 500 || !error.providerStatus);
    const status = retryable ? 'pending' : 'failed';
    const code = error.code || 'GOOGLE_PROVIDER_ERROR';
    withImmediateTransaction(this.db, () => {
      this.db.prepare('UPDATE bookings SET status=?, provider_status=?, error_code=?, updated_at=? WHERE id=?')
        .run(status, retryable ? 'uncertain' : 'failed', code, now(), bookingId);
      audit(this.db, { ownerId, actorType: 'system', action: retryable ? 'booking.provider_uncertain' : 'booking.provider_failed', entityType: 'booking', entityId: bookingId, requestId, details: { code } });
    });
    if (error instanceof AppError) throw error;
    throw new AppError('GOOGLE_PROVIDER_ERROR', 'Google Calendar did not confirm the booking. Retry safely with the same booking attempt.', 502, true);
  }

  async confirmReservation(schedule, booking, reconcileFirst, requestId) {
    const eventId = googleEventId(`${schedule.id}:${booking.idempotency_key}`);
    const manageUrl = this.bookingResponse(booking).manageUrl;
    let event = null;
    if (reconcileFirst) {
      try {
        event = await this.provider.getEvent(schedule.owner_id, schedule.calendar_id, eventId);
      } catch (error) {
        if (error.providerStatus !== 404) return this.markProviderFailure(booking.id, error, requestId, schedule.owner_id);
      }
    }
    if (!event) {
      try {
        const remoteConflicts = await this.provider.conflicts(schedule.owner_id, schedule.calendar_id, booking.start_at, booking.end_at, eventId);
        if (remoteConflicts.length) throw new AppError('SLOT_UNAVAILABLE', 'That time is no longer available in Google Calendar.', 409);
        try {
          event = await this.provider.createEvent(schedule.owner_id, schedule.calendar_id, eventId, booking, schedule, manageUrl);
        } catch (error) {
          if (error.providerStatus === 409) event = await this.provider.getEvent(schedule.owner_id, schedule.calendar_id, eventId);
          else throw error;
        }
      } catch (error) {
        return this.markProviderFailure(booking.id, error, requestId, schedule.owner_id);
      }
    }
    return withImmediateTransaction(this.db, () => {
      const current = this.db.prepare('SELECT * FROM bookings WHERE id=?').get(booking.id);
      if (current.status !== 'confirmed') {
        this.db.prepare("UPDATE bookings SET status='confirmed', provider_status='created', google_event_id=?, google_etag=?, error_code=NULL, updated_at=? WHERE id=?")
          .run(event.id, event.etag || null, now(), booking.id);
        audit(this.db, { ownerId: schedule.owner_id, actorType: 'requester', action: 'booking.confirmed', entityType: 'booking', entityId: booking.id, requestId, details: { scheduleId: schedule.id, start: booking.start_at } });
      }
      return this.bookingResponse(this.db.prepare('SELECT * FROM bookings WHERE id=?').get(booking.id));
    });
  }

  bookingResponse(row) {
    const token = this.vault.decrypt(row.manage_token_cipher);
    const schedule = parseSchedule(this.db.prepare('SELECT * FROM schedules WHERE id=?').get(row.schedule_id));
    return {
      id: row.id,
      schedule: publicSchedule(schedule),
      requesterName: row.requester_name,
      requesterEmail: row.requester_email,
      start: row.start_at,
      end: row.end_at,
      status: row.status,
      providerStatus: row.provider_status,
      manageUrl: `${this.config.baseUrl}/book/${schedule.slug}#manage=${encodeURIComponent(row.id)}&token=${encodeURIComponent(token)}`
    };
  }

  managedBooking(bookingId, token) {
    const row = this.db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId);
    if (!row || !safeEqual(tokenHash(token || ''), row.manage_token_hash)) throw new AppError('BOOKING_NOT_FOUND', 'Booking link is invalid.', 404);
    return { row, response: this.bookingResponse(row), schedule: parseSchedule(this.db.prepare('SELECT * FROM schedules WHERE id=?').get(row.schedule_id)) };
  }

  async cancel(bookingId, token, requestId) {
    const managed = this.managedBooking(bookingId, token);
    if (managed.row.status === 'cancelled') return managed.response;
    if (managed.row.status !== 'confirmed') throw new AppError('BOOKING_NOT_CANCELLABLE', 'Only confirmed bookings can be cancelled.', 409);
    withImmediateTransaction(this.db, () => {
      this.db.prepare("UPDATE bookings SET provider_status='deleting', error_code=NULL, updated_at=? WHERE id=?").run(now(), bookingId);
    });
    try {
      await this.provider.deleteEvent(managed.schedule.owner_id, managed.schedule.calendar_id, managed.row.google_event_id, managed.row.google_etag);
    } catch (error) {
      let failure = error.providerStatus === 404 ? null : error;
      if (error.providerStatus === 412) {
        try {
          const currentEvent = await this.provider.getEvent(managed.schedule.owner_id, managed.schedule.calendar_id, managed.row.google_event_id);
          await this.provider.deleteEvent(managed.schedule.owner_id, managed.schedule.calendar_id, managed.row.google_event_id, currentEvent.etag);
          failure = null;
        } catch (reconcileError) {
          failure = reconcileError.providerStatus === 404 ? null : reconcileError;
        }
      }
      if (failure) {
        withImmediateTransaction(this.db, () => {
          this.db.prepare("UPDATE bookings SET provider_status='delete_failed', error_code=?, updated_at=? WHERE id=?")
            .run(failure.code || 'GOOGLE_PROVIDER_ERROR', now(), bookingId);
        });
        throw failure;
      }
    }
    return withImmediateTransaction(this.db, () => {
      this.db.prepare("UPDATE bookings SET status='cancelled', provider_status='cancelled', error_code=NULL, reserved_start_at=NULL, reserved_end_at=NULL, updated_at=? WHERE id=?").run(now(), bookingId);
      audit(this.db, { ownerId: managed.schedule.owner_id, actorType: 'requester', action: 'booking.cancelled', entityType: 'booking', entityId: bookingId, requestId, details: {} });
      return this.bookingResponse(this.db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId));
    });
  }

  async reschedule(bookingId, token, input, requestId) {
    if (this.emergencyStopped()) throw new AppError('BOOKING_PAUSED', 'Rescheduling is temporarily paused by the operator. Existing bookings can still be cancelled.', 503, true);
    const managed = this.managedBooking(bookingId, token);
    if (managed.row.status !== 'confirmed') throw new AppError('BOOKING_NOT_RESCHEDULABLE', 'Only confirmed bookings can be rescheduled.', 409);
    const duration = Math.round((new Date(managed.row.end_at) - new Date(managed.row.start_at)) / 60000);
    const slot = validateRequestedSlot(managed.schedule, duration, input.start);
    withImmediateTransaction(this.db, () => {
      const current = this.db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId);
      if (current.provider_status === 'updating' && (current.reserved_start_at !== slot.start || current.reserved_end_at !== slot.end)) {
        throw new AppError('BOOKING_BUSY', 'Another reschedule is still being reconciled. Retry shortly.', 409, true);
      }
      if (this.localConflict(managed.schedule, slot.start, slot.end, bookingId)) throw new AppError('SLOT_UNAVAILABLE', 'That time was just booked. Choose another time.', 409);
      this.db.prepare("UPDATE bookings SET provider_status='updating', error_code=NULL, reserved_start_at=?, reserved_end_at=?, updated_at=? WHERE id=?")
        .run(slot.start, slot.end, now(), bookingId);
    });
    try {
      const conflicts = await this.provider.conflicts(managed.schedule.owner_id, managed.schedule.calendar_id, slot.start, slot.end, managed.row.google_event_id);
      if (conflicts.length) throw new AppError('SLOT_UNAVAILABLE', 'That time is no longer available in Google Calendar.', 409);
      const nextBooking = { ...managed.row, start_at: slot.start, end_at: slot.end };
      let event = null;
      if (managed.row.provider_status === 'updating' && managed.row.reserved_start_at === slot.start && managed.row.reserved_end_at === slot.end) {
        event = await this.provider.getEvent(managed.schedule.owner_id, managed.schedule.calendar_id, managed.row.google_event_id);
        if (eventTime(event.start) !== slot.start || eventTime(event.end) !== slot.end) event = null;
      }
      if (!event) {
        try {
          event = await this.provider.updateEvent(managed.schedule.owner_id, managed.schedule.calendar_id,
            managed.row.google_event_id, managed.row.google_etag, nextBooking, managed.schedule);
        } catch (error) {
          if (error.providerStatus !== 412) throw error;
          const currentEvent = await this.provider.getEvent(managed.schedule.owner_id, managed.schedule.calendar_id, managed.row.google_event_id);
          if (eventTime(currentEvent.start) !== slot.start || eventTime(currentEvent.end) !== slot.end) {
            throw new AppError('BOOKING_CHANGED_EXTERNALLY', 'The Google event changed outside this app. Reload the manage link before trying again.', 409);
          }
          event = currentEvent;
        }
      }
      return withImmediateTransaction(this.db, () => {
        this.db.prepare("UPDATE bookings SET start_at=?, end_at=?, google_etag=?, provider_status='updated', error_code=NULL, reserved_start_at=NULL, reserved_end_at=NULL, updated_at=? WHERE id=?")
          .run(slot.start, slot.end, event.etag || null, now(), bookingId);
        audit(this.db, { ownerId: managed.schedule.owner_id, actorType: 'requester', action: 'booking.rescheduled', entityType: 'booking', entityId: bookingId, requestId, details: { start: slot.start } });
        return this.bookingResponse(this.db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId));
      });
    } catch (error) {
      withImmediateTransaction(this.db, () => {
        this.db.prepare("UPDATE bookings SET provider_status='update_failed', error_code=?, reserved_start_at=NULL, reserved_end_at=NULL, updated_at=? WHERE id=?")
          .run(error.code || 'GOOGLE_PROVIDER_ERROR', now(), bookingId);
        audit(this.db, { ownerId: managed.schedule.owner_id, actorType: 'system', action: 'booking.reschedule_failed', entityType: 'booking', entityId: bookingId, requestId, details: { code: error.code || 'GOOGLE_PROVIDER_ERROR' } });
      });
      throw error;
    }
  }

  listBookings() {
    return this.db.prepare(`SELECT b.*, s.name AS schedule_name, s.slug AS schedule_slug
      FROM bookings b JOIN schedules s ON s.id=b.schedule_id WHERE s.owner_id=? ORDER BY b.start_at DESC LIMIT 500`).all(this.config.ownerId);
  }

  auditLog() {
    return this.db.prepare('SELECT * FROM audit_logs WHERE owner_id=? OR owner_id IS NULL ORDER BY id DESC LIMIT 500').all(this.config.ownerId)
      .map((row) => ({ ...row, details: JSON.parse(row.details_json) }));
  }

  setEmergencyStop(enabled, requestId) {
    this.db.prepare("UPDATE app_settings SET value=?, updated_at=? WHERE key='emergency_stop'").run(String(Boolean(enabled)), now());
    audit(this.db, { ownerId: this.config.ownerId, actorType: 'operator', action: enabled ? 'system.stopped' : 'system.resumed', entityType: 'system', requestId, details: {} });
    return { enabled: this.emergencyStopped() };
  }

  exportData() {
    return { exportedAt: now(), owner: { id: this.config.ownerId, email: this.config.ownerEmail }, schedules: this.listSchedules(), bookings: this.listBookings(), audit: this.auditLog() };
  }

  haiFeed(cursorText, requestedLimit) {
    if (!this.config.haiConnectorToken) throw new AppError('HAI_NOT_CONFIGURED', 'The HAI connector is not configured.', 503);
    const cursor = decodeCursor(cursorText);
    const parsedLimit = Number(requestedLimit);
    const limit = Math.min(this.config.haiConnectorMaxItems,
      Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : this.config.haiConnectorMaxItems);
    const rows = this.db.prepare(`SELECT b.*, s.name AS schedule_name, s.slug AS schedule_slug, s.timezone AS schedule_timezone
      FROM bookings b JOIN schedules s ON s.id=b.schedule_id
      WHERE s.owner_id=? AND (b.updated_at > ? OR (b.updated_at = ? AND b.id > ?))
      ORDER BY b.updated_at ASC, b.id ASC LIMIT ?`)
      .all(this.config.ownerId, cursor.updatedAt, cursor.updatedAt, cursor.id, limit);
    const items = rows.map((row) => ({
      externalId: row.id,
      title: `${row.schedule_name}: ${row.status} booking`,
      content: [
        `Booking status: ${row.status}.`,
        `Schedule: ${row.schedule_name}.`,
        `Starts: ${row.start_at}.`,
        `Ends: ${row.end_at}.`,
        `Time zone: ${row.schedule_timezone}.`,
        `Requester: ${row.requester_name} <${row.requester_email}>.`,
        `Provider state: ${row.provider_status}.`
      ].join(' '),
      sourceUri: `${this.config.baseUrl}/book/${encodeURIComponent(row.schedule_slug)}`,
      itemType: 'calendar_booking',
      projectKey: this.config.haiConnectorProjectKey,
      metadata: JSON.stringify({ status: row.status, providerStatus: row.provider_status, start: row.start_at, end: row.end_at, timezone: row.schedule_timezone, updatedAt: row.updated_at })
    }));
    return {
      connector: 'chronological-booking',
      schemaVersion: 1,
      authority: 'read_only',
      items,
      nextCursor: rows.length ? encodeCursor(rows.at(-1)) : cursorText || ''
    };
  }
}

module.exports = { BookingService, publicSchedule };
