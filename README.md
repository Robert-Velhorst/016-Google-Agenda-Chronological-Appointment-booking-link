# Chronological Booking

Chronological Booking is a local-first Google Calendar booking service plus the original Manifest V3 appointment-choice sorter. The service provides an operator console, public schedule pages, live Google availability checks, chronological slot selection, audited event creation, Google-managed reminders, and token-protected reschedule/cancel flows.

## Current operational status

The code and test provider critical path are implemented. Live Google Calendar operation requires operator-owned OAuth credentials, HTTPS for production, an encryption key, and explicit Google consent. The service fails closed when those are absent. It does not claim to create Google Appointment Schedule products; it creates ordinary Calendar events through the official API.

## Local setup

1. Install Node.js 24.15 or newer and run `npm ci`.
2. Copy `.env.example` to `.env`.
3. Generate `ADMIN_TOKEN` and `ENCRYPTION_KEY` with the commands shown in `.env.example`.
4. Configure a Google OAuth web client with redirect URI `http://localhost:8787/oauth/google/callback` and add its client ID/secret.
5. Run `npm run build`, `npm run migrate`, then `npm start`.
6. Open `http://localhost:8787`, enter the operator token, connect Google Calendar, create a draft schedule, and activate it after calendar verification.

The HTTP server binds to `127.0.0.1` in development. Production requires `BASE_URL=https://...`; set `HOST=0.0.0.0` behind a TLS reverse proxy.

### Windows 11 standalone

Run `powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1` once, then launch with `start-windows.cmd`. The setup script creates strong local secrets only when `.env` does not exist and preserves existing configuration. For a reserved ngrok endpoint, run `powershell -File .\scripts\start-ngrok.ps1 -PublicUrl https://your-static-domain.example`. For a temporary URL, use `-RandomUrl`; the launcher discovers the assigned HTTPS URL, starts the app with matching production/OAuth settings, and reports it only after both local and public health checks pass.

### HAI connector

Set the same strong `HAI_CONNECTOR_TOKEN` for the booking service and the companion in `integrations/hai`. The companion converts the authenticated booking feed into HAI's existing `json-feed` input without storing the bearer token in HAI or in a URL. Requester name/email are excluded by default; enable `HAI_CONNECTOR_INCLUDE_PII=true` only after an explicit privacy decision. See `integrations/hai/README.md`.

## Chrome appointment-choice sorter

The original Manifest V3 extension remains available as a separate, local browser feature. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository. It sorts recognised appointment-choice siblings by duration on supported Noodzakelijk Online and Google Calendar public booking routes, including dynamic updates and embedded frames. It deliberately excludes Google Calendar's normal week/day/month event grid. `test-page.html` is the visual fixture and `npm test` retains its repeatable content-script regression test.

## Verification

- `npm run check` - syntax, manifest, and extension asset checks.
- `npm test` - domain, DST, conflict, idempotency, reschedule/cancel, API auth, and content-script tests.
- `npm run build` - production React build.
- `npm run doctor` - configuration, database, build, and provider readiness.
- `npm run backup -- ./backups/booking.sqlite` - consistent SQLite backup while the app is stopped.
- `npm run support:bundle` - redacted diagnostic bundle; secrets and requester data are excluded.

## Safety model

- Calendar writes require a connected Google account and an active schedule.
- Short SQLite `BEGIN IMMEDIATE` transactions serialize local reservations; network calls happen outside database transactions and are reconciled by deterministic event IDs.
- The event ID is deterministic per schedule/idempotency key, preventing duplicate retry events.
- Google availability and local pending/confirmed reservations are rechecked at confirmation and reschedule, including schedule buffers.
- The operator can reconcile old uncertain reservations using deterministic Google event lookup; no new event is created by reconciliation.
- DST gaps and ambiguous fold times are rejected rather than silently shifted.
- OAuth and manage-token recovery data use AES-256-GCM; public manage tokens are hashed for verification and placed in URL fragments, not server request URLs.
- Emergency stop blocks new slot discovery, booking, and rescheduling while preserving cancellation access to existing events.

See `docs/OPERATOR_RUNBOOK.md`, `docs/SECURITY.md`, and `docs/FINAL_VERIFICATION_REPORT.md` before deployment.
