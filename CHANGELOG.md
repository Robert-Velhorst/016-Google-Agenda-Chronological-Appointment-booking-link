# Changelog

## Unreleased - 2026-08-09

- Made slot conflicts buffer-aware across Google events and local pending/confirmed reservations.
- Added bounded reconciliation for ambiguous provider writes and safer transient OAuth refresh handling.
- Redacted management/idempotency secrets, made exports complete, and made HAI requester PII opt-in.
- Hardened Windows/ngrok launch, static compression/caching, validation, rate-limit memory, provider pagination/timeouts, and local deletion safety.
- Improved admin/requester loading, timezone, logout, rescheduling, and stale-slot behavior.
- Fixed combined hour/minute sorting and text/attribute-only live updates in the Chrome extension.

## 2.0.0 - 2026-08-08

- Added the local-first booking service, React operator console, and public booking/manage pages.
- Added SQLite migrations, Google OAuth token encryption, live conflict checks, idempotent event creation, reminders, reschedule/cancel, audit history, exports, emergency stop, diagnostics, Docker, and CI.
- Preserved the Manifest V3 appointment-choice sorting extension and its tests.

## 1.2.0 - 2026-07-26

- Added public Google booking route and embedded-frame support.
- Hardened sorting boundaries and dynamic-content handling.
