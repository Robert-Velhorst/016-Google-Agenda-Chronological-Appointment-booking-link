CREATE INDEX IF NOT EXISTS bookings_schedule_status_time_idx
  ON bookings(schedule_id, status, start_at, end_at);
