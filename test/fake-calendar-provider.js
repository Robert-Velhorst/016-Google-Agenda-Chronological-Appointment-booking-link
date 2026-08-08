'use strict';

class FakeCalendarProvider {
  constructor() { this.events = new Map(); this.busyIntervals = []; this.connected = true; this.created = 0; this.failCreate = false; this.storeThenFail = false; this.createDelayMs = 0; }
  connectionStatus() { return { status: this.connected ? 'connected' : 'not_connected', connected: this.connected }; }
  async verify() { if (!this.connected) throw new Error('not connected'); return { id: 'primary', summary: 'Test', timezone: 'Europe/Amsterdam' }; }
  async busy() { return this.busyIntervals; }
  async conflicts(_owner, _calendar, start, end, exclude = null) { return [...this.events.values()].filter((event) => event.id !== exclude && event.start < end && event.end > start); }
  async createEvent(_owner, _calendar, eventId, booking) { if(this.createDelayMs)await new Promise((resolve)=>setTimeout(resolve,this.createDelayMs)); if (this.failCreate) { const error = new Error('provider unavailable'); error.providerStatus=503; throw error; } if (this.events.has(eventId)) { const error = new Error('duplicate'); error.providerStatus=409; throw error; } const event={id:eventId,etag:`etag-${eventId}`,start:booking.start_at,end:booking.end_at};this.events.set(eventId,event);this.created+=1;if(this.storeThenFail){this.storeThenFail=false;throw new Error('connection reset after create');}return event; }
  async getEvent(_owner,_calendar,eventId){const event=this.events.get(eventId);if(!event){const error=new Error('missing');error.providerStatus=404;throw error;}return event;}
  async updateEvent(_owner,_calendar,eventId,_etag,booking){const event={id:eventId,etag:`etag-updated-${eventId}`,start:booking.start_at,end:booking.end_at};this.events.set(eventId,event);return event;}
  async deleteEvent(_owner,_calendar,eventId){if(!this.events.delete(eventId)){const error=new Error('missing');error.providerStatus=404;throw error;}return {status:204};}
  createAuthorization(){return 'https://accounts.example.test/authorize';}
  async disconnect(){this.connected=false;}
}

module.exports = { FakeCalendarProvider };
