CREATE INDEX IF NOT EXISTS schedules_owner_calendar_idx
  ON schedules(owner_id, calendar_id, status);

CREATE INDEX IF NOT EXISTS bookings_time_status_idx
  ON bookings(start_at, end_at, status);

CREATE INDEX IF NOT EXISTS bookings_updated_cursor_idx
  ON bookings(updated_at, id);

ALTER TABLE bookings ADD COLUMN reserved_start_at TEXT;
ALTER TABLE bookings ADD COLUMN reserved_end_at TEXT;
