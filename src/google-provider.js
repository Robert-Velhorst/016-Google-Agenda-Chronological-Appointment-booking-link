'use strict';

const crypto = require('node:crypto');
const { AppError, providerError } = require('./errors');
const { tokenHash } = require('./crypto');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly'
];

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

class GoogleCalendarProvider {
  constructor({ config, db, vault, fetchImpl = fetch }) {
    this.config = config;
    this.db = db;
    this.vault = vault;
    this.fetch = fetchImpl;
    this.refreshes = new Map();
  }

  async fetchRequest(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.providerTimeoutMs);
    try {
      return await this.fetch(url, { ...options, signal: options.signal || controller.signal });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('GOOGLE_NETWORK_ERROR', 'Google Calendar did not respond. The action was not confirmed and can be retried safely.', 502, true);
    } finally {
      clearTimeout(timer);
    }
  }

  configured() {
    return this.config.googleConfigured && this.vault.available;
  }

  connectionStatus(ownerId) {
    if (!this.config.googleConfigured) return { status: 'not_configured', connected: false };
    const row = this.db.prepare('SELECT status, scopes, expires_at, updated_at FROM oauth_connections WHERE owner_id = ?').get(ownerId);
    return row ? { status: row.status, connected: row.status === 'connected', scopes: row.scopes.split(' '), expiresAt: row.expires_at, updatedAt: row.updated_at } : { status: 'not_connected', connected: false };
  }

  createAuthorization(ownerId) {
    if (!this.config.googleConfigured || !this.vault.available) throw new AppError('GOOGLE_NOT_CONFIGURED', 'Google OAuth is not configured by the operator.', 503);
    const state = base64url(crypto.randomBytes(32));
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    this.db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(new Date().toISOString());
    this.db.prepare('INSERT INTO oauth_states(state_hash, owner_id, code_verifier, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash(state), ownerId, verifier, expiresAt);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.config.googleClientId,
      redirect_uri: this.config.googleRedirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    }).toString();
    return url.toString();
  }

  async completeAuthorization(state, code) {
    const row = this.db.prepare('SELECT * FROM oauth_states WHERE state_hash = ?').get(tokenHash(state));
    if (!row || row.expires_at <= new Date().toISOString()) throw new AppError('INVALID_OAUTH_STATE', 'The Google authorization request expired or is invalid.', 400);
    this.db.prepare('DELETE FROM oauth_states WHERE state_hash = ?').run(tokenHash(state));
    const response = await this.fetchRequest('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.googleClientId,
        client_secret: this.config.googleClientSecret,
        redirect_uri: this.config.googleRedirectUri,
        grant_type: 'authorization_code',
        code,
        code_verifier: row.code_verifier
      })
    });
    const data = await response.json();
    if (!response.ok) throw providerError('Google rejected the authorization exchange.', response.status, data);
    const expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();
    const encrypted = this.vault.encrypt(JSON.stringify(data));
    this.db.prepare(`INSERT INTO oauth_connections(owner_id, encrypted_tokens, scopes, status, expires_at, updated_at)
      VALUES (?, ?, ?, 'connected', ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET encrypted_tokens=excluded.encrypted_tokens, scopes=excluded.scopes,
      status='connected', expires_at=excluded.expires_at, updated_at=excluded.updated_at`)
      .run(row.owner_id, encrypted, data.scope || SCOPES.join(' '), expiresAt, new Date().toISOString());
    return row.owner_id;
  }

  async disconnect(ownerId) {
    const row = this.db.prepare('SELECT encrypted_tokens FROM oauth_connections WHERE owner_id=?').get(ownerId);
    if (row) {
      const tokens = JSON.parse(this.vault.decrypt(row.encrypted_tokens));
      const token = tokens.refresh_token || tokens.access_token;
      if (token) {
        const response = await this.fetchRequest('https://oauth2.googleapis.com/revoke', {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token })
        });
        if (!response.ok && response.status !== 400) throw providerError('Google access could not be revoked.', response.status, await response.text());
      }
      this.db.prepare("UPDATE oauth_connections SET status='revoked', updated_at=? WHERE owner_id=?")
        .run(new Date().toISOString(), ownerId);
    }
  }

  async accessToken(ownerId) {
    const row = this.db.prepare('SELECT * FROM oauth_connections WHERE owner_id = ?').get(ownerId);
    if (!row || row.status !== 'connected') throw new AppError('GOOGLE_NOT_CONNECTED', 'Google Calendar must be connected by the operator.', 503);
    const tokens = JSON.parse(this.vault.decrypt(row.encrypted_tokens));
    if (row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 60000) return tokens.access_token;
    if (!tokens.refresh_token) throw new AppError('GOOGLE_REAUTH_REQUIRED', 'Google authorization expired and must be renewed.', 503);
    if (this.refreshes.has(ownerId)) return this.refreshes.get(ownerId);
    const refresh = this.refreshAccessToken(ownerId, tokens).finally(() => {
      if (this.refreshes.get(ownerId) === refresh) this.refreshes.delete(ownerId);
    });
    this.refreshes.set(ownerId, refresh);
    return refresh;
  }

  async refreshAccessToken(ownerId, tokens) {
    const response = await this.fetchRequest('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.googleClientId,
        client_secret: this.config.googleClientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token'
      })
    });
    const refreshed = await response.json();
    if (!response.ok) {
      this.db.prepare("UPDATE oauth_connections SET status='invalid', updated_at=? WHERE owner_id=?").run(new Date().toISOString(), ownerId);
      throw providerError('Google authorization could not be refreshed.', response.status, refreshed);
    }
    const merged = { ...tokens, ...refreshed, refresh_token: tokens.refresh_token };
    const expiresAt = new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000).toISOString();
    this.db.prepare('UPDATE oauth_connections SET encrypted_tokens=?, expires_at=?, updated_at=? WHERE owner_id=?')
      .run(this.vault.encrypt(JSON.stringify(merged)), expiresAt, new Date().toISOString(), ownerId);
    return merged.access_token;
  }

  async request(ownerId, url, options = {}) {
    const token = await this.accessToken(ownerId);
    const response = await this.fetchRequest(url, {
      ...options,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers || {}) }
    });
    let data = null;
    if (response.status !== 204) {
      const text = await response.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
    }
    if (!response.ok) throw providerError(data?.error?.message || 'Google Calendar request failed.', response.status, data);
    return { data, headers: response.headers, status: response.status };
  }

  async verify(ownerId, calendarId = 'primary') {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`;
    const { data } = await this.request(ownerId, url);
    return { id: data.id, summary: data.summary, timezone: data.timeZone };
  }

  async busy(ownerId, calendarId, timeMin, timeMax, timezone) {
    const { data } = await this.request(ownerId, 'https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      body: JSON.stringify({ timeMin, timeMax, timeZone: timezone, items: [{ id: calendarId }] })
    });
    const calendar = data.calendars?.[calendarId];
    if (!calendar || calendar.errors?.length) throw new AppError('GOOGLE_CALENDAR_UNAVAILABLE', 'Google Calendar could not verify availability for this calendar.', 502, true);
    return calendar.busy || [];
  }

  async conflicts(ownerId, calendarId, start, end, excludeEventId = null) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    const events = [];
    let pageToken = '';
    for (let page = 0; page < 10; page += 1) {
      url.search = new URLSearchParams({
        timeMin: start,
        timeMax: end,
        singleEvents: 'true',
        showDeleted: 'false',
        maxResults: '2500',
        ...(pageToken ? { pageToken } : {})
      }).toString();
      const { data } = await this.request(ownerId, url.toString());
      events.push(...(data.items || []));
      pageToken = data.nextPageToken || '';
      if (!pageToken) return events.filter((event) => event.id !== excludeEventId && event.status !== 'cancelled' && event.transparency !== 'transparent');
    }
    throw new AppError('GOOGLE_RESULT_LIMIT', 'Google Calendar returned too many overlapping events to verify this slot safely.', 502, true);
  }

  async createEvent(ownerId, calendarId, eventId, booking, schedule, manageUrl) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.search = new URLSearchParams({ sendUpdates: 'all' }).toString();
    const reminders = schedule.reminderMinutes.slice(0, 5).map((minutes) => ({ method: 'email', minutes }));
    const { data } = await this.request(ownerId, url.toString(), {
      method: 'POST',
      body: JSON.stringify({
        id: eventId,
        summary: schedule.name,
        location: schedule.location || undefined,
        description: `Booking reference: ${booking.id}\nManage booking: ${manageUrl}`,
        start: { dateTime: booking.start_at, timeZone: schedule.timezone },
        end: { dateTime: booking.end_at, timeZone: schedule.timezone },
        attendees: [{ email: booking.requester_email, displayName: booking.requester_name }],
        reminders: { useDefault: false, overrides: reminders }
      })
    });
    return { id: data.id, etag: data.etag, htmlLink: data.htmlLink };
  }

  async getEvent(ownerId, calendarId, eventId) {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    const { data } = await this.request(ownerId, url);
    return { id: data.id, etag: data.etag, htmlLink: data.htmlLink, start: data.start, end: data.end };
  }

  async updateEvent(ownerId, calendarId, eventId, etag, booking, schedule) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    url.search = new URLSearchParams({ sendUpdates: 'all' }).toString();
    const { data } = await this.request(ownerId, url.toString(), {
      method: 'PATCH',
      headers: etag ? { 'if-match': etag } : {},
      body: JSON.stringify({
        start: { dateTime: booking.start_at, timeZone: schedule.timezone },
        end: { dateTime: booking.end_at, timeZone: schedule.timezone }
      })
    });
    return { id: data.id, etag: data.etag, htmlLink: data.htmlLink };
  }

  async deleteEvent(ownerId, calendarId, eventId, etag) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    url.search = new URLSearchParams({ sendUpdates: 'all' }).toString();
    return this.request(ownerId, url.toString(), { method: 'DELETE', headers: etag ? { 'if-match': etag } : {} });
  }
}

module.exports = { GoogleCalendarProvider, SCOPES };
