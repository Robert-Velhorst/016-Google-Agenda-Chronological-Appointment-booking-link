# Acceptance Tests

Status values are **PASS**, **BLOCKED**, or **NOT APPLICABLE**. A blocked browser, infrastructure, or live-provider check is never counted as a product pass.

| Journey or invariant | Evidence | Status |
| --- | --- | --- |
| Create/activate a schedule and return timezone-correct chronological slots | `test/booking-service.test.js`, `test/policy.test.js` | PASS |
| Reject invalid dates, availability overlaps, DST gaps, and DST-fold ambiguity | `test/policy.test.js` | PASS |
| Book once under idempotent retry and recover an ambiguous Google create | `test/booking-service.test.js` | PASS |
| Prevent local/provider overlap across schedules, including buffers and pending reservations | `test/booking-service.test.js` | PASS |
| Reschedule/cancel safely with fresh conflict checks and ETags | `test/booking-service.test.js` | PASS |
| Reconcile old uncertain reservations without creating a second event | `test/booking-service.test.js` | PASS |
| Keep management/idempotency secrets out of admin lists, complete export, and HAI | `test/booking-service.test.js`, `test/http.test.js` | PASS |
| Bound rate-limit state during unique-key floods | `test/rate-limit.test.js` | PASS |
| Preserve Google authorization on transient refresh failures and deduplicate refresh | `test/google-provider.test.js` | PASS |
| Reject unauthenticated/malformed HTTP requests and emit security headers/error envelopes | `test/http.test.js` | PASS |
| Existing extension handles combined hour/minute durations and live text/attribute changes | `test-content.js` | PASS |
| Windows 11 standalone install, three migrations, doctor, launcher health, cache and gzip headers | Local execution on 2026-08-09 | PASS |
| HAI read-only proxy with cursor and PII excluded by default | Local service-to-proxy execution on 2026-08-09 | PASS |
| Current rendered desktop/mobile interaction in requested in-app Browser | Browser webview repeatedly failed to attach | BLOCKED |
| Docker image/Compose runtime | Shared Docker daemon timed out while unrelated containers were active | BLOCKED |
| ngrok public health | Account endpoint already active elsewhere (`ERR_NGROK_334`); unrelated tunnel left untouched | BLOCKED |
| Real Google OAuth, FreeBusy, event/reminder delivery, reschedule, and cancel | Requires operator credentials, consent, and a disposable calendar | BLOCKED |
| SaaS billing, teams, AI decisions, uploads, and application workers | Outside this single-owner product | NOT APPLICABLE |

## Live acceptance script

1. Configure a disposable Google calendar, web OAuth client, and ngrok/static HTTPS endpoint.
2. Run `npm run doctor`, start the app, sign in, connect Google, and activate a schedule.
3. Book one slot and confirm exactly one event, attendee update, and reminders; retry the same request and confirm no duplicate.
4. Attempt a buffered competing booking, reschedule, cancel, and verify the event lifecycle in Google.
5. Exercise an uncertain reservation and the bounded reconcile action, export data, then disconnect Google before deleting local test data.
