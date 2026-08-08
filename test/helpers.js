'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createVault } = require('../src/crypto');
const { openDatabase } = require('../src/db');
const { BookingService } = require('../src/booking-service');
const { FakeCalendarProvider } = require('./fake-calendar-provider');

function testRuntime(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chronological-booking-'));
  const config = loadConfig({ ADMIN_TOKEN:'a'.repeat(32), ENCRYPTION_KEY:'b'.repeat(64), DATABASE_PATH:path.join(directory,'test.sqlite'), BASE_URL:'http://localhost:8787', APP_ENV:'test', GOOGLE_CLIENT_ID:'test-client', GOOGLE_CLIENT_SECRET:'test-secret', ...overrides });
  const db = openDatabase(config); const vault=createVault(config.encryptionKey); const provider=new FakeCalendarProvider(); const service=new BookingService({config,db,provider,vault});
  return {directory,config,db,vault,provider,service,cleanup(){db.close();fs.rmSync(directory,{recursive:true,force:true});}};
}
function futureDate(days=10){const date=new Date(Date.now()+days*86400000);return date.toISOString().slice(0,10);}
function defaultSchedule(name='Consultation'){return {name,timezone:'Europe/Amsterdam',calendarId:'primary',location:'Online',durations:[30,60],weeklyAvailability:{1:[['09:00','17:00']],2:[['09:00','17:00']],3:[['09:00','17:00']],4:[['09:00','17:00']],5:[['09:00','17:00']],6:[['09:00','17:00']],7:[['09:00','17:00']]},slotIntervalMinutes:30,minNoticeMinutes:0,maxAdvanceDays:120,reminderMinutes:[1440]};}
module.exports={defaultSchedule,futureDate,testRuntime};
